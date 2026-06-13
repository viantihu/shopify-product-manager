import { describe, it, expect } from "vitest";
import { buildPrompt } from "./format-prompt";

const ctx = { title: "Merino Crew", productType: "Sweater", vendor: "Northbound" };

describe("buildPrompt", () => {
  it("includes the non-fabrication rule in every level", () => {
    for (const level of ["Light", "Balanced", "Full"] as const) {
      const p = buildPrompt({
        description: "Soft merino crew. Machine washable.",
        context: ctx,
        level,
      });
      expect(p.toLowerCase()).toContain("never");
      expect(p.toLowerCase()).toContain("wording");
    }
  });

  it("injects the raw description and context", () => {
    const p = buildPrompt({
      description: "RAW_DESCRIPTION_MARKER",
      context: ctx,
      level: "Balanced",
    });
    expect(p).toContain("RAW_DESCRIPTION_MARKER");
    expect(p).toContain("Merino Crew");
    expect(p).toContain("Northbound");
  });

  it("selects a different guidance block per level", () => {
    const light = buildPrompt({ description: "x", context: ctx, level: "Light" });
    const full = buildPrompt({ description: "x", context: ctx, level: "Full" });
    expect(light).toContain("LIGHT");
    expect(full).toContain("FULL");
    expect(light).not.toBe(full);
  });

  it("lists the level's allowed tags in the prompt", () => {
    const light = buildPrompt({ description: "x", context: ctx, level: "Light" });
    expect(light).toContain("<ul>");
    expect(light).not.toContain("<h2>"); // Light forbids headings
  });
});
