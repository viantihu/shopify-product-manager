import { describe, it, expect } from "vitest";
import { postProcess } from "./content-rewriter";

describe("content-rewriter postProcess", () => {
  it("sanitizes to the p/br allowlist, keeping the text of stripped tags", () => {
    const p = postProcess({
      rewriteOutput: {
        rewrittenHtml: "<h2>Ripping fun</h2><p>A responsive board with <strong>edge tech</strong>.</p>",
        changes: ["Tightened the opening sentence"],
      },
      factCheck: { factsPreserved: true, addedClaims: [] },
    });
    expect(p.field).toBe("descriptionHtml");
    expect(p.after).not.toContain("<h2>");
    expect(p.after).not.toContain("<strong>");
    expect(p.after).toContain("Ripping fun");
    expect(p.after).toContain("edge tech");
    expect(p.after).toContain("<p>");
  });

  it("always reports textPreserved false so the gate stages it", () => {
    const p = postProcess({
      rewriteOutput: { rewrittenHtml: "<p>Better copy.</p>", changes: [] },
      factCheck: { factsPreserved: true, addedClaims: [] },
    });
    expect(p.recipe).toBe("content-rewriter");
    expect(p.textPreserved).toBe(false);
  });

  it("carries a clean fact-check verdict", () => {
    const p = postProcess({
      rewriteOutput: { rewrittenHtml: "<p>Better copy.</p>", changes: ["Fixed grammar"] },
      factCheck: { factsPreserved: true, addedClaims: [] },
    });
    expect(p.factCheck).toEqual({ factsPreserved: true, addedClaims: [] });
    expect(p.agentReason).toBe("Fixed grammar");
  });

  it("carries a failed fact-check verdict with the added claims", () => {
    const p = postProcess({
      rewriteOutput: { rewrittenHtml: "<p>Waterproof to 50m.</p>", changes: [] },
      factCheck: {
        factsPreserved: false,
        addedClaims: ["Claims waterproof to 50m; the original never states this."],
      },
    });
    expect(p.factCheck?.factsPreserved).toBe(false);
    expect(p.factCheck?.addedClaims).toHaveLength(1);
    expect(p.agentReason).toBe("Rewrote prose for clarity.");
  });
});
