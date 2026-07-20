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
  validate_description: "description-validator",
  format_description: "format-description",
  rewrite_description: "rewrite-description",
  optimize_marketing_copy: "marketing-optimizer",
  infer_product_type: "infer-product-type",
  generate_seo_meta: "generate-seo-meta",
  suggest_image_alt_text: "suggest-image-alt-text",
};

// The three recipe tools that WRITE to the description field. They are blocked
// until validate_description has run and returned clean (no mismatch) this run —
// a deterministic backstop so a wrong-product description can never be reformatted
// or rewritten (and description-formatter can never auto-apply it) before a human
// resolves the flag. This closes the hole the system prompt alone cannot: the
// model could skip validation, or emit a write tool in the SAME turn as
// validate_description. See app/agent/system-prompt.ts for the prompt-level rule.
export const DESCRIPTION_WRITE_TOOLS = new Set([
  "format_description",
  "rewrite_description",
  "optimize_marketing_copy",
]);

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
  // Set true once validate_description runs and finds NO mismatch (0 proposals).
  // A flagged mismatch leaves this false, keeping the description-write tools
  // blocked. Run-scoped: one product per loop.
  let descriptionValidatedClean = false;

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
        // Guard: description edits are blocked until validation has run clean this
        // run. Return an error result (same affordance as the mis-sequence case
        // below) instead of dispatching, so nothing is proposed or written. This
        // fires even when the write tool is called in the same turn as
        // validate_description, since the flag only flips after that call runs.
        if (DESCRIPTION_WRITE_TOOLS.has(call.name) && !descriptionValidatedClean) {
          results.push({
            error:
              "run validate_description first; description edits are blocked until it passes clean",
          });
          continue;
        }
        const out = await deps.runRecipe[recipeKey](snapshot, call.input);
        const proposals = Array.isArray(out) ? out : [out];
        for (const proposal of proposals) {
          const decision = await deps.proposeChange({ jobId, product: snapshot, proposal });
          decisions.push(decision);
        }
        // A clean validation (no mismatch proposal) unblocks the description-write
        // tools; a flag (>=1 proposal) leaves them blocked.
        if (call.name === "validate_description") {
          descriptionValidatedClean = proposals.length === 0;
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
