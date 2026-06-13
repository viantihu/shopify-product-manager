import sanitizeHtmlLib from "sanitize-html";

/** Strip every tag not in `allowedTags`; keep the text of stripped tags. */
export function sanitizeHtml(html: string, allowedTags: string[]): string {
  return sanitizeHtmlLib(html, {
    allowedTags,
    allowedAttributes: allowedTags.includes("a") ? { a: ["href"] } : {},
    // Disallowed structural tags: drop the tag, keep its text content.
    disallowedTagsMode: "discard",
    // These tags' *contents* are removed entirely (not escaped into text).
    nonTextTags: ["script", "style", "textarea", "noscript"],
  });
}

/** Reduce HTML to plain text with collapsed whitespace. */
export function visibleText(html: string): string {
  // sanitize-html concatenates content across stripped block tags without
  // inserting whitespace (e.g. "<h2>A.</h2><p>B</p>" -> "A.B"). Insert a space
  // before every tag first so block boundaries become word breaks; the trailing
  // whitespace collapse makes the extra spaces harmless.
  const spaced = html.replace(/</g, " <");
  const text = sanitizeHtmlLib(spaced, {
    allowedTags: [],
    allowedAttributes: {},
    nonTextTags: ["script", "style", "textarea", "noscript"],
  });
  return text.replace(/\s+/g, " ").trim();
}

/**
 * True when the two HTML strings render the same visible text.
 * This is the structure-not-substance guard: formatting may change,
 * wording may not.
 */
export function textPreserved(original: string, formatted: string): boolean {
  return visibleText(original) === visibleText(formatted);
}
