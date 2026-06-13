import { describe, it, expect } from "vitest";
import { sanitizeHtml, visibleText, textPreserved } from "./sanitize";

describe("sanitizeHtml", () => {
  it("keeps allowed tags", () => {
    const out = sanitizeHtml("<p>Hi</p><ul><li>A</li></ul>", [
      "p",
      "ul",
      "li",
    ]);
    expect(out).toContain("<p>Hi</p>");
    expect(out).toContain("<li>A</li>");
  });

  it("strips disallowed tags but keeps their text", () => {
    const out = sanitizeHtml("<h2>Title</h2><p>Body</p>", ["p"]);
    expect(out).not.toContain("<h2>");
    expect(out).toContain("Title");
    expect(out).toContain("<p>Body</p>");
  });

  it("strips script tags and their contents entirely", () => {
    const out = sanitizeHtml('<p>ok</p><script>alert(1)</script>', ["p"]);
    expect(out).not.toContain("script");
    expect(out).not.toContain("alert");
  });

  it("keeps href on anchors when a is allowed", () => {
    const out = sanitizeHtml('<a href="https://x.com">x</a>', ["a"]);
    expect(out).toContain('href="https://x.com"');
  });
});

describe("visibleText", () => {
  it("reduces HTML to normalized text", () => {
    expect(visibleText("<h2>Hi</h2>\n<p>there   world</p>")).toBe(
      "Hi there world",
    );
  });
});

describe("textPreserved", () => {
  it("is true when only the markup differs", () => {
    const original = "Soft merino crew. Machine washable.";
    const formatted =
      "<h2>Soft merino crew.</h2><ul><li>Machine washable.</li></ul>";
    expect(textPreserved(original, formatted)).toBe(true);
  });

  it("is false when wording changed", () => {
    const original = "Soft merino crew. Machine washable.";
    const formatted = "<p>Soft merino crew. Hand wash only.</p>";
    expect(textPreserved(original, formatted)).toBe(false);
  });
});
