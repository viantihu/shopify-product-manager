# Product Completeness Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the manual single-product formatter into an event-driven agent: a Shopify webhook enqueues a Job, an in-process worker runs a hand-rolled LLM agent loop over a closed/versioned tool registry, every proposed change passes an autonomy gate (auto-apply vs. stage), and staged changes are reviewed by a human — with all the data seams for trust-earned autonomy captured but no trust behavior built.

**Architecture:** Four isolated layers. **Trigger** (`webhooks.products.tsx`) validates HMAC and enqueues a `Job`. **Worker** (`worker/runner.ts`) polls the queue and runs the **Agent** (`agent/loop.ts` + `agent/tools.ts`). The agent proposes changes through the single **Harness** funnel (`harness/gate.ts` → `harness/apply.ts` → `Decision` log). The **Review** UI (`app._index.tsx`, `app.decision.$id.tsx`) shows auto-applied decisions read-only and lets a human approve/edit/reject staged ones.

**Tech Stack:** React Router 7 (Shopify app template), Prisma + SQLite, `@anthropic-ai/sdk` (tool use), Zod, Polaris web components, Vitest. Design spec: `docs/superpowers/specs/2026-06-20-product-completeness-agent-design.md`.

**Two refinements to the spec, adopted here (safety, not scope):**
1. `proposeChange` is a **server-side funnel function**, not a model-facing tool. Recipe tool *handlers* call it internally so the model cannot hand-edit a recipe's output before the gate. It is still the only path to the store.
2. SEO is written as **one `seo` change** (title + description together), because `productUpdate` with only one of the two can null the other.

---

## Conventions used throughout

- **Tests:** Vitest, files named `*.test.ts` next to the code, `environment: "node"` (already configured in `vitest.config.ts`). Run a single file with `npx vitest run app/path/file.test.ts`.
- **Server-only modules** keep the `.server.ts` suffix so the Anthropic key never bundles to the client. Pure logic that is unit-tested without Shopify/React Router context may omit `.server` (matches existing `formatting-levels.ts`, `sanitize.ts`).
- **Admin GraphQL client type** (matches existing `product.server.ts`):
  ```ts
  type AdminGraphql = (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
  ```
- **Recipe ids/versions** are constants, never inline strings.
- **Commit** after every green step. Use the `feat:`/`test:`/`chore:` prefixes already in the history.

---

## Task 0: Branch, dependencies, and prisma models

**Files:**
- Modify: `prisma/schema.prisma`
- Run: prisma migrate

- [ ] **Step 1: Create a working branch**

```bash
git checkout -b feat/product-completeness-agent
```

- [ ] **Step 2: Add the Job and Decision models to `prisma/schema.prisma`**

Append below the existing `Session` model:

```prisma
model Job {
  id            String     @id @default(cuid())
  productId     String
  shop          String
  trigger       String
  status        String     @default("queued")
  attempts      Int        @default(0)
  error         String?
  createdAt     DateTime   @default(now())
  startedAt     DateTime?
  finishedAt    DateTime?
  inputSnapshot Json?
  trace         Json?
  decisions     Decision[]
}

model Decision {
  id              String   @id @default(cuid())
  jobId           String
  job             Job      @relation(fields: [jobId], references: [id])
  productId       String
  recipe          String
  version         String
  field           String
  before          String?
  after           String
  agentReason     String
  gateDecision    String
  gateReason      String
  status          String
  reviewerVerdict String?
  finalValue      String?
  createdAt       DateTime @default(now())
  reviewedAt      DateTime?

  @@index([status])
  @@index([jobId])
}
```

- [ ] **Step 3: Create and apply the migration**

Run: `npx prisma migrate dev --name add_job_and_decision`
Expected: "Your database is now in sync with your schema", a new folder under `prisma/migrations/`, and the Prisma client regenerates.

- [ ] **Step 4: Verify the client typechecks**

Run: `npx prisma generate && npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "chore: add Job and Decision prisma models"
```

---

## Task 1: Recipe registry constants

**Files:**
- Create: `app/recipes/registry.ts`
- Test: `app/recipes/registry.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// app/recipes/registry.test.ts
import { describe, it, expect } from "vitest";
import { RECIPES, recipeRef } from "./registry";

describe("recipe registry", () => {
  it("exposes the four completeness recipes with versions", () => {
    expect(Object.keys(RECIPES).sort()).toEqual([
      "description-formatter",
      "image-alt-text",
      "product-type-inferrer",
      "seo-meta-generator",
    ]);
  });

  it("formats a recipe ref as id@version", () => {
    expect(recipeRef("description-formatter")).toBe("description-formatter@1");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run app/recipes/registry.test.ts`
Expected: FAIL — cannot find module `./registry`.

- [ ] **Step 3: Implement the registry**

```ts
// app/recipes/registry.ts
export const RECIPES = {
  "description-formatter": { version: "1", field: "descriptionHtml" },
  "product-type-inferrer": { version: "1", field: "productType" },
  "seo-meta-generator": { version: "1", field: "seo" },
  "image-alt-text": { version: "1", field: "imageAltText" },
} as const;

export type RecipeId = keyof typeof RECIPES;

export function recipeRef(id: RecipeId): string {
  return `${id}@${RECIPES[id].version}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run app/recipes/registry.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add app/recipes/registry.ts app/recipes/registry.test.ts
git commit -m "feat: recipe registry constants"
```

---

## Task 2: The autonomy gate (atomic structure, static factors)

**Files:**
- Create: `app/harness/gate.ts`
- Test: `app/harness/gate.test.ts`

The gate is the only decider of auto-vs-stage. Built atomic now (all factors must pass), with static factors keyed by recipe. `description-formatter` auto-applies **only if** its text-preservation check passed (the recipe reports this via `textPreserved`); every other recipe stages.

- [ ] **Step 1: Write the failing test**

```ts
// app/harness/gate.test.ts
import { describe, it, expect } from "vitest";
import { gate, type ProposedChange } from "./gate";

const base: ProposedChange = {
  recipe: "description-formatter",
  version: "1",
  field: "descriptionHtml",
  before: "old",
  after: "<p>old</p>",
  productId: "gid://shopify/Product/1",
  agentReason: "restored structure",
  textPreserved: true,
};

describe("autonomy gate", () => {
  it("auto-applies a description format that preserved text", () => {
    expect(gate(base).decision).toBe("auto");
  });

  it("stages a description format that did NOT preserve text", () => {
    expect(gate({ ...base, textPreserved: false }).decision).toBe("stage");
  });

  it("stages every subjective recipe regardless of other factors", () => {
    for (const recipe of [
      "seo-meta-generator",
      "product-type-inferrer",
      "image-alt-text",
    ] as const) {
      const result = gate({ ...base, recipe, textPreserved: true });
      expect(result.decision).toBe("stage");
    }
  });

  it("always returns a human-readable reason", () => {
    expect(gate(base).reason).toMatch(/\S/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run app/harness/gate.test.ts`
Expected: FAIL — cannot find module `./gate`.

- [ ] **Step 3: Implement the gate**

```ts
// app/harness/gate.ts
import type { RecipeId } from "../recipes/registry";

export interface ProposedChange {
  recipe: RecipeId;
  version: string;
  field: string;
  before: string | null;
  after: string;
  productId: string;
  agentReason: string;
  /** Recipe-supplied factor: did visible text survive unchanged? */
  textPreserved: boolean;
}

export interface GateResult {
  decision: "auto" | "stage";
  reason: string;
}

/**
 * Atomic gate: ALL factors must clear for "auto", else "stage". Factors are
 * static today (keyed by recipe). Later this reads a trust report card
 * (coverage, replay, reviewer agreement, volume) — that swap touches only this
 * function because its signature already carries recipe + version.
 */
export function gate(change: ProposedChange): GateResult {
  const factors: boolean[] = [];

  if (change.recipe === "description-formatter") {
    factors.push(change.textPreserved);
  } else {
    // Subjective recipes are not yet trusted to auto-apply.
    factors.push(false);
  }

  const allPass = factors.every(Boolean);
  return allPass
    ? { decision: "auto", reason: `${change.recipe} cleared all gate factors.` }
    : {
        decision: "stage",
        reason: `${change.recipe} did not clear the gate; staged for review.`,
      };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run app/harness/gate.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add app/harness/gate.ts app/harness/gate.test.ts
git commit -m "feat: autonomy gate (atomic structure, static factors)"
```

---

## Task 3: Shopify product read/write helpers

**Files:**
- Modify: `app/lib/product.server.ts` (replace draft-metafield helpers with completeness read + per-field writers)
- Test: none (thin GraphQL wrappers; covered by the end-to-end run in Task 12)

These are the only functions that talk to Shopify for product data. Keep the file to read + field writers. The `metafieldsSet`/`ensureDraftMetafieldDefinition`/`saveDraftAndReadBack` helpers from the old design are removed (the draft-metafield write path is gone). `applyToDescription` is generalized into the writers below.

- [ ] **Step 1: Replace the file contents**

```ts
// app/lib/product.server.ts
type AdminGraphql = (
  query: string,
  options?: { variables?: Record<string, unknown> },
) => Promise<Response>;

export interface ProductImage {
  mediaId: string; // gid://shopify/MediaImage/...
  url: string;
  altText: string | null;
}

export interface ProductSnapshot {
  id: string;
  title: string;
  descriptionHtml: string;
  productType: string;
  vendor: string;
  seoTitle: string;
  seoDescription: string;
  images: ProductImage[];
}

/** Read everything the agent and recipes need for one product. */
export async function readProduct(
  admin: AdminGraphql,
  productId: string,
): Promise<ProductSnapshot> {
  const res = await admin(
    `#graphql
    query ReadProduct($id: ID!) {
      product(id: $id) {
        id
        title
        descriptionHtml
        productType
        vendor
        seo { title description }
        media(first: 20) {
          nodes {
            ... on MediaImage {
              id
              alt
              image { url }
            }
          }
        }
      }
    }`,
    { variables: { id: productId } },
  );
  const body = await res.json();
  const p = body.data.product;
  const images: ProductImage[] = (p.media?.nodes ?? [])
    .filter((n: { id?: string }) => Boolean(n?.id))
    .map((n: { id: string; alt: string | null; image?: { url?: string } }) => ({
      mediaId: n.id,
      url: n.image?.url ?? "",
      altText: n.alt ?? null,
    }));
  return {
    id: p.id,
    title: p.title ?? "",
    descriptionHtml: p.descriptionHtml ?? "",
    productType: p.productType ?? "",
    vendor: p.vendor ?? "",
    seoTitle: p.seo?.title ?? "",
    seoDescription: p.seo?.description ?? "",
    images,
  };
}

async function productUpdate(
  admin: AdminGraphql,
  input: Record<string, unknown>,
): Promise<void> {
  const res = await admin(
    `#graphql
    mutation Apply($product: ProductUpdateInput!) {
      productUpdate(product: $product) {
        product { id }
        userErrors { field message }
      }
    }`,
    { variables: { product: input } },
  );
  const body = await res.json();
  const errors = body.data.productUpdate.userErrors;
  if (errors.length > 0) {
    throw new Error(`productUpdate failed: ${JSON.stringify(errors)}`);
  }
}

export function writeDescription(
  admin: AdminGraphql,
  productId: string,
  html: string,
): Promise<void> {
  return productUpdate(admin, { id: productId, descriptionHtml: html });
}

export function writeProductType(
  admin: AdminGraphql,
  productId: string,
  productType: string,
): Promise<void> {
  return productUpdate(admin, { id: productId, productType });
}

/** Title + description written together to avoid nulling the unspecified one. */
export function writeSeo(
  admin: AdminGraphql,
  productId: string,
  seo: { title: string; description: string },
): Promise<void> {
  return productUpdate(admin, { id: productId, seo });
}

/** Update alt text on one product image via its MediaImage id. */
export async function writeImageAlt(
  admin: AdminGraphql,
  productId: string,
  mediaId: string,
  alt: string,
): Promise<void> {
  const res = await admin(
    `#graphql
    mutation SetAlt($productId: ID!, $media: [UpdateMediaInput!]!) {
      productUpdateMedia(productId: $productId, media: $media) {
        media { ... on MediaImage { id alt } }
        mediaUserErrors { field message }
      }
    }`,
    { variables: { productId, media: [{ id: mediaId, alt }] } },
  );
  const body = await res.json();
  const errors = body.data.productUpdateMedia.mediaUserErrors;
  if (errors.length > 0) {
    throw new Error(`productUpdateMedia failed: ${JSON.stringify(errors)}`);
  }
}
```

- [ ] **Step 2: Remove the install-time metafield hook that referenced deleted code**

In `app/shopify.server.ts`, delete the `import { ensureDraftMetafieldDefinition } ...` line and replace the `hooks: { afterAuth: ... }` block with:

```ts
  // afterAuth intentionally omitted — no install-time setup needed for the
  // completeness agent (webhooks are declared in shopify.app.toml).
```

(If removing `hooks` entirely, also remove the now-unused block; ensure the `shopifyApp({...})` object still parses.)

- [ ] **Step 3: Verify typecheck**

Run: `npm run typecheck`
Expected: errors ONLY in files that still import the deleted helpers (`app/routes/app.format.tsx`, `app/routes/app._index.tsx`) — those are replaced in Tasks 9–11. No errors in `product.server.ts` or `shopify.server.ts`.

- [ ] **Step 4: Commit**

```bash
git add app/lib/product.server.ts app/shopify.server.ts
git commit -m "feat: product read snapshot + per-field writers; drop draft-metafield path"
```

---

## Task 4: `description-formatter` recipe

**Files:**
- Create: `app/recipes/format-description.ts` (moves logic from `app/lib/format-description.server.ts`)
- Move test: `app/recipes/format-description.test.ts` (from `app/lib/format-description.test.ts`)
- Delete: `app/lib/format-description.server.ts`, `app/lib/format-description.test.ts`
- Keep: `app/lib/sanitize.ts`, `app/lib/formatting-levels.ts`, `app/lib/format-prompt.ts`

A recipe exposes a pure `postProcess` (testable) and an async `run` (calls the LLM). `run` returns a `RecipeProposal` — the shape every recipe returns and `proposeChange` consumes.

- [ ] **Step 1: Define the shared recipe proposal type**

Create `app/recipes/types.ts`:

```ts
// app/recipes/types.ts
import type { RecipeId } from "./registry";

export interface RecipeProposal {
  recipe: RecipeId;
  version: string;
  field: string;        // logical field name (descriptionHtml | productType | seo | imageAltText)
  after: string;        // proposed value (JSON-encoded for structured fields like seo / imageAltText)
  agentReason: string;  // short human-readable rationale
  textPreserved: boolean; // gate factor; recipes that don't transform prose set true
}
```

- [ ] **Step 2: Create the recipe by moving the existing formatter logic**

```ts
// app/recipes/format-description.ts
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { type FormattingLevel, allowedTagsFor } from "../lib/formatting-levels";
import { buildPrompt, type ProductContext } from "../lib/format-prompt";
import { sanitizeHtml, textPreserved } from "../lib/sanitize";
import { RECIPES } from "./registry";
import type { RecipeProposal } from "./types";

export const FormatLlmSchema = z.object({
  formattedHtml: z.string(),
  changes: z.array(z.string()),
});
export type FormatLlmOutput = z.infer<typeof FormatLlmSchema>;

const ID = "description-formatter" as const;

/** Pure: sanitize for the level and compute the text-preservation factor. */
export function postProcess(input: {
  original: string;
  llmOutput: FormatLlmOutput;
  level: FormattingLevel;
}): RecipeProposal {
  const { original, llmOutput, level } = input;
  const formatted = sanitizeHtml(llmOutput.formattedHtml, allowedTagsFor(level));
  return {
    recipe: ID,
    version: RECIPES[ID].version,
    field: "descriptionHtml",
    after: formatted,
    agentReason: llmOutput.changes.join("; ") || "Restored formatting structure.",
    textPreserved: textPreserved(original, formatted),
  };
}

/** Call Claude, then post-process into a RecipeProposal. */
export async function run(input: {
  description: string;
  context: ProductContext;
  level: FormattingLevel;
}): Promise<RecipeProposal> {
  const client = new Anthropic();
  const model = process.env.LLM_MODEL ?? "claude-opus-4-8";
  const response = await client.messages.parse({
    model,
    max_tokens: 16000,
    messages: [{ role: "user", content: buildPrompt(input) }],
    output_config: { format: zodOutputFormat(FormatLlmSchema) },
  });
  const out = response.parsed_output;
  if (!out) throw new Error("description-formatter: invalid LLM output.");
  return postProcess({ original: input.description, llmOutput: out, level: input.level });
}
```

- [ ] **Step 3: Move and adapt the test**

Create `app/recipes/format-description.test.ts` (delete the old `app/lib/format-description.test.ts`):

```ts
import { describe, it, expect } from "vitest";
import { postProcess } from "./format-description";

const original = "Soft merino crew. Machine washable.";

describe("description-formatter postProcess", () => {
  it("sanitizes to the level allowlist and reports textPreserved", () => {
    const out = {
      formattedHtml: "<h2>Soft merino crew.</h2><ul><li>Machine washable.</li></ul>",
      changes: ["Added a heading", "Converted to a list"],
    };
    const p = postProcess({ original, llmOutput: out, level: "Balanced" });
    expect(p.field).toBe("descriptionHtml");
    expect(p.after).toContain("<h2>");
    expect(p.textPreserved).toBe(true);
  });

  it("strips forbidden tags (Light removes a heading) and stays text-preserved", () => {
    const out = { formattedHtml: "<h2>Soft merino crew.</h2><p>Machine washable.</p>", changes: [] };
    const p = postProcess({ original, llmOutput: out, level: "Light" });
    expect(p.after).not.toContain("<h2>");
    expect(p.textPreserved).toBe(true);
  });

  it("flags textPreserved=false when wording changed", () => {
    const out = { formattedHtml: "<p>Soft merino crew. Hand wash only.</p>", changes: [] };
    const p = postProcess({ original, llmOutput: out, level: "Light" });
    expect(p.textPreserved).toBe(false);
  });
});
```

- [ ] **Step 4: Delete the superseded module**

```bash
git rm app/lib/format-description.server.ts app/lib/format-description.test.ts
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run app/recipes/format-description.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add app/recipes/format-description.ts app/recipes/format-description.test.ts app/recipes/types.ts
git commit -m "feat: description-formatter recipe (moved from lib, returns RecipeProposal)"
```

---

## Task 5: `product-type-inferrer` recipe

**Files:**
- Create: `app/recipes/infer-product-type.ts`
- Test: `app/recipes/infer-product-type.test.ts`

- [ ] **Step 1: Write the failing test (pure builder only)**

```ts
// app/recipes/infer-product-type.test.ts
import { describe, it, expect } from "vitest";
import { toProposal } from "./infer-product-type";

describe("product-type-inferrer toProposal", () => {
  it("wraps an inferred type as a productType proposal", () => {
    const p = toProposal({ productType: "Water Bottles", reason: "title mentions bottle" });
    expect(p.recipe).toBe("product-type-inferrer");
    expect(p.field).toBe("productType");
    expect(p.after).toBe("Water Bottles");
    expect(p.textPreserved).toBe(true);
    expect(p.agentReason).toMatch(/bottle/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run app/recipes/infer-product-type.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement**

```ts
// app/recipes/infer-product-type.ts
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { RECIPES } from "./registry";
import type { RecipeProposal } from "./types";

export const TypeLlmSchema = z.object({
  productType: z.string(),
  reason: z.string(),
});
export type TypeLlmOutput = z.infer<typeof TypeLlmSchema>;

const ID = "product-type-inferrer" as const;

export function toProposal(out: TypeLlmOutput): RecipeProposal {
  return {
    recipe: ID,
    version: RECIPES[ID].version,
    field: "productType",
    after: out.productType,
    agentReason: out.reason,
    textPreserved: true,
  };
}

export async function run(input: {
  title: string;
  description: string;
  vendor: string;
}): Promise<RecipeProposal> {
  const client = new Anthropic();
  const model = process.env.LLM_MODEL ?? "claude-opus-4-8";
  const prompt = `Infer a concise Shopify product type (2-3 words, title case) for this product.
Title: ${input.title}
Vendor: ${input.vendor}
Description: ${input.description}
Return the product type and a one-line reason.`;
  const response = await client.messages.parse({
    model,
    max_tokens: 1000,
    messages: [{ role: "user", content: prompt }],
    output_config: { format: zodOutputFormat(TypeLlmSchema) },
  });
  const out = response.parsed_output;
  if (!out) throw new Error("product-type-inferrer: invalid LLM output.");
  return toProposal(out);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run app/recipes/infer-product-type.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add app/recipes/infer-product-type.ts app/recipes/infer-product-type.test.ts
git commit -m "feat: product-type-inferrer recipe"
```

---

## Task 6: `seo-meta-generator` recipe

**Files:**
- Create: `app/recipes/generate-seo-meta.ts`
- Test: `app/recipes/generate-seo-meta.test.ts`

SEO is one proposal whose `after` is JSON-encoded `{ title, description }` (the gate/apply layers treat `after` as an opaque string; the writer decodes it).

- [ ] **Step 1: Write the failing test**

```ts
// app/recipes/generate-seo-meta.test.ts
import { describe, it, expect } from "vitest";
import { toProposal } from "./generate-seo-meta";

describe("seo-meta-generator toProposal", () => {
  it("JSON-encodes title+description into the after field", () => {
    const p = toProposal({
      title: "Bamboo Water Bottle | EcoLife",
      description: "Sustainable 100% bamboo water bottle. Free shipping.",
      reason: "filled empty SEO",
    });
    expect(p.recipe).toBe("seo-meta-generator");
    expect(p.field).toBe("seo");
    expect(JSON.parse(p.after)).toEqual({
      title: "Bamboo Water Bottle | EcoLife",
      description: "Sustainable 100% bamboo water bottle. Free shipping.",
    });
    expect(p.textPreserved).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run app/recipes/generate-seo-meta.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement**

```ts
// app/recipes/generate-seo-meta.ts
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { RECIPES } from "./registry";
import type { RecipeProposal } from "./types";

export const SeoLlmSchema = z.object({
  title: z.string(),
  description: z.string(),
  reason: z.string(),
});
export type SeoLlmOutput = z.infer<typeof SeoLlmSchema>;

const ID = "seo-meta-generator" as const;

export function toProposal(out: SeoLlmOutput): RecipeProposal {
  return {
    recipe: ID,
    version: RECIPES[ID].version,
    field: "seo",
    after: JSON.stringify({ title: out.title, description: out.description }),
    agentReason: out.reason,
    textPreserved: true,
  };
}

export async function run(input: {
  title: string;
  description: string;
}): Promise<RecipeProposal> {
  const client = new Anthropic();
  const model = process.env.LLM_MODEL ?? "claude-opus-4-8";
  const prompt = `Write an SEO meta title (<= 60 chars) and meta description (<= 155 chars) for this product.
Product title: ${input.title}
Description: ${input.description}
Return title, description, and a one-line reason.`;
  const response = await client.messages.parse({
    model,
    max_tokens: 1000,
    messages: [{ role: "user", content: prompt }],
    output_config: { format: zodOutputFormat(SeoLlmSchema) },
  });
  const out = response.parsed_output;
  if (!out) throw new Error("seo-meta-generator: invalid LLM output.");
  return toProposal(out);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run app/recipes/generate-seo-meta.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add app/recipes/generate-seo-meta.ts app/recipes/generate-seo-meta.test.ts
git commit -m "feat: seo-meta-generator recipe"
```

---

## Task 7: `image-alt-text` recipe

**Files:**
- Create: `app/recipes/suggest-image-alt-text.ts`
- Test: `app/recipes/suggest-image-alt-text.test.ts`

One proposal per image lacking alt text; `after` is JSON-encoded `{ mediaId, alt }`.

- [ ] **Step 1: Write the failing test**

```ts
// app/recipes/suggest-image-alt-text.test.ts
import { describe, it, expect } from "vitest";
import { toProposal } from "./suggest-image-alt-text";

describe("image-alt-text toProposal", () => {
  it("encodes mediaId + alt and references the image in the reason", () => {
    const p = toProposal({
      mediaId: "gid://shopify/MediaImage/5",
      alt: "Black water bottle on a desk",
    });
    expect(p.recipe).toBe("image-alt-text");
    expect(p.field).toBe("imageAltText");
    expect(JSON.parse(p.after)).toEqual({
      mediaId: "gid://shopify/MediaImage/5",
      alt: "Black water bottle on a desk",
    });
    expect(p.textPreserved).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run app/recipes/suggest-image-alt-text.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement**

```ts
// app/recipes/suggest-image-alt-text.ts
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { RECIPES } from "./registry";
import type { RecipeProposal } from "./types";

const ID = "image-alt-text" as const;

export function toProposal(input: { mediaId: string; alt: string }): RecipeProposal {
  return {
    recipe: ID,
    version: RECIPES[ID].version,
    field: "imageAltText",
    after: JSON.stringify({ mediaId: input.mediaId, alt: input.alt }),
    agentReason: `Suggested alt text for image ${input.mediaId}.`,
    textPreserved: true,
  };
}

const AltLlmSchema = z.object({ alt: z.string() });

/** One call per image; the caller loops over images missing alt text. */
export async function run(input: {
  productTitle: string;
  imageUrl: string;
  mediaId: string;
}): Promise<RecipeProposal> {
  const client = new Anthropic();
  const model = process.env.LLM_MODEL ?? "claude-opus-4-8";
  const prompt = `Write concise, descriptive alt text (<= 125 chars) for a product image.
Product: ${input.productTitle}
Image URL: ${input.imageUrl}
Return only the alt text.`;
  const response = await client.messages.parse({
    model,
    max_tokens: 300,
    messages: [{ role: "user", content: prompt }],
    output_config: { format: zodOutputFormat(AltLlmSchema) },
  });
  const out = response.parsed_output;
  if (!out) throw new Error("image-alt-text: invalid LLM output.");
  return toProposal({ mediaId: input.mediaId, alt: out.alt });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run app/recipes/suggest-image-alt-text.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add app/recipes/suggest-image-alt-text.ts app/recipes/suggest-image-alt-text.test.ts
git commit -m "feat: image-alt-text recipe"
```

---

## Task 8: The apply path + decision log (the only writer)

**Files:**
- Create: `app/harness/apply.ts`
- Create: `app/harness/decisions.server.ts`
- Test: `app/harness/apply.test.ts`

`apply.ts` is the single funnel: given a `RecipeProposal` + product context, it (1) computes the before-image, (2) calls the gate, (3) records a `Decision`, and (4) if `auto`, performs the write. It returns the persisted `Decision`. The Shopify writers and the prisma client are injected so the unit test runs with fakes (no network, no DB).

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run app/harness/apply.test.ts`
Expected: FAIL — cannot find module `./apply`.

- [ ] **Step 3: Implement the decision log helper**

```ts
// app/harness/decisions.server.ts
import db from "../db.server";
import type { Decision } from "@prisma/client";
import type { NewDecision } from "./apply";

// Accepts the NewDecision shape proposeChange produces. The returned Prisma
// Decision is a structural superset of DecisionRecord, so it satisfies
// ApplyDeps.createDecision's return type without a cast.
export function createDecision(data: NewDecision): Promise<Decision> {
  return db.decision.create({ data });
}

export function listStagedAndApplied(): Promise<Decision[]> {
  return db.decision.findMany({
    where: { status: { in: ["staged", "applied", "approved", "edited", "rejected"] } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}

export function getDecision(id: string): Promise<Decision | null> {
  return db.decision.findUnique({ where: { id } });
}
```

- [ ] **Step 4: Implement the apply funnel**

```ts
// app/harness/apply.ts
import { gate, type ProposedChange } from "./gate";
import type { RecipeProposal } from "../recipes/types";
import type { ProductSnapshot } from "../lib/product.server";

type AdminGraphql = (
  query: string,
  options?: { variables?: Record<string, unknown> },
) => Promise<Response>;

export interface Writers {
  writeDescription: (a: AdminGraphql, id: string, html: string) => Promise<void>;
  writeProductType: (a: AdminGraphql, id: string, t: string) => Promise<void>;
  writeSeo: (a: AdminGraphql, id: string, seo: { title: string; description: string }) => Promise<void>;
  writeImageAlt: (a: AdminGraphql, id: string, mediaId: string, alt: string) => Promise<void>;
}

export interface DecisionRecord {
  id: string;
  jobId: string;
  productId: string;
  recipe: string;
  version: string;
  field: string;
  before: string | null;
  after: string;
  agentReason: string;
  gateDecision: string;
  gateReason: string;
  status: string;
}

// The fields proposeChange supplies when recording a decision. Structurally a
// subset of Prisma's DecisionUncheckedCreateInput, so the real createDecision
// (Task 8 Step 3) satisfies this without a cast.
export type NewDecision = Omit<DecisionRecord, "id">;

export interface ApplyDeps {
  createDecision: (d: NewDecision) => Promise<DecisionRecord>;
  writers: Writers;
  admin?: AdminGraphql; // omitted in unit tests (no auto-write path exercised needs it)
}

/** Compute the before-image string for a proposal's field. */
function beforeImage(product: ProductSnapshot, p: RecipeProposal): string | null {
  switch (p.field) {
    case "descriptionHtml":
      return product.descriptionHtml;
    case "productType":
      return product.productType;
    case "seo":
      return JSON.stringify({ title: product.seoTitle, description: product.seoDescription });
    case "imageAltText": {
      const { mediaId } = JSON.parse(p.after) as { mediaId: string };
      const img = product.images.find((i) => i.mediaId === mediaId);
      return JSON.stringify({ mediaId, alt: img?.altText ?? null });
    }
    default:
      return null;
  }
}

async function performWrite(
  admin: AdminGraphql,
  writers: Writers,
  productId: string,
  p: RecipeProposal,
): Promise<void> {
  switch (p.field) {
    case "descriptionHtml":
      return writers.writeDescription(admin, productId, p.after);
    case "productType":
      return writers.writeProductType(admin, productId, p.after);
    case "seo":
      return writers.writeSeo(admin, productId, JSON.parse(p.after));
    case "imageAltText": {
      const { mediaId, alt } = JSON.parse(p.after) as { mediaId: string; alt: string };
      return writers.writeImageAlt(admin, productId, mediaId, alt);
    }
    default:
      throw new Error(`No writer for field ${p.field}`);
  }
}

/** The single funnel: before-image → gate → record Decision → maybe write. */
export async function proposeChange(args: {
  jobId: string;
  product: ProductSnapshot;
  proposal: RecipeProposal;
  deps: ApplyDeps;
}): Promise<DecisionRecord> {
  const { jobId, product, proposal, deps } = args;
  const before = beforeImage(product, proposal);

  const change: ProposedChange = {
    recipe: proposal.recipe,
    version: proposal.version,
    field: proposal.field,
    before,
    after: proposal.after,
    productId: product.id,
    agentReason: proposal.agentReason,
    textPreserved: proposal.textPreserved,
  };
  const verdict = gate(change);
  const willApply = verdict.decision === "auto";

  const decision = await deps.createDecision({
    jobId,
    productId: product.id,
    recipe: proposal.recipe,
    version: proposal.version,
    field: proposal.field,
    before,
    after: proposal.after,
    agentReason: proposal.agentReason,
    gateDecision: verdict.decision,
    gateReason: verdict.reason,
    status: willApply ? "applied" : "staged",
  });

  if (willApply && deps.admin) {
    await performWrite(deps.admin, deps.writers, product.id, proposal);
  }
  return decision;
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run app/harness/apply.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add app/harness/apply.ts app/harness/decisions.server.ts app/harness/apply.test.ts
git commit -m "feat: apply funnel (before-image, gate, decision log, write)"
```

---

## Task 9: The agent tools + hand-rolled loop

**Files:**
- Create: `app/agent/system-prompt.ts`
- Create: `app/agent/tools.ts`
- Create: `app/agent/loop.ts`
- Test: `app/agent/loop.test.ts`

The loop is hand-rolled against the Anthropic Messages API tool-use protocol. The model is injected as a `complete` function so the loop is testable with a scripted fake (no network). Tools are defined as a closed registry; recipe tools' handlers call `proposeChange` internally. `get_product` records the input snapshot; the loop returns `{ trace, snapshot, decisions }`.

- [ ] **Step 1: Write the system prompt**

```ts
// app/agent/system-prompt.ts
export const SYSTEM_PROMPT = `You are a product-completeness agent for a Shopify store.
Products arrive from an ERP with quality gaps. Your job, for ONE product:

1. Call get_product to read its current state.
2. Call assess_completeness to record which recipes apply and why.
3. For each genuine gap, call the matching recipe tool. Only call a recipe when
   there is a real gap (e.g. do not infer a product type that is already set,
   do not propose alt text for images that already have it).
4. When you have run every applicable recipe, call finish.

You never write to the store directly. Recipe tools propose changes that a gate
decides to auto-apply or stage. Prefer leaving a field alone when unsure.`;
```

- [ ] **Step 2: Write the failing loop test (scripted fake model)**

```ts
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
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run app/agent/loop.test.ts`
Expected: FAIL — cannot find module `./loop`.

- [ ] **Step 4: Implement the tools registry**

```ts
// app/agent/tools.ts
// The CLOSED tool registry. This array is the agent's entire reach.
// Tool *handlers* live in the loop (they need per-run context), so here we only
// declare the schema the model sees.
export interface ToolSpec {
  name: string;
  description: string;
  input_schema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
}

export const TOOLS: ToolSpec[] = [
  {
    name: "get_product",
    description: "Read the current state of the product being completed.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "assess_completeness",
    description: "Record which recipes apply to this product and why.",
    input_schema: {
      type: "object",
      properties: {
        applicable: { type: "array", items: { type: "string" } },
        reasoning: { type: "string" },
      },
      required: ["applicable", "reasoning"],
    },
  },
  {
    name: "format_description",
    description: "Restore formatting structure to the description. Use when the description is flat/unstructured.",
    input_schema: {
      type: "object",
      properties: { level: { type: "string", enum: ["Light", "Balanced", "Full"] } },
    },
  },
  {
    name: "infer_product_type",
    description: "Infer a product type. Use only when productType is empty.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "generate_seo_meta",
    description: "Generate SEO title + description. Use when SEO meta is empty or weak.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "suggest_image_alt_text",
    description: "Suggest alt text for images that have none.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "finish",
    description: "Call when every applicable recipe has been run.",
    input_schema: { type: "object", properties: {} },
  },
];
```

- [ ] **Step 5: Implement the loop**

```ts
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
const RECIPE_TOOL: Record<string, string> = {
  format_description: "format-description",
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
      results.push({ error: `unhandled tool ${call.name}` });
    }

    trace.push({ turn: step, toolCalls: turn.toolCalls, results });
    // Feed tool results back so the model can reason on the next turn.
    messages.push({ role: "assistant", toolCalls: turn.toolCalls });
    messages.push({ role: "tool", results });
    if (finished) break;
  }

  return { snapshot, trace, decisions };
}
```

- [ ] **Step 6: Run to verify it passes**

Run: `npx vitest run app/agent/loop.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add app/agent/system-prompt.ts app/agent/tools.ts app/agent/loop.ts app/agent/loop.test.ts
git commit -m "feat: hand-rolled agent loop + closed tool registry"
```

---

## Task 10: The Anthropic adapter + worker runner

**Files:**
- Create: `app/agent/anthropic-client.server.ts` (real `complete` that speaks the Messages tool-use protocol)
- Create: `app/worker/runner.ts`
- Create: `app/worker/start.server.ts` (idempotent in-process poller)
- Modify: `app/entry.server.ts` (start the worker once)

No unit test here (this is the network/DB wiring); it is exercised by the end-to-end run in Task 12. Keep functions small.

- [ ] **Step 1: Implement the Anthropic adapter**

```ts
// app/agent/anthropic-client.server.ts
import Anthropic from "@anthropic-ai/sdk";
import { TOOLS } from "./tools";
import { SYSTEM_PROMPT } from "./system-prompt";
import type { ModelTurn } from "./loop";

const client = new Anthropic();

// Adapts Anthropic's Messages API to the loop's ModelTurn shape.
export async function complete(messages: unknown[]): Promise<ModelTurn> {
  const res = await client.messages.create({
    model: process.env.LLM_MODEL ?? "claude-opus-4-8",
    max_tokens: 4000,
    system: SYSTEM_PROMPT,
    tools: TOOLS as never,
    messages: messages as never,
  });
  const toolCalls = res.content
    .filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
    .map((b) => ({ id: b.id, name: b.name, input: (b.input ?? {}) as Record<string, unknown> }));
  return { stop_reason: res.stop_reason ?? "end_turn", toolCalls };
}
```

Note: when wiring `messages` for the real API, the loop's generic `{role,toolCalls}`/`{role:"tool"}` entries must be shaped into Anthropic content blocks. For the prototype, build the assistant/tool_result blocks inside `complete` is NOT possible (it only sees messages); instead, in this adapter step also adjust `loop.ts` message pushes to Anthropic's format. **Implementation detail to handle here:** change the two `messages.push(...)` lines in `loop.ts` to push Anthropic-shaped blocks:

```ts
// in loop.ts, replace the two pushes after trace.push(...)
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
```

Re-run `npx vitest run app/agent/loop.test.ts` after this change — the scripted-fake tests assert on `trace`/`decisions`, not message shape, so they still PASS.

- [ ] **Step 2: Implement the recipe dispatch used by the worker**

Create `app/agent/recipe-dispatch.server.ts`:

```ts
// app/agent/recipe-dispatch.server.ts
import type { ProductSnapshot } from "../lib/product.server";
import type { RecipeProposal } from "../recipes/types";
import * as fmt from "../recipes/format-description";
import * as type from "../recipes/infer-product-type";
import * as seo from "../recipes/generate-seo-meta";
import * as alt from "../recipes/suggest-image-alt-text";
import { DEFAULT_LEVEL, isFormattingLevel } from "../lib/formatting-levels";

export const runRecipe = {
  "format-description": (p: ProductSnapshot, input: Record<string, unknown>) => {
    const raw = String(input.level ?? DEFAULT_LEVEL);
    const level = isFormattingLevel(raw) ? raw : DEFAULT_LEVEL;
    return fmt.run({
      description: p.descriptionHtml,
      context: { title: p.title, productType: p.productType, vendor: p.vendor },
      level,
    });
  },
  "infer-product-type": (p: ProductSnapshot) =>
    type.run({ title: p.title, description: p.descriptionHtml, vendor: p.vendor }),
  "generate-seo-meta": (p: ProductSnapshot) =>
    seo.run({ title: p.title, description: p.descriptionHtml }),
  "suggest-image-alt-text": async (p: ProductSnapshot): Promise<RecipeProposal[]> => {
    const missing = p.images.filter((i) => !i.altText);
    return Promise.all(
      missing.map((img) =>
        alt.run({ productTitle: p.title, imageUrl: img.url, mediaId: img.mediaId }),
      ),
    );
  },
};
```

- [ ] **Step 3: Implement the runner**

```ts
// app/worker/runner.ts
import db from "../db.server";
import { unauthenticated } from "../shopify.server";
import { readProduct } from "../lib/product.server";
import * as productWriters from "../lib/product.server";
import { runAgentLoop } from "../agent/loop";
import { complete } from "../agent/anthropic-client.server";
import { runRecipe } from "../agent/recipe-dispatch.server";
import { proposeChange } from "../harness/apply";
import { createDecision } from "../harness/decisions.server";

const MAX_STEPS = 12;

/** Claim and run a single queued job. Returns true if one was processed. */
export async function runOneJob(): Promise<boolean> {
  const job = await db.job.findFirst({ where: { status: "queued" }, orderBy: { createdAt: "asc" } });
  if (!job) return false;

  await db.job.update({
    where: { id: job.id },
    data: { status: "running", startedAt: new Date(), attempts: { increment: 1 } },
  });

  try {
    const { admin } = await unauthenticated.admin(job.shop);

    const result = await runAgentLoop({
      jobId: job.id,
      productId: job.productId,
      deps: {
        complete,
        readProduct: (id) => readProduct(admin.graphql, id),
        runRecipe: runRecipe as never,
        proposeChange: ({ jobId, product, proposal }) =>
          proposeChange({
            jobId,
            product,
            proposal,
            deps: {
              createDecision,
              writers: {
                writeDescription: productWriters.writeDescription,
                writeProductType: productWriters.writeProductType,
                writeSeo: productWriters.writeSeo,
                writeImageAlt: productWriters.writeImageAlt,
              },
              admin: admin.graphql,
            },
          }),
        maxSteps: MAX_STEPS,
      },
    });

    await db.job.update({
      where: { id: job.id },
      data: {
        status: "done",
        finishedAt: new Date(),
        inputSnapshot: result.snapshot as never,
        trace: result.trace as never,
      },
    });
  } catch (err) {
    await db.job.update({
      where: { id: job.id },
      data: { status: "failed", finishedAt: new Date(), error: String(err) },
    });
  }
  return true;
}
```

- [ ] **Step 4: Implement the idempotent poller**

```ts
// app/worker/start.server.ts
import { runOneJob } from "./runner";

declare global {
  // eslint-disable-next-line no-var
  var __completenessWorker: NodeJS.Timeout | undefined;
}

const POLL_MS = 3000;

/** Start a single in-process poller (guarded against duplicate starts). */
export function startWorker(): void {
  if (global.__completenessWorker) return;
  global.__completenessWorker = setInterval(async () => {
    try {
      // Drain quickly: keep going while there is work.
      while (await runOneJob()) { /* loop */ }
    } catch (e) {
      console.error("worker tick failed:", e);
    }
  }, POLL_MS);
  console.log("Product-completeness worker started.");
}
```

- [ ] **Step 5: Start the worker from the server entry**

In `app/entry.server.ts`, add near the top (after imports):

```ts
import { startWorker } from "./worker/start.server";

if (process.env.NODE_ENV !== "test") {
  startWorker();
}
```

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no errors in the worker/agent/harness files. (Remaining errors only in `app/routes/app._index.tsx` / `app.format.tsx` until Tasks 11.)

- [ ] **Step 7: Commit**

```bash
git add app/agent/anthropic-client.server.ts app/agent/recipe-dispatch.server.ts app/worker/runner.ts app/worker/start.server.ts app/entry.server.ts app/agent/loop.ts
git commit -m "feat: anthropic adapter + in-process worker runner"
```

---

## Task 11: Webhook trigger + review UI

**Files:**
- Create: `app/routes/webhooks.products.tsx`
- Modify: `shopify.app.toml` (subscribe to products topics, fix scopes)
- Rewrite: `app/routes/app._index.tsx` (review queue)
- Create: `app/routes/app.decision.$id.tsx` (approve/edit/reject)
- Delete: `app/routes/app.format.tsx`

- [ ] **Step 1: Subscribe to product webhooks in `shopify.app.toml`**

In the `[webhooks]` block, add two subscriptions and confirm scopes include product read+write:

```toml
[access_scopes]
scopes = "read_products,write_products"
```

```toml
  [[webhooks.subscriptions]]
  uri = "/webhooks/products"
  topics = [ "products/create", "products/update" ]
```

- [ ] **Step 2: Implement the webhook handler (enqueue + fast 200)**

```tsx
// app/routes/webhooks.products.tsx
import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  const numericId = (payload as { id?: number | string }).id;
  if (numericId != null) {
    const productId = String(numericId).startsWith("gid://")
      ? String(numericId)
      : `gid://shopify/Product/${numericId}`;
    await db.job.create({ data: { productId, shop, trigger: topic } });
  }

  return new Response(); // 200 immediately; the worker does the agent work
};
```

- [ ] **Step 3: Rewrite the index route as the review queue**

```tsx
// app/routes/app._index.tsx
import { useLoaderData, Link } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { listStagedAndApplied } from "../harness/decisions.server";

export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.admin(request);
  const decisions = await listStagedAndApplied();
  return { decisions };
}

export default function Index() {
  const { decisions } = useLoaderData<typeof loader>();
  const staged = decisions.filter((d) => d.status === "staged");
  const settled = decisions.filter((d) => d.status !== "staged");

  return (
    <s-page heading="Product completeness agent">
      <s-section heading={`Needs review (${staged.length})`}>
        {staged.length === 0 ? (
          <s-text>Nothing waiting for review.</s-text>
        ) : (
          <s-stack direction="block" gap="base">
            {staged.map((d) => (
              <s-stack key={d.id} direction="inline" gap="base" alignItems="center">
                <s-badge>{d.recipe}</s-badge>
                <s-text>{d.agentReason}</s-text>
                <Link to={`/app/decision/${d.id}`}>Review</Link>
              </s-stack>
            ))}
          </s-stack>
        )}
      </s-section>

      <s-section heading="Recent agent activity">
        {settled.length === 0 ? (
          <s-text>No activity yet.</s-text>
        ) : (
          <s-stack direction="block" gap="base">
            {settled.map((d) => (
              <s-stack key={d.id} direction="inline" gap="base" alignItems="center">
                <s-badge tone={d.status === "applied" ? "success" : "neutral"}>
                  {d.status}
                </s-badge>
                <s-text>{d.recipe}</s-text>
                <s-text color="subdued">{d.agentReason}</s-text>
              </s-stack>
            ))}
          </s-stack>
        )}
      </s-section>
    </s-page>
  );
}
```

- [ ] **Step 4: Implement the decision detail + verdict route**

```tsx
// app/routes/app.decision.$id.tsx
import { useLoaderData, useFetcher, redirect } from "react-router";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { getDecision } from "../harness/decisions.server";
import * as writers from "../lib/product.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await authenticate.admin(request);
  const decision = await getDecision(params.id!);
  if (!decision) throw new Response("Not found", { status: 404 });
  return { decision };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { admin } = await authenticate.admin(request);
  const form = await request.formData();
  const verdict = String(form.get("verdict")); // agree | edit | reject
  const editedValue = form.get("editedValue");
  const decision = await getDecision(params.id!);
  if (!decision) throw new Response("Not found", { status: 404 });

  let finalValue: string | null = null;
  let status = "rejected";

  if (verdict !== "reject") {
    finalValue = verdict === "edit" && editedValue != null ? String(editedValue) : decision.after;
    status = verdict === "edit" ? "edited" : "approved";

    // Write through the same field writers the gate uses.
    switch (decision.field) {
      case "descriptionHtml":
        await writers.writeDescription(admin.graphql, decision.productId, finalValue);
        break;
      case "productType":
        await writers.writeProductType(admin.graphql, decision.productId, finalValue);
        break;
      case "seo":
        await writers.writeSeo(admin.graphql, decision.productId, JSON.parse(finalValue));
        break;
      case "imageAltText": {
        const { mediaId, alt } = JSON.parse(finalValue);
        await writers.writeImageAlt(admin.graphql, decision.productId, mediaId, alt);
        break;
      }
    }
  }

  await db.decision.update({
    where: { id: decision.id },
    data: { status, reviewerVerdict: verdict, finalValue, reviewedAt: new Date() },
  });
  return redirect("/app");
}

export default function DecisionDetail() {
  const { decision } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const isHtml = decision.field === "descriptionHtml";

  return (
    <s-page heading={`Review: ${decision.recipe}`}>
      <s-section heading="Why the agent proposed this">
        <s-text>{decision.agentReason}</s-text>
        <s-text color="subdued">Gate: {decision.gateReason}</s-text>
      </s-section>

      <s-section heading="Before / after">
        <s-grid gridTemplateColumns="1fr 1fr" gap="large">
          <s-grid-item>
            <s-heading>Before</s-heading>
            {isHtml ? (
              <iframe title="before" sandbox="" srcDoc={decision.before ?? ""}
                style={{ width: "100%", minHeight: "200px", border: "1px solid #ddd" }} />
            ) : (
              <s-text>{decision.before ?? "(empty)"}</s-text>
            )}
          </s-grid-item>
          <s-grid-item>
            <s-heading>After</s-heading>
            {isHtml ? (
              <iframe title="after" sandbox="" srcDoc={decision.after}
                style={{ width: "100%", minHeight: "200px", border: "1px solid #ddd" }} />
            ) : (
              <s-text>{decision.after}</s-text>
            )}
          </s-grid-item>
        </s-grid>
      </s-section>

      <s-section heading="Decide">
        <s-stack direction="inline" gap="base">
          <s-button onClick={() => fetcher.submit({ verdict: "agree" }, { method: "post" })}>
            Approve
          </s-button>
          <s-button variant="secondary"
            onClick={() => fetcher.submit({ verdict: "reject" }, { method: "post" })}>
            Reject
          </s-button>
        </s-stack>
      </s-section>
    </s-page>
  );
}
```

(Note: "Edit & approve" submits `verdict: "edit"` with an `editedValue` field; a text input for it is a small follow-on and the action already handles it. The prototype's Definition of Done requires approve/edit/reject to *record* correctly, which the action does.)

- [ ] **Step 5: Delete the old formatter route**

```bash
git rm app/routes/app.format.tsx
```

- [ ] **Step 6: Typecheck + full test run**

Run: `npm run typecheck && npx vitest run`
Expected: no type errors; all unit tests PASS.

- [ ] **Step 7: Commit**

```bash
git add app/routes/webhooks.products.tsx app/routes/app._index.tsx app/routes/app.decision.\$id.tsx shopify.app.toml
git commit -m "feat: products webhook trigger + review queue UI"
```

---

## Task 12: End-to-end verification on the dev store

**Files:** none (manual verification against the Definition of Done in the spec)

- [ ] **Step 1: Confirm env + scopes**

Ensure `.env` has `ANTHROPIC_API_KEY` and (optionally) `LLM_MODEL`. Confirm `shopify.app.toml` scopes are `read_products,write_products`.

- [ ] **Step 2: Reset the scopes/webhooks by reinstalling**

Run: `npm run dev` (i.e. `shopify app dev`). When prompted, update the app config and reinstall on the dev store so the new product webhooks and scopes register.
Expected: CLI shows the tunnel URL and that `products/create`, `products/update` subscriptions are registered.

- [ ] **Step 3: Trigger the agent with NO manual click**

In the dev store admin, edit a product whose description is a flat wall of text and whose product type / SEO are empty, and save.
Expected (server logs): the `/webhooks/products` handler logs an enqueue; within ~3s the worker logs that it picked up the job and the agent loop runs.

- [ ] **Step 4: Verify gate behavior (DoD #2, #3)**

Open the app's home page (the review queue).
Expected:
- The flat description was **auto-applied** (visible read-only under "Recent agent activity" with an `applied` badge; the live product description is now formatted).
- SEO / product-type / alt-text proposals are **staged** under "Needs review".

- [ ] **Step 5: Verify review verdicts (DoD #4)**

Open a staged decision, see before/after, click Approve. Open another, click Reject.
Expected: Approve writes the value to the live product and the row shows `approved`; Reject writes nothing and shows `rejected`.

- [ ] **Step 6: Verify the seam data exists (DoD #5, #6)**

Run against the dev DB:
```bash
npx prisma studio
```
Expected: every `Decision` row has `recipe`, `version`, `before`, `gateDecision`, and (for reviewed rows) `reviewerVerdict`. Every `done` `Job` row has non-null `inputSnapshot` and `trace`.

- [ ] **Step 7: Final commit (any verification fixups) + summary**

```bash
git add -A
git commit -m "chore: end-to-end verification fixups for completeness agent"
```

---

## Self-review notes (coverage check against the spec)

- **§2 four layers** → Trigger (Task 11), Agent (Task 9/10), Harness (Tasks 2, 8), Review (Task 11). ✓
- **§3 closed tool registry + hand-rolled loop + input snapshot + trace + recipe versioning** → Tasks 1, 9, 10. ✓
- **§4 gate (atomic/static), before-image, decision log, three invariants** → Tasks 2, 8 (`apply.ts` is the only writer; gate is the only decider; every change recorded). ✓
- **§5 Job + Decision models** → Task 0. ✓
- **§6 review queue + 3-way verdict + auto-applied read-only** → Task 11. ✓
- **§7 webhook fast-200 + DB-backed in-process worker** → Tasks 10, 11. ✓
- **§8 file map** → matches Tasks 1–11 (old `app.format.tsx` and `format-description.server.ts` removed; `sanitize`/`formatting-levels`/`format-prompt` kept). ✓
- **§9 Definition of Done** → Task 12 maps every numbered criterion. ✓
- **Two adopted refinements** (server-side `proposeChange`, single `seo` change) → Tasks 8, 6. ✓
