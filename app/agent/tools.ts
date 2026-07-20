// app/agent/tools.ts
// The CLOSED tool registry. This array is the agent's entire reach.
// Tool *handlers* live in the loop (they need per-run context), so here we only
// declare the schema the model sees.
export interface ToolSpec {
  name: string;
  description: string;
  input_schema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
}

export const TOOLS: ToolSpec[] = [
  {
    name: "get_product",
    description: "Read the current state of the product being completed.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "assess_completeness",
    description: "Record which recipes apply to this product and why.",
    input_schema: {
      type: "object",
      properties: {
        applicable: { type: "array", items: { type: "string" } },
        reasoning: { type: "string" },
      },
      required: ["applicable", "reasoning"],
    },
  },
  {
    name: "validate_description",
    description:
      "Check whether the description is factually consistent with THIS product (its title, type, and vendor). Catches two things: (A) a wrong-product description from a data-migration error (a sweater's copy on a snowboard), and (B) an incoherent claim — right product but an audience/use/material/feature that cannot be true of it (a snowboard described as 'for skiers', or 'machine washable'). ALWAYS call this before any description edit. It judges factual consistency, NOT quality/wording/structure. On a flag it marks the product for human review ONLY — it never rewrites — and description edits stay blocked until it passes clean.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "format_description",
    description: "Restore formatting structure to the description. Use when the description is flat/unstructured.",
    input_schema: {
      type: "object",
      properties: { level: { type: "string", enum: ["Light", "Balanced", "Full"] } },
    },
  },
  {
    name: "rewrite_description",
    description:
      "Rewrite a description's prose for clarity and quality. Use only when the wording itself is poor (run-ons, grammar errors, incoherent or unprofessional copy), not merely unstructured.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "optimize_marketing_copy",
    description:
      "Sharpen a description that is grammatically clean and professional but WEAK as sales copy (dumps features instead of benefits, generic filler like 'high quality', no 'you' voice, buried value proposition). Rewrites toward marketing best practices using only facts already present, and adds reviewer coaching notes for gaps that need merchant input. Do NOT use to fix broken grammar (use rewrite_description) or missing structure (use format_description).",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "infer_product_type",
    description: "Infer a product type. Use only when productType is empty.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "generate_seo_meta",
    description: "Generate SEO title + description. Use when SEO meta is empty or weak.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "suggest_image_alt_text",
    description: "Suggest alt text for images that have none.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "finish",
    description: "Call when every applicable recipe has been run.",
    input_schema: { type: "object", properties: {} },
  },
];
