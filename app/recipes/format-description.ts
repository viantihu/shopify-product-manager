// app/recipes/format-description.ts
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { type FormattingLevel, allowedTagsFor } from "../lib/formatting-levels";
import { buildPrompt, type ProductContext } from "../lib/format-prompt";
import { sanitizeHtml, textPreserved } from "../lib/sanitize";
import { RECIPES } from "./registry";
import type { RecipeProposal } from "./types";

export const FormatLlmSchema = z.object({
  formattedHtml: z.string(),
  changes: z.array(z.string()),
});
export type FormatLlmOutput = z.infer<typeof FormatLlmSchema>;

const ID = "description-formatter" as const;

/** Pure: sanitize for the level and compute the text-preservation factor. */
export function postProcess(input: {
  original: string;
  llmOutput: FormatLlmOutput;
  level: FormattingLevel;
}): RecipeProposal {
  const { original, llmOutput, level } = input;
  const formatted = sanitizeHtml(llmOutput.formattedHtml, allowedTagsFor(level));
  return {
    recipe: ID,
    version: RECIPES[ID].version,
    field: "descriptionHtml",
    after: formatted,
    agentReason: llmOutput.changes.join("; ") || "Restored formatting structure.",
    textPreserved: textPreserved(original, formatted),
  };
}

/** Call Claude, then post-process into a RecipeProposal. */
export async function run(input: {
  description: string;
  context: ProductContext;
  level: FormattingLevel;
}): Promise<RecipeProposal> {
  const client = new Anthropic();
  const model = process.env.LLM_MODEL ?? "claude-opus-4-8";
  const response = await client.messages.parse({
    model,
    max_tokens: 16000,
    messages: [{ role: "user", content: buildPrompt(input) }],
    output_config: { format: zodOutputFormat(FormatLlmSchema) },
  });
  const out = response.parsed_output;
  if (!out) throw new Error("description-formatter: invalid LLM output.");
  return postProcess({ original: input.description, llmOutput: out, level: input.level });
}
