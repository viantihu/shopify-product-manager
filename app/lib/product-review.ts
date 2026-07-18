// app/lib/product-review.ts
//
// Pure fold for the per-product review page. Given every Decision row for one
// product, produce a single composed view: ONE description to edit (with all
// recipes' contributions resolved to a single seed) plus the non-description
// fields as separate editable pieces. No React/Prisma imports so the fold is
// unit-testable in isolation (mirrors product-changes.ts).
//
// Composition model = "fold + editor composes" (see
// docs-private/specs/2026-07-18-per-product-review-spec.md). Recipes stay
// single-field and untouched; this module never writes. The human rich-text
// editor is the real composition surface — this just picks what seeds it.
import { productAdminUrl, productLabel } from "./product-changes";

// The subset of a Decision row the fold reads. Prisma's Decision is a structural
// superset, so a real row satisfies this without a cast.
export interface ReviewDecision {
  id: string;
  productId: string;
  productTitle: string | null;
  recipe: string;
  field: string;
  status: string;
  before: string | null;
  after: string;
  finalValue: string | null;
  agentReason: string;
  factCheck: string | null;
}

// The single description to edit. `seed` is the HTML that seeds the rich-text
// editor; `before` is the pristine snapshot the winning decision captured.
// `loserDecisionIds` are other live description decisions (a competing staged
// rewrite, or an already-applied formatter) that the composed write supersedes.
export interface DescriptionPiece {
  decisionId: string;
  recipe: string;
  before: string | null;
  seed: string;
  agentReason: string;
  factCheck: { factsPreserved: boolean; addedClaims: string[] } | null;
  loserDecisionIds: string[];
}

// A non-description scalar field (productType or seo) shown as its own editable
// piece. `value` is in the field's writer shape: raw text for productType, JSON
// for seo.
export interface FieldPiece {
  decisionId: string;
  field: "productType" | "seo";
  before: string | null;
  value: string;
  agentReason: string;
}

// One image's alt text. `mediaId` is parsed out so the write targets the right
// image; `previousAlt` is the old alt from the before-image, for display.
export interface AltPiece {
  decisionId: string;
  mediaId: string;
  previousAlt: string | null;
  alt: string;
  agentReason: string;
}

// A decision already settled (applied/edited/approved/rejected/superseded),
// shown read-only for context — "these recipes also ran." Excludes the rows
// represented by the editable description piece above.
export interface SettledChange {
  decisionId: string;
  field: string;
  recipe: string;
  status: string;
}

export interface ProductReviewComposition {
  productId: string;
  productTitle: string;
  adminUrl: string;
  description: DescriptionPiece | null;
  productType: FieldPiece | null;
  seo: FieldPiece | null;
  imageAltText: AltPiece[];
  settled: SettledChange[];
  hasStaged: boolean; // any editable piece exists → there is something to review
}

// Lower rank wins the description seed: the rewriter's better words beat the
// formatter's structure (the reviewer re-adds structure in the editor). Any
// other recipe writing descriptionHtml (none today) ranks last.
function descriptionRank(recipe: string): number {
  if (recipe === "content-rewriter") return 0;
  if (recipe === "description-formatter") return 1;
  return 2;
}

function parseFactCheck(
  raw: string | null,
): { factsPreserved: boolean; addedClaims: string[] } | null {
  if (raw == null) return null;
  try {
    const v = JSON.parse(raw) as { factsPreserved?: boolean; addedClaims?: string[] };
    return {
      factsPreserved: v.factsPreserved ?? true,
      addedClaims: v.addedClaims ?? [],
    };
  } catch {
    return null;
  }
}

/**
 * Fold a product's decisions (expected most-recent-first, as
 * listDecisionsForProduct returns) into a single composed review view.
 */
export function composeProductReview(decisions: ReviewDecision[]): ProductReviewComposition {
  const first = decisions[0];
  const productId = first?.productId ?? "";
  const productTitle = productLabel(productId, first?.productTitle ?? null);
  const adminUrl = productAdminUrl(productId);

  const staged = decisions.filter((d) => d.status === "staged");

  // --- Description: pick one winner among staged description decisions. ---
  const stagedDesc = staged.filter((d) => d.field === "descriptionHtml");
  let description: DescriptionPiece | null = null;
  if (stagedDesc.length > 0) {
    // Lowest rank wins; ties broken by most-recent, which is input order since
    // the list is most-recent-first. reduce keeps the first-seen on a tie.
    const winner = stagedDesc.reduce((best, d) =>
      descriptionRank(d.recipe) < descriptionRank(best.recipe) ? d : best,
    );
    // Losers = every OTHER description decision in a live state (another staged
    // rewrite, or an already-applied formatter in the auto-then-supersede edge).
    // Settled description rows (edited/approved/rejected/superseded) are history
    // and left alone.
    const loserDecisionIds = decisions
      .filter(
        (d) =>
          d.field === "descriptionHtml" &&
          d.id !== winner.id &&
          (d.status === "staged" || d.status === "applied"),
      )
      .map((d) => d.id);
    description = {
      decisionId: winner.id,
      recipe: winner.recipe,
      before: winner.before,
      seed: winner.finalValue ?? winner.after,
      agentReason: winner.agentReason,
      factCheck: parseFactCheck(winner.factCheck),
      loserDecisionIds,
    };
  }

  // --- productType / seo: most-recent staged decision for each field. ---
  const pickField = (field: "productType" | "seo"): FieldPiece | null => {
    const d = staged.find((x) => x.field === field);
    if (!d) return null;
    return {
      decisionId: d.id,
      field,
      before: d.before,
      value: d.finalValue ?? d.after,
      agentReason: d.agentReason,
    };
  };

  // --- imageAltText: one piece per staged image decision. ---
  const imageAltText: AltPiece[] = [];
  for (const d of staged) {
    if (d.field !== "imageAltText") continue;
    let mediaId: string;
    let alt: string;
    try {
      const parsed = JSON.parse(d.finalValue ?? d.after) as { mediaId: string; alt?: string };
      mediaId = parsed.mediaId;
      alt = parsed.alt ?? "";
    } catch {
      continue; // malformed row: not editable here (still visible on the index)
    }
    let previousAlt: string | null = null;
    if (d.before != null) {
      try {
        previousAlt = (JSON.parse(d.before) as { alt?: string | null }).alt ?? null;
      } catch {
        previousAlt = null;
      }
    }
    imageAltText.push({ decisionId: d.id, mediaId, previousAlt, alt, agentReason: d.agentReason });
  }

  const description_ = description;
  const editableIds = new Set<string>(
    [
      description_?.decisionId,
      ...(description_?.loserDecisionIds ?? []),
      ...imageAltText.map((a) => a.decisionId),
    ].filter((x): x is string => Boolean(x)),
  );
  const productType = pickField("productType");
  const seo = pickField("seo");
  if (productType) editableIds.add(productType.decisionId);
  if (seo) editableIds.add(seo.decisionId);

  // Settled context = every non-staged row not already represented above.
  const settled: SettledChange[] = decisions
    .filter((d) => d.status !== "staged" && !editableIds.has(d.id))
    .map((d) => ({ decisionId: d.id, field: d.field, recipe: d.recipe, status: d.status }));

  const hasStaged =
    description !== null || productType !== null || seo !== null || imageAltText.length > 0;

  return {
    productId,
    productTitle,
    adminUrl,
    description,
    productType,
    seo,
    imageAltText,
    settled,
    hasStaged,
  };
}
