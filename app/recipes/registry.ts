export const RECIPES = {
  "description-formatter": { version: "1", field: "descriptionHtml" },
  "product-type-inferrer": { version: "1", field: "productType" },
  "seo-meta-generator": { version: "1", field: "seo" },
  "image-alt-text": { version: "1", field: "imageAltText" },
  "content-rewriter": { version: "1", field: "descriptionHtml" },
  "marketing-optimizer": { version: "1", field: "descriptionHtml" },
  // Detector, not a transformer: flags a description that describes a DIFFERENT
  // product than its title/type/vendor. Its field `descriptionMatch` has NO
  // writer in apply.ts — a mismatch is review-only and never written.
  "description-validator": { version: "1", field: "descriptionMatch" },
} as const;

export type RecipeId = keyof typeof RECIPES;

export function recipeRef(id: RecipeId): string {
  return `${id}@${RECIPES[id].version}`;
}
