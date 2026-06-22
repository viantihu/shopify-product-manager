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
  recipe: string;
  version: string;
  field: string;
  before: string | null;
  after: string;
  agentReason: string;
  gateDecision: string;
  gateReason: string;
  status: string;
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

async function performWrite(
  admin: AdminGraphql,
  writers: Writers,
  productId: string,
  p: RecipeProposal,
): Promise<void> {
  switch (p.field) {
    case "descriptionHtml":
      return writers.writeDescription(admin, productId, p.after);
    case "productType":
      return writers.writeProductType(admin, productId, p.after);
    case "seo":
      return writers.writeSeo(admin, productId, JSON.parse(p.after));
    case "imageAltText": {
      const { mediaId, alt } = JSON.parse(p.after) as { mediaId: string; alt: string };
      return writers.writeImageAlt(admin, productId, mediaId, alt);
    }
    default:
      throw new Error(`No writer for field ${p.field}`);
  }
}

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
    recipe: proposal.recipe,
    version: proposal.version,
    field: proposal.field,
    before,
    after: proposal.after,
    agentReason: proposal.agentReason,
    gateDecision: verdict.decision,
    gateReason: verdict.reason,
    status: willApply ? "applied" : "staged",
  });

  // Auto-write goes through the injected writers. `deps.admin` is required in
  // production (Task 10) but omitted in unit tests, where the fake writers
  // ignore the admin argument. The funnel decision is gate-driven (willApply);
  // admin is merely the transport passed through to the writers. When absent we
  // pass a no-op admin so the call shape stays the same (a defined first arg)
  // without performing any network I/O.
  if (willApply) {
    const admin: AdminGraphql =
      deps.admin ?? (async () => new Response(null));
    await performWrite(admin, deps.writers, product.id, proposal);
  }
  return decision;
}
