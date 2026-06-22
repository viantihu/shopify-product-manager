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
// "needs review" (staged) vs. settled (everything else) itself.
export function listStagedAndApplied(): Promise<Decision[]> {
  return db.decision.findMany({
    where: { status: { in: ["staged", "applied", "approved", "edited", "rejected"] } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}

export function getDecision(id: string): Promise<Decision | null> {
  return db.decision.findUnique({ where: { id } });
}
