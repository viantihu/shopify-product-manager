// app/lib/fact-check.ts
//
// Shared fact-check pass for facts-only description recipes. Any recipe that
// rewrites prose under the no-fabrication rule (content-rewriter, marketing-
// optimizer) runs its sanitized output through this second pass to catch claims
// the rewrite added that the original never stated. The verdict is recorded on
// the Decision as reviewer data (Decision.factCheck) — it is NEVER a gate
// factor, so a failed check flags for the human but does not change auto-vs-stage.
import { z } from "zod";

export const FactCheckLlmSchema = z.object({
  factsPreserved: z.boolean(),
  addedClaims: z.array(z.string()),
});
export type FactCheckLlmOutput = z.infer<typeof FactCheckLlmSchema>;

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
