import type { RecipeId } from "../recipes/registry";

export interface ProposedChange {
  recipe: RecipeId;
  version: string;
  field: string;
  before: string | null;
  after: string;
  productId: string;
  agentReason: string;
  /** Recipe-supplied factor: did visible text survive unchanged? */
  textPreserved: boolean;
}

export interface GateResult {
  decision: "auto" | "stage";
  reason: string;
}

/**
 * Atomic gate: ALL factors must clear for "auto", else "stage". Factors are
 * static today (keyed by recipe). Later this reads a trust report card
 * (coverage, replay, reviewer agreement, volume) — that swap touches only this
 * function because its signature already carries recipe + version.
 */
export function gate(change: ProposedChange): GateResult {
  const factors: boolean[] = [];

  if (change.recipe === "description-formatter") {
    factors.push(change.textPreserved);
  } else {
    // Default-deny: any recipe not explicitly trusted to auto-apply stages.
    factors.push(false);
  }

  const allPass = factors.every(Boolean);
  return allPass
    ? { decision: "auto", reason: `${change.recipe} cleared all gate factors.` }
    : {
        decision: "stage",
        reason: `${change.recipe} did not clear the gate; staged for review.`,
      };
}
