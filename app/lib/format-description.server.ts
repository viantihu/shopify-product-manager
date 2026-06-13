import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { type FormattingLevel, allowedTagsFor } from "./formatting-levels";
import { buildPrompt, type ProductContext } from "./format-prompt";
import { sanitizeHtml, textPreserved } from "./sanitize";

export const FormatResultSchema = z.object({
  formattedHtml: z.string(),
  changes: z.array(z.string()),
});

export type LlmOutput = z.infer<typeof FormatResultSchema>;

export interface FormatResult {
  original: string;
  formatted: string;
  changes: string[];
  level: FormattingLevel;
  warning: string | null;
}

/** Pure: sanitize the LLM output for the level and flag wording drift. */
export function postProcess(input: {
  original: string;
  llmOutput: LlmOutput;
  level: FormattingLevel;
}): FormatResult {
  const { original, llmOutput, level } = input;
  const formatted = sanitizeHtml(
    llmOutput.formattedHtml,
    allowedTagsFor(level),
  );
  const warning = textPreserved(original, formatted)
    ? null
    : "Wording may have changed — review carefully before saving.";
  return { original, formatted, changes: llmOutput.changes, level, warning };
}

/** Call Claude to format the description, then post-process. */
export async function formatDescription(input: {
  description: string;
  context: ProductContext;
  level: FormattingLevel;
}): Promise<FormatResult> {
  const { description, context, level } = input;
  const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env
  const model = process.env.LLM_MODEL ?? "claude-opus-4-8";

  const response = await client.messages.parse({
    model,
    max_tokens: 16000,
    messages: [
      { role: "user", content: buildPrompt({ description, context, level }) },
    ],
    output_config: { format: zodOutputFormat(FormatResultSchema) },
  });

  const llmOutput = response.parsed_output;
  if (!llmOutput) {
    throw new Error("LLM did not return a valid formatted result.");
  }
  return postProcess({ original: description, llmOutput, level });
}
