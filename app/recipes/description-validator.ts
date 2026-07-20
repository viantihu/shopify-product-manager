// app/recipes/description-validator.ts
//
// Catches a description that misrepresents the product, in either of two ways:
//   (A) WRONG PRODUCT — the copy describes a different product than its
//       title/type/vendor say (the "sweater description on a snowboard" a
//       data-migration error produces).
//   (B) INCOHERENT CLAIM — the copy is about the right product but asserts
//       something that cannot be true of it: a use, audience, material, or
//       feature that contradicts what the product is (a snowboard described as
//       "for skiers", a snowboard called "machine washable").
// Both are the gap the other three description recipes miss entirely: the copy
// can be grammatically clean, well-structured, and persuasive while being wrong
// on the facts, so rewrite/optimize/format all pass it through (rewrite even
// preserves the false claim as content, and description-formatter can auto-apply
// it). Validation is the fact-level safety net in front of them.
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
  // true when the description is factually consistent with THIS product; false
  // on a wrong-product OR incoherent-claim contradiction.
  matches: z.boolean(),
  // One-line human-readable summary of the verdict (shown in the review queue).
  reason: z.string(),
  // Concrete signals that drove a flag (the description asserts X, which cannot
  // be true of this product / conflicts with title Y). Empty when matches is true.
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
arrive from an ERP where data errors can leave a description that misrepresents
the product. Your ONLY job is to judge whether the description below is
factually consistent with the product its title, type, and vendor indicate.

Flag a description (matches: false) in EITHER of these cases:
  (A) WRONG PRODUCT — it describes a genuinely different KIND of product than the
      title/type say (a different category, use, or material that could not be
      the same item). Example: title "Snowboard", description about a merino
      wool sweater.
  (B) INCOHERENT CLAIM — it is about the right product but asserts something that
      cannot be true of that product: an audience, use, material, or feature that
      contradicts what it is. Examples: a snowboard described as "for skiers" or
      "for surfers"; a snowboard called "machine washable"; a coffee mug that is
      "waterproof to 200m".

Judge FACTUAL CONSISTENCY, not quality. A description can be vague, generic,
badly written, or poorly formatted and still be factually fine — that is NOT a
flag (other tools handle wording, persuasion, and structure). Do not flag on
tone, weak marketing, or missing detail.

Be conservative and specific. Flag only a CLEAR contradiction you can name in
concrete terms. When the description is merely thin, unclear, or plausibly true,
treat it as a MATCH. A single wrong word that clearly contradicts the product
(the snowboard "for skiers") IS a flag; a debatable stylistic choice is not.

Return:
- matches: true if it is factually consistent with this product, false on a clear
  wrong-product OR incoherent-claim contradiction.
- reason: one sentence a store owner can read (what conflicts, and why it cannot
  be true of this product).
- evidence: when matches is false, the concrete conflicting signals (e.g.
  "description says 'for avid skiers'; the product is a Snowboard, used by
  snowboarders"). Empty when matches is true.`,
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
      agentReason: out.reason || "Description may misrepresent this product.",
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
