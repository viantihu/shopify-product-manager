import { describe, it, expect } from "vitest";
import {
  productAdminUrl,
  productLabel,
  fieldLabel,
  groupDecisionsByProduct,
  numericProductId,
  productGid,
  skuLabel,
  type DecisionView,
} from "./product-changes";

function decision(overrides: Partial<DecisionView> = {}): DecisionView {
  return {
    id: "dec_1",
    productId: "gid://shopify/Product/1",
    productTitle: "Bottle",
    recipe: "description-formatter",
    field: "descriptionHtml",
    status: "applied",
    agentReason: "structure",
    factCheck: null,
    ...overrides,
  };
}

describe("productAdminUrl", () => {
  it("builds an App Bridge deep-link from a product gid", () => {
    expect(productAdminUrl("gid://shopify/Product/123")).toBe(
      "shopify://admin/products/123",
    );
  });

  it("returns empty string for a malformed gid", () => {
    expect(productAdminUrl("not-a-gid")).toBe("");
    expect(productAdminUrl("")).toBe("");
  });
});

describe("productLabel", () => {
  it("prefers the title when present", () => {
    expect(productLabel("gid://shopify/Product/1", "Bottle")).toBe("Bottle");
  });

  it("falls back to the numeric id when the title is missing", () => {
    expect(productLabel("gid://shopify/Product/42", null)).toBe("Product 42");
    expect(productLabel("gid://shopify/Product/42", "  ")).toBe("Product 42");
  });

  it("falls back to a generic label when the id is unusable too", () => {
    expect(productLabel("garbage", null)).toBe("Untitled product");
  });
});

describe("productGid / numericProductId round-trip", () => {
  it("reconstructs a gid from a numeric id", () => {
    expect(productGid("42")).toBe("gid://shopify/Product/42");
  });

  it("round-trips with numericProductId", () => {
    const gid = productGid("123")!;
    expect(numericProductId(gid)).toBe("123");
  });

  it("returns null for a non-numeric segment so a bad URL 404s", () => {
    expect(productGid("abc")).toBeNull();
    expect(productGid("")).toBeNull();
    expect(productGid("12x")).toBeNull();
  });
});

describe("fieldLabel", () => {
  it("maps known logical fields to plain-English labels", () => {
    expect(fieldLabel("descriptionHtml")).toBe("Description");
    expect(fieldLabel("productType")).toBe("Product type");
    expect(fieldLabel("seo")).toBe("SEO");
    expect(fieldLabel("imageAltText")).toBe("Image alt text");
  });

  it("passes through an unknown field unchanged", () => {
    expect(fieldLabel("mysteryField")).toBe("mysteryField");
  });
});

describe("skuLabel", () => {
  it("returns a single-variant SKU as-is", () => {
    expect(skuLabel({ sku: "ABC-123", additionalCount: 0 })).toBe("ABC-123");
  });

  it("appends '+N more' for a multi-variant product", () => {
    expect(skuLabel({ sku: "ABC-123", additionalCount: 2 })).toBe("ABC-123 +2 more");
  });

  it("returns empty string when the SKU summary is absent", () => {
    expect(skuLabel(undefined)).toBe("");
  });

  it("returns empty string when the product has no SKU", () => {
    expect(skuLabel({ sku: null, additionalCount: 3 })).toBe("");
  });
});

describe("groupDecisionsByProduct", () => {
  it("buckets a product with any staged change into needsReview", () => {
    const { needsReview, updated } = groupDecisionsByProduct([
      decision({ id: "a", status: "staged" }),
    ]);
    expect(needsReview).toHaveLength(1);
    expect(updated).toHaveLength(0);
    expect(needsReview[0].hasStaged).toBe(true);
    expect(needsReview[0].adminUrl).toBe("shopify://admin/products/1");
  });

  it("buckets a product with only settled changes into updated", () => {
    const { needsReview, updated } = groupDecisionsByProduct([
      decision({ id: "a", status: "applied" }),
    ]);
    expect(needsReview).toHaveLength(0);
    expect(updated).toHaveLength(1);
    expect(updated[0].hasStaged).toBe(false);
  });

  it("treats a superseded change as settled (updated bucket, not needsReview)", () => {
    const { needsReview, updated } = groupDecisionsByProduct([
      decision({ id: "a", status: "superseded" }),
    ]);
    expect(needsReview).toHaveLength(0);
    expect(updated).toHaveLength(1);
    expect(updated[0].hasStaged).toBe(false);
  });

  it("collapses multiple changes on the same product into one group", () => {
    const { needsReview } = groupDecisionsByProduct([
      decision({ id: "a", field: "descriptionHtml", status: "staged" }),
      decision({ id: "b", field: "seo", status: "applied" }),
    ]);
    expect(needsReview).toHaveLength(1);
    expect(needsReview[0].changes).toHaveLength(2);
    // A single staged change pulls the whole product into needsReview.
    expect(needsReview[0].hasStaged).toBe(true);
  });

  it("carries the fabrication flag through from the fact-check verdict", () => {
    const { needsReview } = groupDecisionsByProduct([
      decision({
        id: "a",
        status: "staged",
        recipe: "content-rewriter",
        factCheck: JSON.stringify({ factsPreserved: false, addedClaims: ["waterproof"] }),
      }),
    ]);
    expect(needsReview[0].changes[0].flagged).toBe(true);
  });

  it("does not flag a clean fact-check or malformed json", () => {
    const { updated } = groupDecisionsByProduct([
      decision({ id: "a", factCheck: JSON.stringify({ factsPreserved: true, addedClaims: [] }) }),
      decision({ id: "b", productId: "gid://shopify/Product/2", factCheck: "{not json" }),
    ]);
    expect(updated[0].changes[0].flagged).toBe(false);
    expect(updated[1].changes[0].flagged).toBe(false);
  });

  it("preserves the input (most-recent-first) product order", () => {
    const { updated } = groupDecisionsByProduct([
      decision({ id: "a", productId: "gid://shopify/Product/3", productTitle: "Third" }),
      decision({ id: "b", productId: "gid://shopify/Product/1", productTitle: "First" }),
    ]);
    expect(updated.map((g) => g.productTitle)).toEqual(["Third", "First"]);
  });
});
