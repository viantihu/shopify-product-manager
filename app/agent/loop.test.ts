// app/agent/loop.test.ts
import { describe, it, expect, vi } from "vitest";
import { runAgentLoop, type LoopDeps } from "./loop";
import type { ProductSnapshot } from "../lib/product.server";
import type { RecipeProposal } from "../recipes/types";

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

  // --- Description-write guard: the three description-writing tools are blocked
  // until validate_description runs clean this run. ---

  // Scripts one tool call per turn, in order, then finish.
  function scriptTools(names: string[]) {
    const turns = [
      ...names.map((name, i) => ({
        stop_reason: "tool_use",
        toolCalls: [{ id: `t${i}`, name, input: {} }],
      })),
      { stop_reason: "tool_use", toolCalls: [{ id: "tf", name: "finish", input: {} }] },
    ];
    let i = 0;
    return vi.fn(async () => turns[i++]);
  }

  // A validator handler whose proposal count we control: [] = clean, [flag] = mismatch.
  const validatorReturning = (proposals: RecipeProposal[]) => vi.fn(async () => proposals);
  const mismatchFlag: RecipeProposal = {
    recipe: "description-validator",
    version: "1",
    field: "descriptionMatch",
    after: JSON.stringify({ reason: "wrong product", evidence: [] }),
    agentReason: "wrong product",
    textPreserved: false,
  };
  const formatProposal: RecipeProposal = {
    recipe: "description-formatter",
    version: "1",
    field: "descriptionHtml",
    after: "<p>formatted</p>",
    agentReason: "restored structure",
    textPreserved: true,
  };

  function guardDeps(
    complete: LoopDeps["complete"],
    validatorProposals: RecipeProposal[],
  ): LoopDeps {
    return {
      complete,
      readProduct: vi.fn(async () => product),
      runRecipe: {
        "description-validator": validatorReturning(validatorProposals),
        "format-description": vi.fn(async () => formatProposal),
      } as never,
      proposeChange: vi.fn(async (p) => ({ id: "dec", status: "staged", ...p.proposal }) as never),
      maxSteps: 10,
    };
  }

  it("blocks a description-write tool called before validate_description", async () => {
    const deps = guardDeps(scriptTools(["get_product", "format_description"]), []);
    const result = await runAgentLoop({ jobId: "j", productId: product.id, deps });
    // format_description never dispatched → nothing proposed.
    expect(deps.proposeChange).not.toHaveBeenCalled();
    const formatTurn = result.trace.find((t) => t.toolCalls[0]?.name === "format_description");
    expect(formatTurn?.results[0]).toMatchObject({
      error: expect.stringContaining("validate_description first"),
    });
  });

  it("unblocks description-write tools after a clean validation", async () => {
    const deps = guardDeps(
      scriptTools(["get_product", "validate_description", "format_description"]),
      [], // clean: no mismatch
    );
    const result = await runAgentLoop({ jobId: "j", productId: product.id, deps });
    // Only the formatter proposes; the clean validator proposes nothing.
    expect(deps.proposeChange).toHaveBeenCalledTimes(1);
    const formatTurn = result.trace.find((t) => t.toolCalls[0]?.name === "format_description");
    expect(formatTurn?.results[0]).toEqual({ proposed: 1 });
  });

  it("keeps description-write tools blocked after a flagged mismatch", async () => {
    const deps = guardDeps(
      scriptTools(["get_product", "validate_description", "format_description"]),
      [mismatchFlag], // mismatch: leaves writers blocked
    );
    const result = await runAgentLoop({ jobId: "j", productId: product.id, deps });
    // Only the validator's flag is proposed; the formatter stays blocked.
    expect(deps.proposeChange).toHaveBeenCalledTimes(1);
    expect((deps.proposeChange as ReturnType<typeof vi.fn>).mock.calls[0][0].proposal.field).toBe(
      "descriptionMatch",
    );
    const formatTurn = result.trace.find((t) => t.toolCalls[0]?.name === "format_description");
    expect(formatTurn?.results[0]).toMatchObject({
      error: expect.stringContaining("validate_description first"),
    });
  });

  it("blocks a description-write tool emitted in the SAME turn as validate_description", async () => {
    // Both tools in one turn: the write tool must still be blocked because the
    // clean flag only flips AFTER validate_description runs within the loop pass.
    const complete = (() => {
      const turns = [
        { stop_reason: "tool_use", toolCalls: [{ id: "t0", name: "get_product", input: {} }] },
        {
          stop_reason: "tool_use",
          toolCalls: [
            { id: "t1", name: "format_description", input: {} },
            { id: "t2", name: "validate_description", input: {} },
          ],
        },
        { stop_reason: "tool_use", toolCalls: [{ id: "tf", name: "finish", input: {} }] },
      ];
      let i = 0;
      return vi.fn(async () => turns[i++]);
    })();
    const deps = guardDeps(complete, []);
    const result = await runAgentLoop({ jobId: "j", productId: product.id, deps });
    // The clean validator proposes nothing; the same-turn format is blocked.
    expect(deps.proposeChange).not.toHaveBeenCalled();
    const sameTurn = result.trace.find((t) => t.toolCalls.length === 2);
    // results[0] aligns with format_description (index 0 in the turn).
    expect(sameTurn?.results[0]).toMatchObject({
      error: expect.stringContaining("validate_description first"),
    });
    expect(sameTurn?.results[1]).toEqual({ proposed: 0 });
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
