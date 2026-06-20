import { describe, it, expect } from "vitest";
import { postProcess } from "./format-description";

const original = "Soft merino crew. Machine washable.";

describe("description-formatter postProcess", () => {
  it("sanitizes to the level allowlist and reports textPreserved", () => {
    const out = {
      formattedHtml: "<h2>Soft merino crew.</h2><ul><li>Machine washable.</li></ul>",
      changes: ["Added a heading", "Converted to a list"],
    };
    const p = postProcess({ original, llmOutput: out, level: "Balanced" });
    expect(p.field).toBe("descriptionHtml");
    expect(p.after).toContain("<h2>");
    expect(p.textPreserved).toBe(true);
  });

  it("strips forbidden tags (Light removes a heading) and stays text-preserved", () => {
    const out = { formattedHtml: "<h2>Soft merino crew.</h2><p>Machine washable.</p>", changes: [] };
    const p = postProcess({ original, llmOutput: out, level: "Light" });
    expect(p.after).not.toContain("<h2>");
    expect(p.textPreserved).toBe(true);
  });

  it("flags textPreserved=false when wording changed", () => {
    const out = { formattedHtml: "<p>Soft merino crew. Hand wash only.</p>", changes: [] };
    const p = postProcess({ original, llmOutput: out, level: "Light" });
    expect(p.textPreserved).toBe(false);
  });
});
