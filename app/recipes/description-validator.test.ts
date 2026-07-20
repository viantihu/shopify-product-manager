// app/recipes/description-validator.test.ts
import { describe, it, expect } from "vitest";
import { postProcess, type MismatchFinding } from "./description-validator";

describe("description-validator postProcess", () => {
  it("returns an empty array when the description matches the product", () => {
    const proposals = postProcess({
      matches: true,
      reason: "Description discusses a snowboard, matching the title and type.",
      evidence: [],
    });
    expect(proposals).toEqual([]);
  });

  it("returns one review-only proposal on a mismatch", () => {
    const proposals = postProcess({
      matches: false,
      reason: "Description is about a merino sweater; title/type say Snowboard.",
      evidence: ["mentions merino wool and layering", "title/type: Snowboard"],
    });
    expect(proposals).toHaveLength(1);
    const p = proposals[0];
    expect(p.recipe).toBe("description-validator");
    expect(p.field).toBe("descriptionMatch");
    // Non-writing recipe stays on the default-deny (staged) path.
    expect(p.textPreserved).toBe(false);
    // One-line human summary lives in agentReason (the index renders this).
    expect(p.agentReason).toMatch(/sweater/i);
  });

  it("flags an incoherent claim (right product, impossible audience) the same way", () => {
    // Widened scope: the product IS a snowboard, but the copy says it is for
    // skiers — a claim that cannot be true of it. Same review-only flag shape as
    // a wrong-product mismatch; the postProcess path does not distinguish them.
    const proposals = postProcess({
      matches: false,
      reason: "Description says the snowboard is for skiers, which cannot be true of a snowboard.",
      evidence: ["says 'for avid skiers'", "product is a Snowboard, used by snowboarders"],
    });
    expect(proposals).toHaveLength(1);
    const p = proposals[0];
    expect(p.field).toBe("descriptionMatch");
    expect(p.textPreserved).toBe(false);
    expect(p.agentReason).toMatch(/skiers/i);
  });

  it("round-trips the structured finding through `after`", () => {
    const [p] = postProcess({
      matches: false,
      reason: "Wrong product.",
      evidence: ["a", "b"],
    });
    const finding = JSON.parse(p.after) as MismatchFinding;
    expect(finding.reason).toBe("Wrong product.");
    expect(finding.evidence).toEqual(["a", "b"]);
  });

  it("falls back to a default summary when the model omits a reason", () => {
    const [p] = postProcess({ matches: false, reason: "", evidence: [] });
    expect(p.agentReason).toMatch(/misrepresent/i);
  });
});
