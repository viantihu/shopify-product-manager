// app/lib/product-changes.ts
//
// Pure presentation helpers for the admin index. The index used to list one row
// per Decision ("recipe X ran"); these fold the flat decision list into
// per-product groups so the page can be organized around the product that
// changed, not the recipe that ran. Kept free of React/Prisma imports so the
// logic is unit-testable in isolation.

// The subset of a Decision row the index actually renders. Prisma's Decision is
// a structural superset, so a real row satisfies this without a cast.
export interface DecisionView {
  id: string;
  productId: string;
  productTitle: string | null;
  recipe: string;
  field: string;
  status: string;
  agentReason: string;
  factCheck: string | null;
}

export interface ProductChange {
  id: string;
  field: string;
  recipe: string;
  status: string;
  agentReason: string;
  flagged: boolean; // fact-check found claims the original never states
}

export interface ProductGroup {
  productId: string;
  productTitle: string; // resolved display label; never empty
  adminUrl: string; // "" when productId is malformed → caller renders plain text
  changes: ProductChange[];
  hasStaged: boolean;
}

export interface GroupedDecisions {
  needsReview: ProductGroup[]; // products with at least one staged change
  updated: ProductGroup[]; // products whose changes are all settled
}

/** Pull the numeric id out of a `gid://shopify/Product/123` GraphQL id. */
export function numericProductId(productId: string): string | null {
  const match = /gid:\/\/shopify\/Product\/(\d+)/.exec(productId);
  return match ? match[1] : null;
}

/**
 * Reconstruct the full GraphQL id from a numeric product id. The per-product
 * review route carries the numeric id in its URL (no slashes to encode); the
 * loader reconstructs the gid to query Decision rows, whose productId is stored
 * as the full gid. Returns null for a non-numeric segment so a bad URL 404s
 * rather than querying a malformed id.
 */
export function productGid(numericId: string): string | null {
  return /^\d+$/.test(numericId) ? `gid://shopify/Product/${numericId}` : null;
}

/**
 * App Bridge deep-link to a product's page in the Shopify admin. App Bridge
 * intercepts the `shopify://admin/...` scheme and navigates the top-level admin,
 * so no shop domain is needed (see the `shopify://admin/products/123456` form
 * documented on shopify-app-react-router's redirect helper). Returns "" for a
 * malformed or empty gid so the caller can fall back to plain text instead of a
 * dead link.
 */
export function productAdminUrl(productId: string): string {
  const id = numericProductId(productId);
  return id ? `shopify://admin/products/${id}` : "";
}

/** Human-facing display label for a product with a possibly-missing title. */
export function productLabel(productId: string, title: string | null): string {
  if (title && title.trim() !== "") return title;
  const id = numericProductId(productId);
  return id ? `Product ${id}` : "Untitled product";
}

/** Plain-English label for a logical field name (what changed on the product). */
export function fieldLabel(field: string): string {
  switch (field) {
    case "descriptionHtml":
      return "Description";
    case "productType":
      return "Product type";
    case "seo":
      return "SEO";
    case "imageAltText":
      return "Image alt text";
    default:
      return field;
  }
}

/** The content-rewriter records a fact-check verdict; true when it flagged an
 * added claim the original never states. Any other recipe (null factCheck) or
 * malformed JSON is treated as not flagged. */
function isFlagged(factCheck: string | null): boolean {
  if (factCheck == null) return false;
  try {
    return (JSON.parse(factCheck) as { factsPreserved?: boolean }).factsPreserved === false;
  } catch {
    return false;
  }
}

/**
 * Fold a flat, already-sorted (most-recent-first) decision list into per-product
 * groups, split into products needing review vs. recently updated. Product order
 * follows first appearance in the input, so the caller's ordering is preserved.
 */
export function groupDecisionsByProduct(decisions: DecisionView[]): GroupedDecisions {
  const order: string[] = [];
  const byProduct = new Map<string, ProductGroup>();

  for (const d of decisions) {
    let group = byProduct.get(d.productId);
    if (!group) {
      group = {
        productId: d.productId,
        productTitle: productLabel(d.productId, d.productTitle),
        adminUrl: productAdminUrl(d.productId),
        changes: [],
        hasStaged: false,
      };
      byProduct.set(d.productId, group);
      order.push(d.productId);
    }
    group.changes.push({
      id: d.id,
      field: d.field,
      recipe: d.recipe,
      status: d.status,
      agentReason: d.agentReason,
      flagged: isFlagged(d.factCheck),
    });
    if (d.status === "staged") group.hasStaged = true;
  }

  const needsReview: ProductGroup[] = [];
  const updated: ProductGroup[] = [];
  for (const id of order) {
    const group = byProduct.get(id)!;
    (group.hasStaged ? needsReview : updated).push(group);
  }
  return { needsReview, updated };
}
