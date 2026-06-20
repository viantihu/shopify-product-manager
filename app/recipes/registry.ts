export const RECIPES = {
  "description-formatter": { version: "1", field: "descriptionHtml" },
  "product-type-inferrer": { version: "1", field: "productType" },
  "seo-meta-generator": { version: "1", field: "seo" },
  "image-alt-text": { version: "1", field: "imageAltText" },
} as const;

export type RecipeId = keyof typeof RECIPES;

export function recipeRef(id: RecipeId): string {
  return `${id}@${RECIPES[id].version}`;
}
