import { describe, it, expect } from "vitest";
import { gate, type ProposedChange } from "./gate";

const base: ProposedChange = {
  recipe: "description-formatter",
  version: "1",
  field: "descriptionHtml",
  before: "old",
  after: "<p>old</p>",
  productId: "gid://shopify/Product/1",
  agentReason: "restored structure",
  textPreserved: true,
};

describe("autonomy gate", () => {
  it("auto-applies a description format that preserved text", () => {
    expect(gate(base).decision).toBe("auto");
  });

  it("stages a description format that did NOT preserve text", () => {
    expect(gate({ ...base, textPreserved: false }).decision).toBe("stage");
  });

  it("stages every subjective recipe regardless of other factors", () => {
    for (const recipe of [
      "seo-meta-generator",
      "product-type-inferrer",
      "image-alt-text",
    ] as const) {
      const result = gate({ ...base, recipe, textPreserved: true });
      expect(result.decision).toBe("stage");
    }
  });

  it("stages the content-rewriter via default-deny (words changed)", () => {
    const result = gate({ ...base, recipe: "content-rewriter", textPreserved: false });
    expect(result.decision).toBe("stage");
  });

  it("always returns a human-readable reason", () => {
    expect(gate(base).reason).toMatch(/\S/);
  });
});
