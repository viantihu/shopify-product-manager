import { describe, it, expect } from "vitest";
import { postProcess } from "./format-description.server";

const original = "Soft merino crew. Machine washable.";

describe("postProcess", () => {
  it("sanitizes against the level allowlist and reports no warning when text preserved", () => {
    const llm = {
      formattedHtml:
        "<h2>Soft merino crew.</h2><ul><li>Machine washable.</li></ul>",
      changes: ["Added a heading", "Converted to a list"],
    };
    const result = postProcess({ original, llmOutput: llm, level: "Balanced" });
    expect(result.formatted).toContain("<h2>");
    expect(result.changes).toHaveLength(2);
    expect(result.warning).toBeNull();
  });

  it("strips tags the level forbids (Light removes a heading)", () => {
    const llm = {
      formattedHtml: "<h2>Soft merino crew.</h2><p>Machine washable.</p>",
      changes: ["Added a heading"],
    };
    const result = postProcess({ original, llmOutput: llm, level: "Light" });
    expect(result.formatted).not.toContain("<h2>");
    expect(result.formatted).toContain("Soft merino crew.");
  });

  it("sets a warning when wording changed", () => {
    const llm = {
      formattedHtml: "<p>Soft merino crew. Hand wash only.</p>",
      changes: [],
    };
    const result = postProcess({ original, llmOutput: llm, level: "Light" });
    expect(result.warning).toMatch(/wording/i);
  });
});
