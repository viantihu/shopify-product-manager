// Closed-registry wiring contract. Adding a recipe means threading it through
// several files (tools spec -> RECIPE_TOOL map -> dispatch handler -> registry);
// miss one and the agent either can't call the tool or crashes the loop at
// runtime. These assertions catch that class of bug deterministically, without
// a live LLM or database.
import { describe, it, expect } from "vitest";
import { TOOLS } from "./tools";
import { RECIPE_TOOL } from "./loop";
import { runRecipe } from "./recipe-dispatch.server";
import { RECIPES } from "../recipes/registry";

// Tools that are handled inline in the loop, not routed to a recipe.
const NON_RECIPE_TOOLS = new Set([
  "get_product",
  "assess_completeness",
  "finish",
]);

describe("closed-registry wiring", () => {
  it("routes every recipe tool through RECIPE_TOOL to a real dispatch handler", () => {
    for (const tool of TOOLS) {
      if (NON_RECIPE_TOOLS.has(tool.name)) continue;
      const recipeKey = RECIPE_TOOL[tool.name];
      expect(recipeKey, `tool ${tool.name} has no RECIPE_TOOL entry`).toBeDefined();
      expect(
        runRecipe[recipeKey as keyof typeof runRecipe],
        `RECIPE_TOOL[${tool.name}] -> ${recipeKey} has no dispatch handler`,
      ).toBeTypeOf("function");
    }
  });

  it("every RECIPE_TOOL entry points at an exposed tool and a real handler", () => {
    const toolNames = new Set(TOOLS.map((t) => t.name));
    for (const [toolName, recipeKey] of Object.entries(RECIPE_TOOL)) {
      expect(toolNames.has(toolName), `RECIPE_TOOL tool ${toolName} not in TOOLS`).toBe(true);
      expect(runRecipe[recipeKey as keyof typeof runRecipe]).toBeTypeOf("function");
    }
  });

  it("exposes the marketing-optimizer end to end (tool, map, dispatch, registry)", () => {
    expect(TOOLS.some((t) => t.name === "optimize_marketing_copy")).toBe(true);
    expect(RECIPE_TOOL.optimize_marketing_copy).toBe("marketing-optimizer");
    expect(runRecipe["marketing-optimizer"]).toBeTypeOf("function");
    expect(RECIPES["marketing-optimizer"]).toEqual({
      version: "1",
      field: "descriptionHtml",
    });
  });
});
