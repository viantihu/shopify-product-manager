// app/recipes/types.ts
import type { RecipeId } from "./registry";

export interface RecipeProposal {
  recipe: RecipeId;
  version: string;
  field: string;        // logical field name (descriptionHtml | productType | seo | imageAltText)
  after: string;        // proposed value (JSON-encoded for structured fields like seo / imageAltText)
  agentReason: string;  // short human-readable rationale
  textPreserved: boolean; // gate factor; recipes that don't transform prose set true
}
