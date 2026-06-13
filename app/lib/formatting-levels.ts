export const FORMATTING_LEVELS = ["Light", "Balanced", "Full"] as const;

export type FormattingLevel = (typeof FORMATTING_LEVELS)[number];

export const DEFAULT_LEVEL: FormattingLevel = "Balanced";

export function isFormattingLevel(value: string): value is FormattingLevel {
  return (FORMATTING_LEVELS as readonly string[]).includes(value);
}

const ALLOWED_TAGS: Record<FormattingLevel, string[]> = {
  Light: ["p", "br", "ul", "ol", "li"],
  Balanced: ["p", "br", "h2", "h3", "ul", "ol", "li"],
  Full: ["p", "br", "h2", "h3", "ul", "ol", "li", "strong", "em", "a"],
};

export function allowedTagsFor(level: FormattingLevel): string[] {
  return ALLOWED_TAGS[level];
}
