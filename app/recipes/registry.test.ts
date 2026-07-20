import { describe, it, expect } from "vitest";
import { RECIPES, recipeRef } from "./registry";

describe("recipe registry", () => {
  it("exposes the seven completeness recipes with versions", () => {
    expect(Object.keys(RECIPES).sort()).toEqual([
      "content-rewriter",
      "description-formatter",
      "description-validator",
      "image-alt-text",
      "marketing-optimizer",
      "product-type-inferrer",
      "seo-meta-generator",
    ]);
  });

  it("formats a recipe ref as id@version", () => {
    expect(recipeRef("description-formatter")).toBe("description-formatter@1");
  });
});
