// app/recipes/suggest-image-alt-text.ts
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { RECIPES } from "./registry";
import type { RecipeProposal } from "./types";

const ID = "image-alt-text" as const;

export function toProposal(input: { mediaId: string; alt: string }): RecipeProposal {
  return {
    recipe: ID,
    version: RECIPES[ID].version,
    field: "imageAltText",
    after: JSON.stringify({ mediaId: input.mediaId, alt: input.alt }),
    agentReason: `Suggested alt text for image ${input.mediaId}.`,
    textPreserved: true,
  };
}

const AltLlmSchema = z.object({ alt: z.string() });

/** One call per image; the caller loops over images missing alt text. */
export async function run(input: {
  productTitle: string;
  imageUrl: string;
  mediaId: string;
}): Promise<RecipeProposal> {
  const client = new Anthropic();
  const model = process.env.LLM_MODEL ?? "claude-opus-4-8";
  const prompt = `Write concise, descriptive alt text (<= 125 chars) for a product image.
Product: ${input.productTitle}
Image URL: ${input.imageUrl}
Return only the alt text.`;
  const response = await client.messages.parse({
    model,
    max_tokens: 300,
    messages: [{ role: "user", content: prompt }],
    output_config: { format: zodOutputFormat(AltLlmSchema) },
  });
  const out = response.parsed_output;
  if (!out) throw new Error("image-alt-text: invalid LLM output.");
  return toProposal({ mediaId: input.mediaId, alt: out.alt });
}
