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

describe("composeProductReview — advisories (description-validator)", () => {
  const mismatch = (over: Partial<ReviewDecision> = {}) =>
    dec({
      id: "adv",
      field: "descriptionMatch",
      recipe: "description-validator",
      agentReason: "Description may describe a different product.",
      after: JSON.stringify({
        reason: "Copy describes a merino sweater; product is a snowboard.",
        evidence: ["merino wool", "machine washable"],
      }),
      before: "<p>Soft merino wool sweater.</p>",
      ...over,
    });

  it("surfaces a staged mismatch as an advisory, parsing reason/evidence/before", () => {
    const c = composeProductReview([mismatch()]);
    expect(c.advisories).toHaveLength(1);
    expect(c.advisories[0]).toEqual({
      decisionId: "adv",
      reason: "Copy describes a merino sweater; product is a snowboard.",
      evidence: ["merino wool", "machine washable"],
      before: "<p>Soft merino wool sweater.</p>",
    });
  });

  it("needs review on a flag alone: hasStaged true, hasWritable false", () => {
    const c = composeProductReview([mismatch()]);
    expect(c.hasStaged).toBe(true);
    expect(c.hasWritable).toBe(false);
    // A review-only flag is never an editable description piece.
    expect(c.description).toBeNull();
    // Nor is it duplicated into settled context.
    expect(c.settled.map((s) => s.decisionId)).not.toContain("adv");
  });

  it("falls back to agentReason when the finding JSON is malformed", () => {
    const c = composeProductReview([mismatch({ after: "not json" })]);
    expect(c.advisories).toHaveLength(1);
    expect(c.advisories[0].reason).toBe("Description may describe a different product.");
    expect(c.advisories[0].evidence).toEqual([]);
  });

  it("coexists with a writable piece: both an advisory and a description to apply", () => {
    const c = composeProductReview([
      mismatch(),
      dec({ id: "fmt", recipe: "description-formatter", after: "<h2>Structured</h2>" }),
    ]);
    expect(c.advisories).toHaveLength(1);
    expect(c.description?.decisionId).toBe("fmt");
    expect(c.hasWritable).toBe(true);
    expect(c.hasStaged).toBe(true);
  });

  it("a settled (dismissed/acknowledged) flag is history, not an advisory", () => {
    const c = composeProductReview([mismatch({ status: "dismissed" })]);
    expect(c.advisories).toHaveLength(0);
    expect(c.hasStaged).toBe(false);
    expect(c.settled.map((s) => s.decisionId)).toContain("adv");
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
