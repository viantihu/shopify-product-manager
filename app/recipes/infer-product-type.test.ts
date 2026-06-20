// app/recipes/infer-product-type.test.ts
import { describe, it, expect } from "vitest";
import { toProposal } from "./infer-product-type";

describe("product-type-inferrer toProposal", () => {
  it("wraps an inferred type as a productType proposal", () => {
    const p = toProposal({ productType: "Water Bottles", reason: "title mentions bottle" });
    expect(p.recipe).toBe("product-type-inferrer");
    expect(p.field).toBe("productType");
    expect(p.after).toBe("Water Bottles");
    expect(p.textPreserved).toBe(true);
    expect(p.agentReason).toMatch(/bottle/);
  });
});
