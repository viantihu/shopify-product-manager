// app/agent/recipe-dispatch.server.ts
import type { ProductSnapshot } from "../lib/product.server";
import type { RecipeProposal } from "../recipes/types";
import * as fmt from "../recipes/format-description";
import * as rewrite from "../recipes/content-rewriter";
import * as type from "../recipes/infer-product-type";
import * as seo from "../recipes/generate-seo-meta";
import * as alt from "../recipes/suggest-image-alt-text";
import { DEFAULT_LEVEL, isFormattingLevel } from "../lib/formatting-levels";

export const runRecipe = {
  "format-description": (p: ProductSnapshot, input: Record<string, unknown>) => {
    const raw = String(input.level ?? DEFAULT_LEVEL);
    const level = isFormattingLevel(raw) ? raw : DEFAULT_LEVEL;
    return fmt.run({
      description: p.descriptionHtml,
      context: { title: p.title, productType: p.productType, vendor: p.vendor },
      level,
    });
  },
  "rewrite-description": (p: ProductSnapshot) =>
    rewrite.run({
      description: p.descriptionHtml,
      context: { title: p.title, productType: p.productType, vendor: p.vendor },
    }),
  "infer-product-type": (p: ProductSnapshot) =>
    type.run({ title: p.title, description: p.descriptionHtml, vendor: p.vendor }),
  "generate-seo-meta": (p: ProductSnapshot) =>
    seo.run({ title: p.title, description: p.descriptionHtml }),
  "suggest-image-alt-text": async (p: ProductSnapshot): Promise<RecipeProposal[]> => {
    const missing = p.images.filter((i) => !i.altText);
    return Promise.all(
      missing.map((img) =>
        alt.run({ productTitle: p.title, imageUrl: img.url, mediaId: img.mediaId }),
      ),
    );
  },
};
