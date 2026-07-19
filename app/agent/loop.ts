// app/agent/loop.ts
import type { ProductSnapshot } from "../lib/product.server";
import type { RecipeProposal } from "../recipes/types";
import type { DecisionRecord } from "../harness/apply";

export interface ModelTurn {
  stop_reason: string;
  toolCalls: { id: string; name: string; input: Record<string, unknown> }[];
}

export interface LoopDeps {
  complete: (messages: unknown[]) => Promise<ModelTurn>;
  readProduct: (productId: string) => Promise<ProductSnapshot>;
  runRecipe: Record<string, (product: ProductSnapshot, input: Record<string, unknown>) => Promise<RecipeProposal | RecipeProposal[]>>;
  proposeChange: (args: { jobId: string; product: ProductSnapshot; proposal: RecipeProposal }) => Promise<DecisionRecord>;
  maxSteps: number;
}

// Maps the model-facing tool name to the recipe key in deps.runRecipe.
// Exported so a wiring test can assert the closed-registry chain stays
// consistent (every recipe tool routes to a real dispatch handler).
export const RECIPE_TOOL: Record<string, string> = {
  format_description: "format-description",
  rewrite_description: "rewrite-description",
  optimize_marketing_copy: "marketing-optimizer",
  infer_product_type: "infer-product-type",
  generate_seo_meta: "generate-seo-meta",
  suggest_image_alt_text: "suggest-image-alt-text",
};

export interface LoopResult {
  snapshot: ProductSnapshot | null;
  trace: { turn: number; toolCalls: ModelTurn["toolCalls"]; results: unknown[] }[];
  decisions: DecisionRecord[];
}

export async function runAgentLoop(args: {
  jobId: string;
  productId: string;
  deps: LoopDeps;
}): Promise<LoopResult> {
  const { jobId, productId, deps } = args;
  const messages: unknown[] = [{ role: "user", content: `Complete product ${productId}.` }];
  const trace: LoopResult["trace"] = [];
  const decisions: DecisionRecord[] = [];
  let snapshot: ProductSnapshot | null = null;

  for (let step = 0; step < deps.maxSteps; step++) {
    const turn = await deps.complete(messages);
    const results: unknown[] = [];

    if (turn.stop_reason !== "tool_use") {
      trace.push({ turn: step, toolCalls: [], results });
      break;
    }

    let finished = false;
    // Exactly one result is pushed per tool call, so results[i] aligns with
    // toolCalls[i]. Task 10's adapter relies on this index pairing to build
    // tool_result blocks — keep it 1:1 if you add branches here.
    for (const call of turn.toolCalls) {
      if (call.name === "finish") {
        finished = true;
        results.push({ ok: true });
        continue;
      }
      if (call.name === "get_product") {
        snapshot = await deps.readProduct(productId);
        results.push(snapshot);
        continue;
      }
      if (call.name === "assess_completeness") {
        results.push({ recorded: true });
        continue;
      }
      const recipeKey = RECIPE_TOOL[call.name];
      if (recipeKey && snapshot) {
        const out = await deps.runRecipe[recipeKey](snapshot, call.input);
        const proposals = Array.isArray(out) ? out : [out];
        for (const proposal of proposals) {
          const decision = await deps.proposeChange({ jobId, product: snapshot, proposal });
          decisions.push(decision);
        }
        results.push({ proposed: proposals.length });
        continue;
      }
      if (recipeKey) {
        // Recipe tool called before get_product ran — the model mis-sequenced.
        results.push({ error: "call get_product before running recipes" });
        continue;
      }
      results.push({ error: `unhandled tool ${call.name}` });
    }

    trace.push({ turn: step, toolCalls: turn.toolCalls, results });
    // Feed tool results back so the model can reason on the next turn.
    messages.push({
      role: "assistant",
      content: turn.toolCalls.map((c) => ({ type: "tool_use", id: c.id, name: c.name, input: c.input })),
    });
    messages.push({
      role: "user",
      content: turn.toolCalls.map((c, i) => ({
        type: "tool_result",
        tool_use_id: c.id,
        content: JSON.stringify(results[i] ?? { ok: true }),
      })),
    });
    if (finished) break;
  }

  return { snapshot, trace, decisions };
}
