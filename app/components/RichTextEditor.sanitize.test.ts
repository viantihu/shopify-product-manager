// app/components/RichTextEditor.sanitize.test.ts
//
// The RichTextEditor↔sanitize contract. RichTextEditor.tsx constrains TipTap to
// emit only the tags in allowedTagsFor("Full"); the route action then runs
// sanitizeHtml(html, allowedTagsFor("Full")) before writing, so sanitize is the
// final authority on what ships. These two must agree: every tag the editor is
// configured to PRODUCE must survive sanitize unchanged, and every tag it is
// configured to SUPPRESS must be one sanitize would strip anyway (defence in
// depth — if a TipTap upgrade ever leaks a suppressed tag, sanitize still drops
// it server-side).
//
// This test pins the server half of that contract without a DOM (it exercises
// sanitize directly, not the live editor). The client half — that TipTap v3
// actually honours every StarterKit flag in EXTENSIONS — is covered by the
// manual walkthrough, since useEditor/getHTML need a browser.
import { describe, it, expect } from "vitest";
import { sanitizeHtml } from "../lib/sanitize";
import { allowedTagsFor } from "../lib/formatting-levels";

const FULL = allowedTagsFor("Full");
const clean = (html: string) => sanitizeHtml(html, FULL);

describe("RichTextEditor ↔ sanitize contract", () => {
  // Every tag the toolbar can produce. Sanitize must keep the tag (it may
  // normalise the serialisation, e.g. <br> -> <br />, but the tag survives).
  const ALLOWED: Array<{ name: string; html: string; expectTag: string }> = [
    { name: "paragraph", html: "<p>Body text.</p>", expectTag: "<p>" },
    { name: "line break", html: "<p>One<br>Two</p>", expectTag: "<br" },
    { name: "h2 (heading level 2)", html: "<h2>Title</h2>", expectTag: "<h2>" },
    { name: "h3 (heading level 3)", html: "<h3>Sub</h3>", expectTag: "<h3>" },
    { name: "bullet list", html: "<ul><li>Item</li></ul>", expectTag: "<ul>" },
    { name: "numbered list", html: "<ol><li>Item</li></ol>", expectTag: "<ol>" },
    { name: "bold", html: "<p><strong>b</strong></p>", expectTag: "<strong>" },
    { name: "italic", html: "<p><em>i</em></p>", expectTag: "<em>" },
    { name: "link", html: '<p><a href="https://x.com">l</a></p>', expectTag: "<a" },
  ];

  for (const { name, html, expectTag } of ALLOWED) {
    it(`keeps ${name}`, () => {
      const out = clean(html);
      expect(out).toContain(expectTag);
    });
  }

  // Every node/mark disabled in the StarterKit config (heading levels capped at
  // [2,3]; codeBlock/blockquote/horizontalRule/strike/code all off). If the
  // editor ever leaked one, sanitize strips the tag and keeps only its text.
  const SUPPRESSED: Array<{ name: string; html: string; text: string }> = [
    { name: "blockquote", html: "<blockquote>Quote</blockquote>", text: "Quote" },
    { name: "code block", html: "<pre><code>code</code></pre>", text: "code" },
    { name: "inline code", html: "<p><code>x</code></p>", text: "x" },
    { name: "strikethrough", html: "<p><s>struck</s></p>", text: "struck" },
    { name: "horizontal rule", html: "<p>a</p><hr><p>b</p>", text: "a" },
    { name: "h1 (above allowed levels)", html: "<h1>Big</h1>", text: "Big" },
    { name: "h4 (below allowed levels)", html: "<h4>Small</h4>", text: "Small" },
  ];

  for (const { name, html, text } of SUPPRESSED) {
    it(`strips ${name} to text`, () => {
      const out = clean(html);
      expect(out).toContain(text); // text content survives
      expect(out).not.toMatch(/<(blockquote|pre|code|s|hr|h1|h4)\b/); // tag gone
    });
  }

  it("keeps only href on anchors (matches editor's rel:null/target:null config)", () => {
    const out = clean('<a href="https://x.com" target="_blank" rel="noopener" onclick="x()">l</a>');
    expect(out).toContain('href="https://x.com"');
    expect(out).not.toContain("target");
    expect(out).not.toContain("rel");
    expect(out).not.toContain("onclick");
  });

  it("is idempotent: sanitising a saved-then-reopened value does not drift", () => {
    // Guards the no-edit round trip. A value already sanitised once must survive
    // a second pass byte-for-byte, or reopening + re-saving would churn the field.
    const rich =
      '<h2>Care</h2><p>Soft merino. <strong>Machine</strong> <em>washable</em>.</p>' +
      '<ul><li>Cold water</li></ul><p>See <a href="https://x.com">guide</a>.</p>';
    const once = clean(rich);
    expect(clean(once)).toBe(once);
  });
});
