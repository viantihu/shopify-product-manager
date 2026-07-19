// app/recipes/marketing-optimizer.ts
//
// Sharpens a description that is grammatically clean and professional but WEAK
// as sales copy — feature-dumping instead of benefits, generic "high quality"
// filler, no customer-facing voice, a buried value proposition. This is the gap
// left by the other two description recipes: description-formatter fixes
// STRUCTURE, content-rewriter repairs BROKEN prose, and neither touches copy
// that reads fine but does not sell.
//
// Two passes, mirroring content-rewriter:
//   1. Rewrite toward the merchant-editable marketing guidelines
//      (lib/marketing-guidelines.ts), using ONLY facts already in the source —
//      the same hard no-fabrication rule. Also emits coaching notes: advice for
//      the merchant about best practices that need information the copy lacks
//      (a testimonial, a sensory detail). Those notes are NEVER written into the
//      copy; that separation is what keeps them from becoming fabrication.
//   2. Fact-check the sanitized rewrite against the original (shared pass in
//      lib/fact-check.ts).
//
// The proposal always sets textPreserved:false, so the default-deny gate stages
// it for human review — this recipe does not auto-apply. Coaching notes and the
// fact-check verdict are recorded reviewer data, never gate factors.
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { sanitizeHtml } from "../lib/sanitize";
import {
  FactCheckLlmSchema,
  type FactCheckLlmOutput,
  buildFactCheckPrompt,
} from "../lib/fact-check";
import {
  rewriteGuidelinesText,
  coachingChecksText,
} from "../lib/marketing-guidelines";
import { RECIPES } from "./registry";
import type { RecipeProposal } from "./types";

export const MarketingLlmSchema = z.object({
  rewrittenHtml: z.string(),
  changes: z.array(z.string()),
  coachingNotes: z.array(z.string()),
});
export type MarketingLlmOutput = z.infer<typeof MarketingLlmSchema>;

const ID = "marketing-optimizer" as const;

// Same narrow allowlist as content-rewriter: this recipe improves WORDS and
// returns light paragraph structure only. Headings and lists remain the
// description-formatter's job.
export const MARKETING_ALLOWED_TAGS = ["p", "br"];

export interface MarketingContext {
  title: string;
  productType: string;
  vendor: string;
}

export function buildMarketingPrompt(input: {
  description: string;
  context: MarketingContext;
}): string {
  const { description, context } = input;
  return [
    `You are a product-description MARKETING EDITOR for an e-commerce storefront.
The description below is grammatically fine but sells poorly: it may dump
features instead of benefits, lean on generic filler, never address the
shopper, or bury what makes the product worth buying. Sharpen it into
persuasive copy.

HARD RULE — no fabrication:
- Use ONLY the facts already present in the source description.
- Never add, invent, embellish, or infer a claim, spec, feature, or number
  that the original did not state.
- If the original is vague about something, the rewrite stays vague about it.

APPLY THESE MARKETING GUIDELINES (reframe existing copy — introduce no new fact):
${rewriteGuidelinesText()}

COACHING NOTES — advice for a human, never copy:
Some best practices need information this description does not contain. Do NOT
invent that information and do NOT write it into the rewrittenHtml. Instead, for
each one that genuinely applies, add a short note in coachingNotes so the
merchant can supply it. Consider:
${coachingChecksText()}
Only include a note when it truly applies; return an empty list if none do.

STRUCTURE — light paragraphs only:
- Wrap the prose in <p> tags. Split into paragraphs where natural.
- Do NOT add headings, lists, bold, or any other markup; a separate
  formatting step owns structure.

Return the rewritten HTML, a short list of the changes you made, and the
coaching notes.`,
    `PRODUCT CONTEXT (read-only, for your judgment — do not output it):
Title: ${context.title}
Type: ${context.productType}
Vendor: ${context.vendor}`,
    `DESCRIPTION TO OPTIMIZE:
${description}`,
  ].join("\n\n");
}

/** Pure: sanitize the rewrite and merge both passes into a RecipeProposal. */
export function postProcess(input: {
  marketingOutput: MarketingLlmOutput;
  factCheck: FactCheckLlmOutput;
}): RecipeProposal {
  const { marketingOutput, factCheck } = input;
  return {
    recipe: ID,
    version: RECIPES[ID].version,
    field: "descriptionHtml",
    after: sanitizeHtml(marketingOutput.rewrittenHtml, MARKETING_ALLOWED_TAGS),
    agentReason:
      marketingOutput.changes.join("; ") || "Sharpened copy toward marketing best practices.",
    // Words changed by definition, so the gate's default-deny stages this.
    textPreserved: false,
    factCheck: {
      factsPreserved: factCheck.factsPreserved,
      addedClaims: factCheck.addedClaims,
    },
    // Always an array (even empty) so a marketing decision is distinguishable
    // from a non-marketing one (null) downstream.
    coachingNotes: marketingOutput.coachingNotes,
  };
}

/** Two-pass: marketing rewrite, then fact-check the sanitized rewrite. */
export async function run(input: {
  description: string;
  context: MarketingContext;
}): Promise<RecipeProposal> {
  const client = new Anthropic();
  const model = process.env.LLM_MODEL ?? "claude-opus-4-8";

  const marketingResponse = await client.messages.parse({
    model,
    max_tokens: 16000,
    messages: [{ role: "user", content: buildMarketingPrompt(input) }],
    output_config: { format: zodOutputFormat(MarketingLlmSchema) },
  });
  const marketingOut = marketingResponse.parsed_output;
  if (!marketingOut) throw new Error("marketing-optimizer: invalid rewrite output.");

  // Fact-check the sanitized text — that is what would ship if approved.
  const sanitized = sanitizeHtml(marketingOut.rewrittenHtml, MARKETING_ALLOWED_TAGS);
  const factCheckResponse = await client.messages.parse({
    model,
    max_tokens: 2000,
    messages: [
      {
        role: "user",
        content: buildFactCheckPrompt({ original: input.description, rewrite: sanitized }),
      },
    ],
    output_config: { format: zodOutputFormat(FactCheckLlmSchema) },
  });
  const factCheckOut = factCheckResponse.parsed_output;
  if (!factCheckOut) throw new Error("marketing-optimizer: invalid fact-check output.");

  return postProcess({ marketingOutput: marketingOut, factCheck: factCheckOut });
}
