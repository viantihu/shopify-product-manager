// app/harness/apply.ts
import { gate, type ProposedChange } from "./gate";
import type { RecipeProposal } from "../recipes/types";
import type { ProductSnapshot } from "../lib/product.server";

type AdminGraphql = (
  query: string,
  options?: { variables?: Record<string, unknown> },
) => Promise<Response>;

export interface Writers {
  writeDescription: (a: AdminGraphql, id: string, html: string) => Promise<void>;
  writeProductType: (a: AdminGraphql, id: string, t: string) => Promise<void>;
  writeSeo: (a: AdminGraphql, id: string, seo: { title: string; description: string }) => Promise<void>;
  writeImageAlt: (a: AdminGraphql, id: string, mediaId: string, alt: string) => Promise<void>;
}

export interface DecisionRecord {
  id: string;
  jobId: string;
  productId: string;
  productTitle: string | null;
  recipe: string;
  version: string;
  field: string;
  before: string | null;
  after: string;
  agentReason: string;
  gateDecision: string;
  gateReason: string;
  status: string;
  factCheck: string | null; // JSON verdict from the content-rewriter; null otherwise
  coachingNotes: string | null; // JSON string[] from the marketing-optimizer; null otherwise
}

// The fields proposeChange supplies when recording a decision. Structurally a
// subset of Prisma's DecisionUncheckedCreateInput, so the real createDecision
// (Task 8 Step 3) satisfies this without a cast.
export type NewDecision = Omit<DecisionRecord, "id">;

export interface ApplyDeps {
  createDecision: (d: NewDecision) => Promise<DecisionRecord>;
  writers: Writers;
  admin?: AdminGraphql; // required in production; omitted in unit tests, where the fake writers ignore it
}

/**
 * Compute the before-image string for a proposal's field. For `seo` and
 * `imageAltText`, `p.after` is trusted recipe output and is JSON.parsed here; a
 * malformed `after` throws (loud, not silent). The worker (Task 10) owns the
 * try/catch that turns such a throw into a failed Job.
 */
function beforeImage(product: ProductSnapshot, p: RecipeProposal): string | null {
  switch (p.field) {
    case "descriptionHtml":
      return product.descriptionHtml;
    // Review-only field from the description-validator: the before-image is the
    // flagged description so the reviewer sees what was questioned. There is
    // deliberately NO performWrite case for descriptionMatch — a mismatch never
    // writes, and the default throw in performWrite is the safety net if a write
    // is ever wrongly attempted.
    case "descriptionMatch":
      return product.descriptionHtml;
    case "productType":
      return product.productType;
    case "seo":
      return JSON.stringify({ title: product.seoTitle, description: product.seoDescription });
    case "imageAltText": {
      const { mediaId } = JSON.parse(p.after) as { mediaId: string };
      const img = product.images.find((i) => i.mediaId === mediaId);
      return JSON.stringify({ mediaId, alt: img?.altText ?? null });
    }
    default:
      return null;
  }
}

/**
 * Dispatch one field's value to its Shopify writer. Shared by the two write
 * paths — `proposeChange` (agent auto-apply, `value` = proposal.after) and
 * `applyReviewedDecision` (human review, `value` = the reviewer's finalValue).
 * `value` is always in the field's writer shape: HTML for descriptionHtml, raw
 * text for productType, JSON for seo/imageAltText. Malformed JSON throws loudly.
 */
async function performWrite(
  admin: AdminGraphql,
  writers: Writers,
  productId: string,
  field: string,
  value: string,
): Promise<void> {
  switch (field) {
    case "descriptionHtml":
      return writers.writeDescription(admin, productId, value);
    case "productType":
      return writers.writeProductType(admin, productId, value);
    case "seo":
      return writers.writeSeo(admin, productId, JSON.parse(value));
    case "imageAltText": {
      const { mediaId, alt } = JSON.parse(value) as { mediaId: string; alt: string };
      return writers.writeImageAlt(admin, productId, mediaId, alt);
    }
    default:
      throw new Error(`No writer for field ${field}`);
  }
}

// A no-op admin used when none is injected (unit tests, where the fake writers
// ignore the admin argument). Keeps the writer call shape identical — a defined
// first arg — without performing any network I/O.
const noopAdmin: AdminGraphql = async () => new Response(null);

/** The single funnel: before-image → gate → record Decision → maybe write. */
export async function proposeChange(args: {
  jobId: string;
  product: ProductSnapshot;
  proposal: RecipeProposal;
  deps: ApplyDeps;
}): Promise<DecisionRecord> {
  const { jobId, product, proposal, deps } = args;
  const before = beforeImage(product, proposal);

  const change: ProposedChange = {
    recipe: proposal.recipe,
    version: proposal.version,
    field: proposal.field,
    before,
    after: proposal.after,
    productId: product.id,
    agentReason: proposal.agentReason,
    textPreserved: proposal.textPreserved,
  };
  const verdict = gate(change);
  const willApply = verdict.decision === "auto";

  const decision = await deps.createDecision({
    jobId,
    productId: product.id,
    productTitle: product.title,
    recipe: proposal.recipe,
    version: proposal.version,
    field: proposal.field,
    before,
    after: proposal.after,
    agentReason: proposal.agentReason,
    gateDecision: verdict.decision,
    gateReason: verdict.reason,
    status: willApply ? "applied" : "staged",
    factCheck: proposal.factCheck ? JSON.stringify(proposal.factCheck) : null,
    coachingNotes: proposal.coachingNotes ? JSON.stringify(proposal.coachingNotes) : null,
  });

  // Auto-write goes through the injected writers. `deps.admin` is required in
  // production (Task 10) but omitted in unit tests, where the fake writers
  // ignore the admin argument. The funnel decision is gate-driven (willApply);
  // admin is merely the transport passed through to the writers. When absent we
  // pass a no-op admin so the call shape stays the same (a defined first arg)
  // without performing any network I/O.
  if (willApply) {
    await performWrite(
      deps.admin ?? noopAdmin,
      deps.writers,
      product.id,
      proposal.field,
      proposal.after,
    );
  }
  return decision;
}

// The subset of a Decision row applyReviewedDecision needs to write and record a
// human verdict. Prisma's Decision is a structural superset, so a real row
// satisfies this without a cast.
export interface ReviewableDecision {
  id: string;
  productId: string;
  field: string;
}

export interface ReviewDeps {
  writers: Writers;
  // Records the verdict on the decision row. Injectable so unit tests can assert
  // what was persisted without a database (mirrors createDecision). Returns
  // Promise<unknown> so the real Prisma updateDecision (returns the row) and a
  // test fake (returns nothing) both satisfy it — apply.ts ignores the result.
  updateDecision: (
    id: string,
    data: {
      status: string;
      reviewerVerdict: string;
      finalValue: string;
      reviewedAt: Date;
    },
  ) => Promise<unknown>;
  admin?: AdminGraphql; // required in production; omitted in unit tests
}

/**
 * The human-review write path: apply a reviewer's decision to one field and
 * record the verdict. This is the sibling of proposeChange — where that funnels
 * an agent proposal through the gate, this funnels a human's approve/edit
 * through the same field writers. The gate is deliberately NOT consulted: a
 * human verdict is authoritative and is never re-gated or auto-applied.
 *
 * `verdict` is a writing verdict only — "agree" (ship the agent's value as-is)
 * or "edit" (ship the reviewer's finalValue). Reject performs no write and is
 * handled by the caller, so it never reaches here. `reviewedAt` is supplied by
 * the caller so every field of one multi-field product submit shares a single
 * instant (a soft audit grouping); stamping it here would let sibling writes
 * drift apart.
 */
export async function applyReviewedDecision(args: {
  decision: ReviewableDecision;
  verdict: "agree" | "edit";
  finalValue: string;
  reviewedAt: Date;
  deps: ReviewDeps;
}): Promise<void> {
  const { decision, verdict, finalValue, reviewedAt, deps } = args;

  await performWrite(
    deps.admin ?? noopAdmin,
    deps.writers,
    decision.productId,
    decision.field,
    finalValue,
  );

  await deps.updateDecision(decision.id, {
    status: verdict === "edit" ? "edited" : "approved",
    reviewerVerdict: verdict,
    finalValue,
    reviewedAt,
  });
}
