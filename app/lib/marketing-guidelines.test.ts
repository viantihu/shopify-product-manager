import { describe, it, expect } from "vitest";
import {
  REWRITE_GUIDELINES,
  COACHING_CHECKS,
  rewriteGuidelinesText,
  coachingChecksText,
} from "./marketing-guidelines";

describe("marketing guidelines", () => {
  it("exposes non-empty rewrite guidelines and coaching checks", () => {
    expect(REWRITE_GUIDELINES.length).toBeGreaterThan(0);
    expect(COACHING_CHECKS.length).toBeGreaterThan(0);
  });

  it("keeps the two groups distinct: rewrite = reframing, coaching = needs merchant input", () => {
    // Benefits-reframing is something the recipe DOES to existing copy.
    expect(rewriteGuidelinesText()).toContain("features as benefits");
    // Social proof is something a human must SUPPLY, so it is a coaching note.
    expect(coachingChecksText()).toContain("social proof");
    // And not the other way around.
    expect(rewriteGuidelinesText()).not.toContain("social proof");
  });

  it("renders each group as a bullet list, one guideline per line", () => {
    const rewriteLines = rewriteGuidelinesText().split("\n");
    expect(rewriteLines).toHaveLength(REWRITE_GUIDELINES.length);
    expect(rewriteLines.every((l) => l.startsWith("- "))).toBe(true);

    const coachingLines = coachingChecksText().split("\n");
    expect(coachingLines).toHaveLength(COACHING_CHECKS.length);
    expect(coachingLines.every((l) => l.startsWith("- "))).toBe(true);
  });
});
