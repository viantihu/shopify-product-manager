// app/harness/decisions.server.ts
import db from "../db.server";
import type { Decision } from "@prisma/client";
import type { NewDecision } from "./apply";

// Accepts the NewDecision shape proposeChange produces. The returned Prisma
// Decision is a structural superset of DecisionRecord, so it satisfies
// ApplyDeps.createDecision's return type without a cast.
export function createDecision(data: NewDecision): Promise<Decision> {
  return db.decision.create({ data });
}

// Despite the name, this returns every reviewable/visible decision — i.e. all
// statuses EXCEPT the reserved `rolled_back`. The review UI splits these into
// "needs review" (staged) vs. settled (everything else) itself. `superseded` is
// the loser of a two-recipes-one-field composed write (see product-review.ts);
// it is settled, so it belongs in this visible set.
export function listStagedAndApplied(): Promise<Decision[]> {
  return db.decision.findMany({
    where: {
      status: { in: ["staged", "applied", "approved", "edited", "rejected", "superseded"] },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}

// Every decision for one product, most-recent first. The per-product review page
// folds these into a single composed view (product-review.ts); the ordering lets
// the fold pick the most-recent decision within a recipe as the winner.
export function listDecisionsForProduct(productId: string): Promise<Decision[]> {
  return db.decision.findMany({
    where: { productId },
    orderBy: { createdAt: "desc" },
  });
}

export function getDecision(id: string): Promise<Decision | null> {
  return db.decision.findUnique({ where: { id } });
}

// Records a reviewer's verdict on a decision. Injected into applyReviewedDecision
// (app/harness/apply.ts) as its updateDecision dep, keeping apply.ts the only
// module that both writes to Shopify and stamps the verdict.
export function updateDecision(
  id: string,
  data: { status: string; reviewerVerdict: string; finalValue: string; reviewedAt: Date },
): Promise<Decision> {
  return db.decision.update({ where: { id }, data });
}
