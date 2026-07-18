// app/harness/apply.test.ts
import { describe, it, expect, vi } from "vitest";
import { proposeChange, type ApplyDeps } from "./apply";
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
