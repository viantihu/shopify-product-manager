// app/recipes/types.ts
import type { RecipeId } from "./registry";

export interface RecipeProposal {
  recipe: RecipeId;
  version: string;
  field: string;        // logical field name (descriptionHtml | productType | seo | imageAltText)
  after: string;        // proposed value (JSON-encoded for structured fields like seo / imageAltText)
  agentReason: string;  // short human-readable rationale
  textPreserved: boolean; // gate factor; recipes that don't transform prose set true
  // Recorded verdict from the content-rewriter's second-pass fact-check. Data
  // for the reviewer (and a future trust report card), never a gate factor.
  factCheck?: { factsPreserved: boolean; addedClaims: string[] };
  // Reviewer-facing marketing coaching notes from the marketing-optimizer:
  // best-practice suggestions that need merchant input (a testimonial, a
  // sensory detail) and are therefore NEVER written into `after`. Like
  // factCheck, this is recorded reviewer data and never a gate factor.
  coachingNotes?: string[];
}
