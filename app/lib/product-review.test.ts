// app/lib/product-review.test.ts
import { describe, it, expect } from "vitest";
import { composeProductReview, type ReviewDecision } from "./product-review";

const PID = "gid://shopify/Product/42";

// Build a ReviewDecision with sane defaults; override per test.
function dec(over: Partial<ReviewDecision>): ReviewDecision {
  return {
    id: "d",
    productId: PID,
    productTitle: "Wool Coat",
    recipe: "description-formatter",
    field: "descriptionHtml",
    status: "staged",
    before: "<p>old</p>",
    after: "<p>new</p>",
    finalValue: null,
    agentReason: "reason",
    factCheck: null,
    ...over,
  };
}

describe("composeProductReview — description winner", () => {
  it("picks the rewriter over the formatter when both staged, and lists the formatter as a loser", () => {
    const c = composeProductReview([
      dec({ id: "rw", recipe: "content-rewriter", after: "<p>reworded</p>" }),
      dec({ id: "fmt", recipe: "description-formatter", after: "<h2>Structured</h2>" }),
    ]);
    expect(c.description?.decisionId).toBe("rw");
    expect(c.description?.seed).toBe("<p>reworded</p>");
    expect(c.description?.loserDecisionIds).toEqual(["fmt"]);
  });

  it("uses the formatter when it is the only description decision", () => {
    const c = composeProductReview([dec({ id: "fmt", recipe: "description-formatter" })]);
    expect(c.description?.decisionId).toBe("fmt");
    expect(c.description?.loserDecisionIds).toEqual([]);
  });

  it("returns no description piece when no description decision is staged", () => {
    const c = composeProductReview([
      dec({ id: "t", field: "productType", recipe: "product-type-inferrer", after: "Outerwear" }),
    ]);
    expect(c.description).toBeNull();
  });

  it("prefers finalValue over after as the seed", () => {
    const c = composeProductReview([
      dec({ id: "rw", recipe: "content-rewriter", after: "<p>raw</p>", finalValue: "<p>final</p>" }),
    ]);
    expect(c.description?.seed).toBe("<p>final</p>");
  });

  it("carries the rewriter's fact-check onto the description piece", () => {
    const c = composeProductReview([
      dec({
        id: "rw",
        recipe: "content-rewriter",
        factCheck: JSON.stringify({ factsPreserved: false, addedClaims: ["waterproof"] }),
      }),
    ]);
    expect(c.description?.factCheck).toEqual({ factsPreserved: false, addedClaims: ["waterproof"] });
  });

  it("auto-then-supersede: rewriter staged wins, applied formatter is a loser to supersede", () => {
    const c = composeProductReview([
      dec({ id: "rw", recipe: "content-rewriter", status: "staged" }),
      dec({ id: "fmt", recipe: "description-formatter", status: "applied" }),
    ]);
    expect(c.description?.decisionId).toBe("rw");
    expect(c.description?.loserDecisionIds).toEqual(["fmt"]);
    // The applied loser is represented by the description piece, not duplicated
    // into the settled-context list.
    expect(c.settled.map((s) => s.decisionId)).not.toContain("fmt");
  });

  it("leaves a settled description decision as history, not a loser", () => {
    const c = composeProductReview([
      dec({ id: "rw", recipe: "content-rewriter", status: "staged" }),
      dec({ id: "old", recipe: "description-formatter", status: "edited" }),
    ]);
    expect(c.description?.loserDecisionIds).toEqual([]);
    expect(c.settled.map((s) => s.decisionId)).toContain("old");
  });
});

describe("composeProductReview — non-description fields", () => {
  it("passes productType and seo through as separate editable pieces", () => {
    const c = composeProductReview([
      dec({ id: "t", field: "productType", recipe: "product-type-inferrer", after: "Outerwear" }),
      dec({
        id: "s",
        field: "seo",
        recipe: "seo-meta-generator",
        after: JSON.stringify({ title: "T", description: "D" }),
      }),
    ]);
    expect(c.productType?.value).toBe("Outerwear");
    expect(c.seo?.value).toBe(JSON.stringify({ title: "T", description: "D" }));
    expect(c.description).toBeNull();
  });

  it("returns one alt piece per staged image, parsing mediaId and previous alt", () => {
    const c = composeProductReview([
      dec({
        id: "a1",
        field: "imageAltText",
        recipe: "image-alt-text",
        before: JSON.stringify({ mediaId: "gid://shopify/MediaImage/1", alt: null }),
        after: JSON.stringify({ mediaId: "gid://shopify/MediaImage/1", alt: "Front view" }),
      }),
      dec({
        id: "a2",
        field: "imageAltText",
        recipe: "image-alt-text",
        before: JSON.stringify({ mediaId: "gid://shopify/MediaImage/2", alt: "old" }),
        after: JSON.stringify({ mediaId: "gid://shopify/MediaImage/2", alt: "Back view" }),
      }),
    ]);
    expect(c.imageAltText).toHaveLength(2);
    expect(c.imageAltText[0]).toMatchObject({
      mediaId: "gid://shopify/MediaImage/1",
      previousAlt: null,
      alt: "Front view",
    });
    expect(c.imageAltText[1]).toMatchObject({
      mediaId: "gid://shopify/MediaImage/2",
      previousAlt: "old",
      alt: "Back view",
    });
  });

  it("skips a malformed image alt row rather than crashing", () => {
    const c = composeProductReview([
      dec({ id: "bad", field: "imageAltText", recipe: "image-alt-text", after: "not json" }),
    ]);
    expect(c.imageAltText).toHaveLength(0);
    expect(c.hasStaged).toBe(false);
  });
});

describe("composeProductReview — shape", () => {
  it("resolves title and admin url from the first decision", () => {
    const c = composeProductReview([dec({})]);
    expect(c.productTitle).toBe("Wool Coat");
    expect(c.adminUrl).toBe("shopify://admin/products/42");
  });

  it("hasStaged is false when nothing is staged", () => {
    const c = composeProductReview([dec({ status: "approved" })]);
    expect(c.hasStaged).toBe(false);
    expect(c.description).toBeNull();
    expect(c.settled).toHaveLength(1);
  });

  it("handles an empty decision list", () => {
    const c = composeProductReview([]);
    expect(c.hasStaged).toBe(false);
    expect(c.productId).toBe("");
    expect(c.description).toBeNull();
  });
});
