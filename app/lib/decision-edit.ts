// app/lib/decision-edit.ts
//
// The review page lets a human edit the agent's suggestion in place before
// approving it. Every field is edited as PLAIN TEXT — no HTML editor — even
// though a Decision's `after` is serialized per field: HTML for descriptionHtml,
// JSON for seo ({title, description}) and imageAltText ({mediaId, alt}), plain
// text for productType. These helpers turn `after` into a plain-text draft and
// back into the exact `editedValue` string the review action + field writers
// expect. Kept pure (no React/Prisma) for unit testing.
import sanitizeHtmlLib from "sanitize-html";

// A single free-text field (product type, or a structured field we couldn't
// parse). Serializes back verbatim.
export interface TextDraft {
  kind: "text";
  label: string;
  value: string;
}

// The product description. Shown and edited as plain text with blank lines
// between paragraphs; serialized back to simple <p> paragraphs on save. The
// agent's richer formatting (headings, bullets) survives only via "Approve
// as-is" — a human edit flattens to paragraphs, which is the tradeoff for
// keeping the editor plain-text and familiar.
export interface HtmlDraft {
  kind: "html";
  label: string;
  value: string; // plain text shown in the box
}

// SEO meta: two independent plain-text fields.
export interface SeoDraft {
  kind: "seo";
  title: string;
  description: string;
}

// Image alt text. Only `alt` is editable; `mediaId` is preserved verbatim so
// the writer targets the right image.
export interface AltDraft {
  kind: "alt";
  mediaId: string;
  alt: string;
}

export type EditDraft = TextDraft | HtmlDraft | SeoDraft | AltDraft;

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
};

function decodeEntities(s: string): string {
  return s.replace(/&amp;|&lt;|&gt;|&quot;|&#39;|&nbsp;/g, (m) => ENTITIES[m]);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Turn description HTML into readable plain text, preserving block structure as
 * blank lines. Closing block tags become paragraph breaks and <br> a single
 * line break; all other tags are stripped (their text kept). This is what the
 * reviewer sees and edits.
 */
export function htmlToPlainText(html: string): string {
  const withBreaks = html
    .replace(/<\/(p|h[1-6]|li|ul|ol|div|blockquote)>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n");
  const stripped = sanitizeHtmlLib(withBreaks, {
    allowedTags: [],
    allowedAttributes: {},
    nonTextTags: ["script", "style", "textarea", "noscript"],
  });
  return decodeEntities(stripped)
    .replace(/[ \t ]+/g, " ") // sanitize-html decodes &nbsp; to U+00A0; collapse it with normal spaces
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Turn a reviewer's plain-text description back into HTML: blank-line-separated
 * blocks become <p> paragraphs, single newlines within a block become spaces.
 * Text is HTML-escaped so typing "<" or "&" can't inject markup.
 */
export function plainTextToHtml(text: string): string {
  const blocks = text
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter((b) => b.length > 0);
  return blocks
    .map((b) => `<p>${escapeHtml(b.replace(/\n+/g, " ")).trim()}</p>`)
    .join("");
}

/**
 * Build an editable plain-text draft from a decision's field + `after` value.
 * Falls back to a raw text draft when a structured field's JSON can't be parsed,
 * so a corrupt row is still editable rather than crashing the page.
 */
export function parseEditable(field: string, after: string): EditDraft {
  switch (field) {
    case "descriptionHtml":
      return { kind: "html", label: "Description", value: htmlToPlainText(after) };
    case "seo": {
      try {
        const { title, description } = JSON.parse(after) as {
          title?: string;
          description?: string;
        };
        return { kind: "seo", title: title ?? "", description: description ?? "" };
      } catch {
        return { kind: "text", label: "SEO (raw)", value: after };
      }
    }
    case "imageAltText": {
      try {
        const { mediaId, alt } = JSON.parse(after) as {
          mediaId: string;
          alt?: string | null;
        };
        return { kind: "alt", mediaId, alt: alt ?? "" };
      } catch {
        return { kind: "text", label: "Image alt text (raw)", value: after };
      }
    }
    case "productType":
      return { kind: "text", label: "Product type", value: after };
    default:
      return { kind: "text", label: field, value: after };
  }
}

/**
 * Serialize an edited draft back into the `editedValue` string the review
 * action consumes. The shape must match what the field's writer expects: raw
 * text for text fields, <p> HTML for a description, JSON for seo/alt (mirrors
 * app/harness/apply.ts).
 */
export function serializeEditable(draft: EditDraft): string {
  switch (draft.kind) {
    case "text":
      return draft.value;
    case "html":
      return plainTextToHtml(draft.value);
    case "seo":
      return JSON.stringify({ title: draft.title, description: draft.description });
    case "alt":
      return JSON.stringify({ mediaId: draft.mediaId, alt: draft.alt });
  }
}
