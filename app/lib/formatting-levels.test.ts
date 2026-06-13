import { describe, it, expect } from "vitest";
import {
  FORMATTING_LEVELS,
  isFormattingLevel,
  allowedTagsFor,
} from "./formatting-levels";

describe("formatting levels", () => {
  it("exposes exactly Light, Balanced, Full", () => {
    expect(FORMATTING_LEVELS).toEqual(["Light", "Balanced", "Full"]);
  });

  it("validates known and unknown level strings", () => {
    expect(isFormattingLevel("Balanced")).toBe(true);
    expect(isFormattingLevel("Aggressive")).toBe(false);
    expect(isFormattingLevel("")).toBe(false);
  });

  it("Light allows only paragraph and list tags, no headings or emphasis", () => {
    const tags = allowedTagsFor("Light");
    expect(tags).toEqual(["p", "br", "ul", "ol", "li"]);
    expect(tags).not.toContain("h2");
    expect(tags).not.toContain("strong");
  });

  it("Balanced adds headings but not emphasis or links", () => {
    const tags = allowedTagsFor("Balanced");
    expect(tags).toContain("h2");
    expect(tags).toContain("h3");
    expect(tags).not.toContain("strong");
    expect(tags).not.toContain("a");
  });

  it("Full allows headings, emphasis, and links", () => {
    const tags = allowedTagsFor("Full");
    expect(tags).toEqual(
      expect.arrayContaining(["h2", "h3", "strong", "em", "a"]),
    );
  });
});
