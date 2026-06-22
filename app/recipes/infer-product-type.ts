// app/recipes/infer-product-type.ts
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { RECIPES } from "./registry";
import type { RecipeProposal } from "./types";

export const TypeLlmSchema = z.object({
  productType: z.string(),
  reason: z.string(),
});
export type TypeLlmOutput = z.infer<typeof TypeLlmSchema>;

const ID = "product-type-inferrer" as const;

export function toProposal(out: TypeLlmOutput): RecipeProposal {
  return {
    recipe: ID,
    version: RECIPES[ID].version,
    field: "productType",
    after: out.productType,
    agentReason: out.reason,
    textPreserved: true,
  };
}

export async function run(input: {
  title: string;
  description: string;
  vendor: string;
}): Promise<RecipeProposal> {
  const client = new Anthropic();
  const model = process.env.LLM_MODEL ?? "claude-opus-4-8";
  const prompt = `Infer a concise Shopify product type (2-3 words, title case) for this product.
Title: ${input.title}
Vendor: ${input.vendor}
Description: ${input.description}
Return the product type and a one-line reason.`;
  const response = await client.messages.parse({
    model,
    max_tokens: 1000,
    messages: [{ role: "user", content: prompt }],
    output_config: { format: zodOutputFormat(TypeLlmSchema) },
  });
  const out = response.parsed_output;
  if (!out) throw new Error("product-type-inferrer: invalid LLM output.");
  return toProposal(out);
}
