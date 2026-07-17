// app/recipes/content-rewriter.ts
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { sanitizeHtml } from "../lib/sanitize";
import { RECIPES } from "./registry";
import type { RecipeProposal } from "./types";

export const RewriteLlmSchema = z.object({
  rewrittenHtml: z.string(),
  changes: z.array(z.string()),
});
export type RewriteLlmOutput = z.infer<typeof RewriteLlmSchema>;

export const FactCheckLlmSchema = z.object({
  factsPreserved: z.boolean(),
  addedClaims: z.array(z.string()),
});
export type FactCheckLlmOutput = z.infer<typeof FactCheckLlmSchema>;

const ID = "content-rewriter" as const;

// Deliberately narrower than every formatting level: the rewriter improves
// words and returns light paragraph structure only. Headings and lists remain
// the description-formatter's job.
export const REWRITER_ALLOWED_TAGS = ["p", "br"];

export interface RewriteContext {
  title: string;
  productType: string;
  vendor: string;
}

export function buildRewritePrompt(input: {
  description: string;
  context: RewriteContext;
}): string {
  const { description, context } = input;
  return [
    `You are a product-description REWRITER for an e-commerce storefront.
The description below has genuine prose-quality problems (run-on sentences,
grammar errors, incoherent or unprofessional copy). Rewrite it for clarity,
tone, and grammar.

HARD RULE — no fabrication:
- Use ONLY the facts already present in the source description.
- Never add, invent, embellish, or infer a claim, spec, feature, or number
  that the original did not state.
- If the original is vague about something, the rewrite stays vague about it.

STRUCTURE — light paragraphs only:
- Wrap the prose in <p> tags. Split into paragraphs where natural.
- Do NOT add headings, lists, bold, or any other markup; a separate
  formatting step owns structure.

Return the rewritten HTML and a short list of the changes you made.`,
    `PRODUCT CONTEXT (read-only, for your judgment — do not output it):
Title: ${context.title}
Type: ${context.productType}
Vendor: ${context.vendor}`,
    `DESCRIPTION TO REWRITE:
${description}`,
  ].join("\n\n");
}

export function buildFactCheckPrompt(input: {
  original: string;
  rewrite: string;
}): string {
  return `You are a fact-checker comparing a product description against its rewrite.

Answer one narrow question: does the REWRITE assert any claim, spec, number,
feature, or fact that is NOT present in the ORIGINAL? Rephrasing, reordering,
and tone changes are fine — only ADDED substance counts.

List each added claim in plain language. If nothing was added, report
factsPreserved true with an empty list.

ORIGINAL:
${input.original}

REWRITE:
${input.rewrite}`;
}

/** Pure: sanitize the rewrite and merge both passes into a RecipeProposal. */
export function postProcess(input: {
  rewriteOutput: RewriteLlmOutput;
  factCheck: FactCheckLlmOutput;
}): RecipeProposal {
  const { rewriteOutput, factCheck } = input;
  return {
    recipe: ID,
    version: RECIPES[ID].version,
    field: "descriptionHtml",
    after: sanitizeHtml(rewriteOutput.rewrittenHtml, REWRITER_ALLOWED_TAGS),
    agentReason: rewriteOutput.changes.join("; ") || "Rewrote prose for clarity.",
    // Words changed by definition, so the gate's default-deny stages this.
    textPreserved: false,
    factCheck: {
      factsPreserved: factCheck.factsPreserved,
      addedClaims: factCheck.addedClaims,
    },
  };
}

/** Two-pass: rewrite, then fact-check the sanitized rewrite against the source. */
export async function run(input: {
  description: string;
  context: RewriteContext;
}): Promise<RecipeProposal> {
  const client = new Anthropic();
  const model = process.env.LLM_MODEL ?? "claude-opus-4-8";

  const rewriteResponse = await client.messages.parse({
    model,
    max_tokens: 16000,
    messages: [{ role: "user", content: buildRewritePrompt(input) }],
    output_config: { format: zodOutputFormat(RewriteLlmSchema) },
  });
  const rewriteOut = rewriteResponse.parsed_output;
  if (!rewriteOut) throw new Error("content-rewriter: invalid rewrite output.");

  // Fact-check the sanitized text — that is what would ship if approved.
  const sanitized = sanitizeHtml(rewriteOut.rewrittenHtml, REWRITER_ALLOWED_TAGS);
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
  if (!factCheckOut) throw new Error("content-rewriter: invalid fact-check output.");

  return postProcess({ rewriteOutput: rewriteOut, factCheck: factCheckOut });
}
