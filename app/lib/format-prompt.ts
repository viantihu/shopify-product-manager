import { type FormattingLevel, allowedTagsFor } from "./formatting-levels";

export interface ProductContext {
  title: string;
  productType: string;
  vendor: string;
}

const PREAMBLE = `You are a product-description FORMATTER for an e-commerce storefront.
The description below was synced from an ERP system with all formatting stripped.
Your job is to restore presentation structure as clean HTML.

HARD RULE — structure, not substance:
- You may ONLY add formatting markup, fix paragraph/line breaks, and tidy whitespace.
- You must NEVER change the wording: do not reword, add, remove, or alter any
  word, fact, number, or claim.
- The visible text a customer reads must be byte-for-byte the same words as the input.
- If you are unsure whether something is a heading or a list, leave it as a paragraph.

Return the formatted HTML and a short list of the structural changes you made.`;

const LEVEL_BLOCKS: Record<FormattingLevel, string> = {
  Light: `FORMATTING LEVEL: LIGHT
Only format what is explicit. Turn existing line breaks into paragraphs, and turn
a literal numbered or bulleted sequence into a list. Do NOT infer headings.`,
  Balanced: `FORMATTING LEVEL: BALANCED
Add headings and lists where the text clearly implies them (for example, a
"Features:" line followed by short clauses becomes a heading plus a list).
Leave ambiguous text as paragraphs.`,
  Full: `FORMATTING LEVEL: FULL
Infer structure from prose patterns. Promote run-on feature sentences to lists,
add section headings, and emphasize key terms. Apply the most polish — but still
never change a single word.`,
};

export function buildPrompt(input: {
  description: string;
  context: ProductContext;
  level: FormattingLevel;
}): string {
  const { description, context, level } = input;
  const tags = allowedTagsFor(level)
    .map((t) => `<${t}>`)
    .join(" ");

  return [
    PREAMBLE,
    LEVEL_BLOCKS[level],
    `ALLOWED TAGS (use only these): ${tags}`,
    `PRODUCT CONTEXT (read-only, for your judgment — do not output it):
Title: ${context.title}
Type: ${context.productType}
Vendor: ${context.vendor}`,
    `DESCRIPTION TO FORMAT:
${description}`,
  ].join("\n\n");
}
