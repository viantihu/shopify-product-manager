// app/agent/loop.test.ts
import { describe, it, expect, vi } from "vitest";
import { runAgentLoop, type LoopDeps } from "./loop";
import type { ProductSnapshot } from "../lib/product.server";

const product: ProductSnapshot = {
  id: "gid://shopify/Product/1",
  title: "Bottle",
  descriptionHtml: "Flat text. Two sentences.",
  productType: "",
  vendor: "Acme",
  seoTitle: "",
  seoDescription: "",
  images: [],
};

// Scripted model: first turn calls get_product, second calls infer_product_type,
// third calls finish.
function scriptedComplete() {
  const turns = [
    { stop_reason: "tool_use", toolCalls: [{ id: "t1", name: "get_product", input: {} }] },
    {
      stop_reason: "tool_use",
      toolCalls: [{ id: "t2", name: "infer_product_type", input: {} }],
    },
    { stop_reason: "tool_use", toolCalls: [{ id: "t3", name: "finish", input: {} }] },
  ];
  let i = 0;
  return vi.fn(async () => turns[i++]);
}

describe("runAgentLoop", () => {
  it("runs tools until finish and collects a trace + decisions", async () => {
    const deps: LoopDeps = {
      complete: scriptedComplete(),
      readProduct: vi.fn(async () => product),
      runRecipe: {
        "infer-product-type": vi.fn(async () => ({
          recipe: "product-type-inferrer",
          version: "1",
          field: "productType",
          after: "Water Bottles",
          agentReason: "title implies a bottle",
          textPreserved: true,
        })),
      } as never,
      proposeChange: vi.fn(async (p) => ({ id: "dec_1", status: "staged", ...p.proposal }) as never),
      maxSteps: 10,
    };
    const result = await runAgentLoop({ jobId: "job_1", productId: product.id, deps });
    expect(result.snapshot).toEqual(product);
    expect(result.trace.length).toBe(3); // three model turns
    expect(deps.proposeChange).toHaveBeenCalledTimes(1);
    expect(result.decisions).toHaveLength(1);
  });

  it("stops at maxSteps even if the model never calls finish", async () => {
    const never = vi.fn(async () => ({
      stop_reason: "tool_use",
      toolCalls: [{ id: "x", name: "get_product", input: {} }],
    }));
    const deps: LoopDeps = {
      complete: never,
      readProduct: vi.fn(async () => product),
      runRecipe: {} as never,
      proposeChange: vi.fn(),
      maxSteps: 3,
    };
    const result = await runAgentLoop({ jobId: "job_1", productId: product.id, deps });
    expect(result.trace.length).toBe(3);
    expect(never).toHaveBeenCalledTimes(3);
  });
});
