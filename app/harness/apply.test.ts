// app/harness/apply.test.ts
import { describe, it, expect, vi } from "vitest";
import {
  proposeChange,
  applyReviewedDecision,
  type ApplyDeps,
  type ReviewDeps,
} from "./apply";
import type { RecipeProposal } from "../recipes/types";
import type { ProductSnapshot } from "../lib/product.server";

const product: ProductSnapshot = {
  id: "gid://shopify/Product/1",
  title: "Bottle",
  descriptionHtml: "old",
  productType: "",
  vendor: "Acme",
  seoTitle: "",
  seoDescription: "",
  images: [],
};

function deps(overrides: Partial<ApplyDeps> = {}): ApplyDeps {
  return {
    createDecision: vi.fn(async (d) => ({ id: "dec_1", ...d })),
    writers: {
      writeDescription: vi.fn(async () => {}),
      writeProductType: vi.fn(async () => {}),
      writeSeo: vi.fn(async () => {}),
      writeImageAlt: vi.fn(async () => {}),
    },
    ...overrides,
  };
}

const fmt: RecipeProposal = {
  recipe: "description-formatter",
  version: "1",
  field: "descriptionHtml",
  after: "<p>old</p>",
  agentReason: "structure",
  textPreserved: true,
};

describe("proposeChange", () => {
  it("auto-applies a clean description format and writes to Shopify", async () => {
    const d = deps();
    const decision = await proposeChange({ jobId: "job_1", product, proposal: fmt, deps: d });
    expect(decision.gateDecision).toBe("auto");
    expect(decision.status).toBe("applied");
    expect(decision.before).toBe("old");
    expect(decision.productTitle).toBe("Bottle");
    expect(d.writers.writeDescription).toHaveBeenCalledWith(
      expect.anything(),
      product.id,
      "<p>old</p>",
    );
  });

  it("stages a subjective change and does NOT write", async () => {
    const d = deps();
    const seo: RecipeProposal = {
      recipe: "seo-meta-generator",
      version: "1",
      field: "seo",
      after: JSON.stringify({ title: "T", description: "D" }),
      agentReason: "filled seo",
      textPreserved: true,
    };
    const decision = await proposeChange({ jobId: "job_1", product, proposal: seo, deps: d });
    expect(decision.gateDecision).toBe("stage");
    expect(decision.status).toBe("staged");
    expect(d.writers.writeSeo).not.toHaveBeenCalled();
  });

  it("stages a description format that changed wording", async () => {
    const d = deps();
    const decision = await proposeChange({
      jobId: "job_1",
      product,
      proposal: { ...fmt, textPreserved: false },
      deps: d,
    });
    expect(decision.gateDecision).toBe("stage");
    expect(d.writers.writeDescription).not.toHaveBeenCalled();
  });
});

function reviewDeps(overrides: Partial<ReviewDeps> = {}): ReviewDeps {
  return {
    writers: {
      writeDescription: vi.fn(async () => {}),
      writeProductType: vi.fn(async () => {}),
      writeSeo: vi.fn(async () => {}),
      writeImageAlt: vi.fn(async () => {}),
    },
    updateDecision: vi.fn(async () => {}),
    ...overrides,
  };
}

const reviewedAt = new Date("2026-07-18T00:00:00.000Z");

describe("applyReviewedDecision", () => {
  it("edits a description: writes the reviewer's HTML and records the verdict", async () => {
    const d = reviewDeps();
    await applyReviewedDecision({
      decision: { id: "dec_1", productId: product.id, field: "descriptionHtml" },
      verdict: "edit",
      finalValue: "<p>reworded</p>",
      reviewedAt,
      deps: d,
    });
    expect(d.writers.writeDescription).toHaveBeenCalledWith(
      expect.anything(),
      product.id,
      "<p>reworded</p>",
    );
    expect(d.updateDecision).toHaveBeenCalledWith("dec_1", {
      status: "edited",
      reviewerVerdict: "edit",
      finalValue: "<p>reworded</p>",
      reviewedAt,
    });
  });

  it("approves as-is: records status 'approved' and the exact reviewedAt passed in", async () => {
    const d = reviewDeps();
    await applyReviewedDecision({
      decision: { id: "dec_2", productId: product.id, field: "productType" },
      verdict: "agree",
      finalValue: "Outerwear",
      reviewedAt,
      deps: d,
    });
    expect(d.writers.writeProductType).toHaveBeenCalledWith(
      expect.anything(),
      product.id,
      "Outerwear",
    );
    const [, recorded] = (d.updateDecision as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(recorded.status).toBe("approved");
    expect(recorded.reviewerVerdict).toBe("agree");
    expect(recorded.reviewedAt).toBe(reviewedAt);
  });

  it("routes structured fields through the right writer (seo JSON)", async () => {
    const d = reviewDeps();
    await applyReviewedDecision({
      decision: { id: "dec_3", productId: product.id, field: "seo" },
      verdict: "edit",
      finalValue: JSON.stringify({ title: "T", description: "D" }),
      reviewedAt,
      deps: d,
    });
    expect(d.writers.writeSeo).toHaveBeenCalledWith(expect.anything(), product.id, {
      title: "T",
      description: "D",
    });
  });

  it("does NOT record when the write throws (no verdict on a failed write)", async () => {
    const d = reviewDeps({
      writers: {
        writeDescription: vi.fn(async () => {
          throw new Error("productUpdate failed");
        }),
        writeProductType: vi.fn(async () => {}),
        writeSeo: vi.fn(async () => {}),
        writeImageAlt: vi.fn(async () => {}),
      },
    });
    await expect(
      applyReviewedDecision({
        decision: { id: "dec_4", productId: product.id, field: "descriptionHtml" },
        verdict: "edit",
        finalValue: "<p>x</p>",
        reviewedAt,
        deps: d,
      }),
    ).rejects.toThrow("productUpdate failed");
    expect(d.updateDecision).not.toHaveBeenCalled();
  });
});
