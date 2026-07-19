import { describe, it, expect } from "vitest";
import { postProcess } from "./marketing-optimizer";

describe("marketing-optimizer postProcess", () => {
  it("sanitizes to the p/br allowlist, keeping the text of stripped tags", () => {
    const p = postProcess({
      marketingOutput: {
        rewrittenHtml:
          "<h2>Ride harder</h2><p>You get a board with <strong>proven edge grip</strong>.</p>",
        changes: ["Led with the benefit"],
        coachingNotes: [],
      },
      factCheck: { factsPreserved: true, addedClaims: [] },
    });
    expect(p.field).toBe("descriptionHtml");
    expect(p.after).not.toContain("<h2>");
    expect(p.after).not.toContain("<strong>");
    expect(p.after).toContain("Ride harder");
    expect(p.after).toContain("proven edge grip");
    expect(p.after).toContain("<p>");
  });

  it("always reports textPreserved false so the gate stages it", () => {
    const p = postProcess({
      marketingOutput: { rewrittenHtml: "<p>Better copy.</p>", changes: [], coachingNotes: [] },
      factCheck: { factsPreserved: true, addedClaims: [] },
    });
    expect(p.recipe).toBe("marketing-optimizer");
    expect(p.textPreserved).toBe(false);
  });

  it("carries the coaching notes for the reviewer", () => {
    const notes = [
      "No social proof present — a customer testimonial would build trust here.",
      "No sensory language — describe how the fabric feels.",
    ];
    const p = postProcess({
      marketingOutput: {
        rewrittenHtml: "<p>Better copy.</p>",
        changes: ["Reframed features as benefits"],
        coachingNotes: notes,
      },
      factCheck: { factsPreserved: true, addedClaims: [] },
    });
    expect(p.coachingNotes).toEqual(notes);
    expect(p.agentReason).toBe("Reframed features as benefits");
  });

  it("keeps coachingNotes an empty array when the model found no gaps", () => {
    const p = postProcess({
      marketingOutput: { rewrittenHtml: "<p>Better copy.</p>", changes: [], coachingNotes: [] },
      factCheck: { factsPreserved: true, addedClaims: [] },
    });
    expect(p.coachingNotes).toEqual([]);
  });

  it("carries a fact-check verdict and falls back to a default reason", () => {
    const p = postProcess({
      marketingOutput: { rewrittenHtml: "<p>Waterproof to 50m.</p>", changes: [], coachingNotes: [] },
      factCheck: {
        factsPreserved: false,
        addedClaims: ["Claims waterproof to 50m; the original never states this."],
      },
    });
    expect(p.factCheck?.factsPreserved).toBe(false);
    expect(p.factCheck?.addedClaims).toHaveLength(1);
    expect(p.agentReason).toBe("Sharpened copy toward marketing best practices.");
  });
});
