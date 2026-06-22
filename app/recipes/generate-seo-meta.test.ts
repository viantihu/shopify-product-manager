// app/recipes/generate-seo-meta.test.ts
import { describe, it, expect } from "vitest";
import { toProposal } from "./generate-seo-meta";

describe("seo-meta-generator toProposal", () => {
  it("JSON-encodes title+description into the after field", () => {
    const p = toProposal({
      title: "Bamboo Water Bottle | EcoLife",
      description: "Sustainable 100% bamboo water bottle. Free shipping.",
      reason: "filled empty SEO",
    });
    expect(p.recipe).toBe("seo-meta-generator");
    expect(p.field).toBe("seo");
    expect(JSON.parse(p.after)).toEqual({
      title: "Bamboo Water Bottle | EcoLife",
      description: "Sustainable 100% bamboo water bottle. Free shipping.",
    });
    expect(p.textPreserved).toBe(true);
  });
});
