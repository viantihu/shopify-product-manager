import { describe, it, expect } from "vitest";
import {
  parseEditable,
  serializeEditable,
  htmlToPlainText,
  plainTextToHtml,
} from "./decision-edit";

describe("htmlToPlainText", () => {
  it("turns block tags into paragraph breaks and strips markup", () => {
    expect(htmlToPlainText("<h2>Title</h2><p>Body one.</p><p>Body two.</p>")).toBe(
      "Title\n\nBody one.\n\nBody two.",
    );
  });

  it("flattens list items to lines", () => {
    expect(htmlToPlainText("<ul><li>A</li><li>B</li></ul>")).toBe("A\n\nB");
  });

  it("decodes entities and collapses whitespace", () => {
    expect(htmlToPlainText("<p>Tom &amp; Jerry&nbsp;&nbsp;play</p>")).toBe("Tom & Jerry play");
  });

  it("drops script content entirely", () => {
    expect(htmlToPlainText("<p>ok</p><script>alert(1)</script>")).toBe("ok");
  });
});

describe("plainTextToHtml", () => {
  it("wraps blank-line-separated blocks in paragraphs", () => {
    expect(plainTextToHtml("First para.\n\nSecond para.")).toBe(
      "<p>First para.</p><p>Second para.</p>",
    );
  });

  it("joins single newlines within a block into one paragraph", () => {
    expect(plainTextToHtml("line one\nline two")).toBe("<p>line one line two</p>");
  });

  it("escapes HTML so typed markup cannot be injected", () => {
    expect(plainTextToHtml("a < b & c")).toBe("<p>a &lt; b &amp; c</p>");
  });

  it("ignores empty blocks and trailing whitespace", () => {
    expect(plainTextToHtml("\n\nOnly one.\n\n\n")).toBe("<p>Only one.</p>");
  });
});

describe("parseEditable", () => {
  it("shows descriptionHtml as editable plain text", () => {
    const draft = parseEditable("descriptionHtml", "<h2>Soft crew</h2><p>Machine washable.</p>");
    expect(draft).toEqual({
      kind: "html",
      label: "Description",
      value: "Soft crew\n\nMachine washable.",
    });
  });

  it("treats productType as editable text", () => {
    expect(parseEditable("productType", "Snowboards")).toEqual({
      kind: "text",
      label: "Product type",
      value: "Snowboards",
    });
  });

  it("splits seo into title and description", () => {
    expect(parseEditable("seo", JSON.stringify({ title: "T", description: "D" }))).toEqual({
      kind: "seo",
      title: "T",
      description: "D",
    });
  });

  it("exposes only alt for imageAltText and preserves mediaId", () => {
    const after = JSON.stringify({ mediaId: "gid://shopify/MediaImage/9", alt: "A red bottle" });
    expect(parseEditable("imageAltText", after)).toEqual({
      kind: "alt",
      mediaId: "gid://shopify/MediaImage/9",
      alt: "A red bottle",
    });
  });

  it("falls back to raw text when structured JSON is malformed", () => {
    const draft = parseEditable("seo", "{not json");
    expect(draft.kind).toBe("text");
    if (draft.kind === "text") expect(draft.value).toBe("{not json");
  });

  it("tolerates a null alt", () => {
    const after = JSON.stringify({ mediaId: "gid://shopify/MediaImage/9", alt: null });
    expect(parseEditable("imageAltText", after)).toEqual({
      kind: "alt",
      mediaId: "gid://shopify/MediaImage/9",
      alt: "",
    });
  });
});

describe("serializeEditable", () => {
  it("round-trips text unchanged", () => {
    expect(serializeEditable({ kind: "text", label: "x", value: "Snowboards" })).toBe("Snowboards");
  });

  it("serializes an edited description to <p> paragraphs", () => {
    expect(
      serializeEditable({ kind: "html", label: "Description", value: "One.\n\nTwo." }),
    ).toBe("<p>One.</p><p>Two.</p>");
  });

  it("re-serializes seo to the shape the writer expects", () => {
    const out = serializeEditable({ kind: "seo", title: "T2", description: "D2" });
    expect(JSON.parse(out)).toEqual({ title: "T2", description: "D2" });
  });

  it("re-serializes alt, preserving mediaId", () => {
    const out = serializeEditable({
      kind: "alt",
      mediaId: "gid://shopify/MediaImage/9",
      alt: "edited alt",
    });
    expect(JSON.parse(out)).toEqual({ mediaId: "gid://shopify/MediaImage/9", alt: "edited alt" });
  });

  it("round-trips seo through parse then serialize", () => {
    const after = JSON.stringify({ title: "T", description: "D" });
    expect(JSON.parse(serializeEditable(parseEditable("seo", after)))).toEqual({
      title: "T",
      description: "D",
    });
  });

  it("round-trips a simple paragraph description through parse then serialize", () => {
    const after = "<p>First.</p><p>Second.</p>";
    expect(serializeEditable(parseEditable("descriptionHtml", after))).toBe(after);
  });
});
