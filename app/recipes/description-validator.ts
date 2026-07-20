// app/recipes/description-validator.ts
//
// Catches a description that describes a DIFFERENT product than its
// title/type/vendor say — the "sweater description on a snowboard" that a
// data-migration mismatch can produce. This is the gap the other three
// description recipes miss entirely: the copy can be grammatically clean,
// well-structured, and persuasive while being about the wrong product, so
// rewrite/optimize/format all pass it through (and description-formatter can even
// auto-apply it). Validation is the safety net in front of them.
//
// UNLIKE every other recipe, this one is a DETECTOR, not a transformer. On a
// mismatch it has nothing correct to write — the agent cannot know the true
// snowboard copy — so it never produces a writable value. It emits a review-only
// proposal on a NEW logical field, `descriptionMatch`, that has NO writer in
// apply.ts. The default-deny gate stages it (textPreserved:false), a human sees
// the flag, and the loop guard (app/agent/loop.ts) blocks the description-writing
// tools until validation has run clean this pass.
//
// run() returns RecipeProposal[]: an EMPTY array when the description matches the
// product (nothing to flag — mirrors suggest-image-alt-text returning [] when no
// image needs alt text), or a single-element array carrying the finding.
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { RECIPES } from "./registry";
import type { RecipeProposal } from "./types";

export const MatchLlmSchema = z.object({
  // true when the description plausibly describes THIS product; false on a
  // genuine product mismatch.
  matches: z.boolean(),
  // One-line human-readable summary of the verdict (shown in the review queue).
  reason: z.string(),
  // Concrete signals that drove a mismatch verdict (the description mentions X
  // while the title says Y). Empty when matches is true.
  evidence: z.array(z.string()),
});
export type MatchLlmOutput = z.infer<typeof MatchLlmSchema>;

const ID = "description-validator" as const;

export interface ValidatorContext {
  title: string;
  productType: string;
  vendor: string;
}

// The structured finding stored in the proposal's `after`. It is NOT a writable
// value — the advisory review UI parses it for display; it never reaches a
// Shopify writer. Kept as JSON in `after` (like seo/imageAltText) so no new
// column is needed.
export interface MismatchFinding {
  reason: string;
  evidence: string[];
}

export function buildValidatorPrompt(input: {
  description: string;
  context: ValidatorContext;
}): string {
  const { description, context } = input;
  return [
    `You are a product-data VALIDATOR for an e-commerce storefront. Products
arrive from an ERP where a data-migration error can attach the WRONG
description to a product — for example a sweater's description saved on a
snowboard. Your ONLY job is to judge whether the description below plausibly
describes the SAME product its title, type, and vendor indicate.

Judge product IDENTITY, not quality. A description can be vague, badly written,
or poorly formatted and still be about the right product — that is NOT a
mismatch (other tools handle quality). Flag a mismatch ONLY when the description
is about a genuinely different KIND of product than the title/type say (a
different category, use, or material that could not be the same item).

Be conservative. When the description is thin, generic, or merely unclear, treat
it as a MATCH — do not flag on weak signals. Flag only a clear contradiction.

Return:
- matches: true if it plausibly describes this product, false on a clear mismatch.
- reason: one sentence a store owner can read (what matches or what conflicts).
- evidence: when matches is false, the concrete conflicting signals (e.g.
  "description discusses merino wool and layering; title/type say Snowboard").
  Empty when matches is true.`,
    `PRODUCT IDENTITY (the source of truth to check against):
Title: ${context.title}
Type: ${context.productType}
Vendor: ${context.vendor}`,
    `DESCRIPTION TO VALIDATE:
${description}`,
  ].join("\n\n");
}

/**
 * Pure: turn the LLM verdict into zero or one RecipeProposal. A match yields an
 * EMPTY array (nothing staged). A mismatch yields one review-only proposal:
 * field `descriptionMatch` (no writer), textPreserved:false so the default-deny
 * gate stages it, the one-line summary in agentReason, and the structured
 * finding JSON-encoded in `after`.
 */
export function postProcess(out: MatchLlmOutput): RecipeProposal[] {
  if (out.matches) return [];
  const finding: MismatchFinding = { reason: out.reason, evidence: out.evidence };
  return [
    {
      recipe: ID,
      version: RECIPES[ID].version,
      field: "descriptionMatch",
      after: JSON.stringify(finding),
      agentReason: out.reason || "Description may describe a different product.",
      // Not a text transform; this factor is moot for a non-writing recipe, but
      // false keeps it firmly on the default-deny (staged) path.
      textPreserved: false,
    },
  ];
}

/** Call Claude to compare description vs. product identity, then post-process. */
export async function run(input: {
  description: string;
  context: ValidatorContext;
}): Promise<RecipeProposal[]> {
  const client = new Anthropic();
  const model = process.env.LLM_MODEL ?? "claude-opus-4-8";
  const response = await client.messages.parse({
    model,
    max_tokens: 1000,
    messages: [{ role: "user", content: buildValidatorPrompt(input) }],
    output_config: { format: zodOutputFormat(MatchLlmSchema) },
  });
  const out = response.parsed_output;
  if (!out) throw new Error("description-validator: invalid LLM output.");
  return postProcess(out);
}
