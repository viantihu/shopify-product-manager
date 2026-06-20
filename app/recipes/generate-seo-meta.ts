// app/recipes/generate-seo-meta.ts
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { RECIPES } from "./registry";
import type { RecipeProposal } from "./types";

export const SeoLlmSchema = z.object({
  title: z.string(),
  description: z.string(),
  reason: z.string(),
});
export type SeoLlmOutput = z.infer<typeof SeoLlmSchema>;

const ID = "seo-meta-generator" as const;

export function toProposal(out: SeoLlmOutput): RecipeProposal {
  return {
    recipe: ID,
    version: RECIPES[ID].version,
    field: "seo",
    after: JSON.stringify({ title: out.title, description: out.description }),
    agentReason: out.reason,
    textPreserved: true,
  };
}

export async function run(input: {
  title: string;
  description: string;
}): Promise<RecipeProposal> {
  const client = new Anthropic();
  const model = process.env.LLM_MODEL ?? "claude-opus-4-8";
  const prompt = `Write an SEO meta title (<= 60 chars) and meta description (<= 155 chars) for this product.
Product title: ${input.title}
Description: ${input.description}
Return title, description, and a one-line reason.`;
  const response = await client.messages.parse({
    model,
    max_tokens: 1000,
    messages: [{ role: "user", content: prompt }],
    output_config: { format: zodOutputFormat(SeoLlmSchema) },
  });
  const out = response.parsed_output;
  if (!out) throw new Error("seo-meta-generator: invalid LLM output.");
  return toProposal(out);
}
