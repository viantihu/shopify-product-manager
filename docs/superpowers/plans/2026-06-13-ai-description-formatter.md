# AI Description Formatter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an embedded Shopify admin app that takes a product's flat,
ERP-synced description and uses Claude to restore HTML formatting (headings,
lists, emphasis) at a user-chosen aggressiveness level, shows a rendered
before/after, and saves the result safely to a draft metafield.

**Architecture:** Shopify React Router app template. A single server-side route
reads the product description via the Admin GraphQL API, passes it through an
isolated formatter module (Claude with schema-constrained output, then a
per-level HTML sanitizer), and returns `{ original, formatted, changes }` for a
side-by-side preview rendered in sandboxed iframes. A Save action writes the
formatted HTML to a `multi_line_text_field` metafield and reads it back to prove
the round trip. The pure logic (level allowlists, sanitizer, prompt assembly,
result post-processing) is unit-tested; the live API and UI layers are verified
manually against the dev store.

**Tech Stack:** TypeScript, Shopify CLI + React Router template
(`@shopify/shopify-app-react-router`), Admin GraphQL API, Polaris web components,
App Bridge Resource Picker, Anthropic TypeScript SDK (`claude-opus-4-8`), Zod,
`sanitize-html`, Vitest.

**Source spec:** `docs/design.md` (approved).

---

## File Structure

Files this plan creates or modifies (paths assume the standard React Router
template layout; confirm exact paths after Task 1 scaffolds the app):

| File | Responsibility |
| --- | --- |
| `shopify.app.toml` | App config; access scopes (`read_products`, `write_products`) |
| `.env` / `.env.example` | `ANTHROPIC_API_KEY`, `LLM_PROVIDER`, `LLM_MODEL` |
| `app/lib/formatting-levels.ts` | `FormattingLevel` type + per-level HTML tag allowlists (pure) |
| `app/lib/sanitize.ts` | `sanitizeHtml`, `visibleText`, `textPreserved` (pure) |
| `app/lib/format-prompt.ts` | Shared preamble + 3 level guidance blocks; `buildPrompt` (pure) |
| `app/lib/format-description.server.ts` | `postProcess` (pure) + `formatDescription` (Anthropic call) |
| `app/lib/product.server.ts` | Admin GraphQL: read product, write + read-back metafield |
| `app/routes/app._index.tsx` | UI: picker, level control, before/after preview, Save |
| `app/routes/app.format.tsx` | Action: read → format → return; Save → metafield |

Pure modules (`formatting-levels`, `sanitize`, `format-prompt`, the `postProcess`
half of `format-description`) are tested with Vitest and contain no Shopify or
network calls. `.server.ts` suffixes keep server-only code (the Anthropic key, the
admin client) out of the browser bundle.

---

## Task 1: Scaffold the app and confirm it authenticates against the dev store

This is a **collaborative, interactive** task. `shopify app init` requires
browser auth to your Shopify Partner organization and dev store — the user
completes the auth prompts. Do not proceed to Task 2 until `shopify app dev`
loads the app in the admin and a product query succeeds.

**Files:**
- Create: entire app scaffold (the CLI generates `app/`, `shopify.app.toml`,
  `package.json`, `vite.config.ts`, etc.)
- Modify: `shopify.app.toml` (scopes)

- [ ] **Step 1: Confirm the Shopify CLI is installed**

Run: `shopify version`
Expected: a version number prints. If "command not found", install it:
`npm install -g @shopify/cli@latest`, then re-run.

- [ ] **Step 2: Scaffold the app from the React Router template**

Run from the project directory (`shopify-product-manager/`):

```bash
shopify app init --template reactRouter --name ai-description-formatter --path .
```

Respond to the interactive prompts:
- "Which organization is this work for?" → choose the org linked to your dev store
- "Create this project as a new app on Shopify?" → Yes
- Package manager → `npm` (or your preference)

The CLI installs dependencies and creates the app in the current directory,
including managed OAuth/session via `@shopify/shopify-app-react-router`.

- [ ] **Step 3: Set access scopes**

Open `shopify.app.toml`. Find the `[access_scopes]` section and set:

```toml
[access_scopes]
scopes = "read_products,write_products"
```

(`read_products` for the description read; `write_products` for the metafield
write in Task 7.)

- [ ] **Step 4: Start the dev server and install on the dev store**

Run: `shopify app dev`
Follow the prompt to select/confirm the dev store and open the install URL.
Expected: the app installs and loads an embedded page in the Shopify admin
without an auth error. Leave this running (or restart it as needed) for later
manual-verification tasks.

- [ ] **Step 5: Confirm the Admin GraphQL client works**

In the running app, confirm the template's default index page renders inside the
admin (the default template usually includes a "Generate a product" demo button —
clicking it and seeing a product created confirms `authenticate.admin` + the
GraphQL client are working end to end). If the template's demo differs, the
success bar is simply: the app loads embedded and any built-in Admin API call
succeeds.

- [ ] **Step 6: Commit the scaffold**

```bash
git add -A
git commit -m "chore: scaffold Shopify React Router app, set product scopes"
```

(`shopify app init` initializes the git repo. If for any reason it did not, run
`git init` first.)

---

## Task 2: Add dependencies, env vars, and the test runner

**Files:**
- Modify: `package.json` (deps + test script)
- Create: `.env.example`
- Modify: `.env` (local, gitignored — add the Anthropic key)
- Create: `vitest.config.ts` (only if the template did not include one)

- [ ] **Step 1: Install runtime and dev dependencies**

```bash
npm install @anthropic-ai/sdk zod sanitize-html
npm install -D vitest @types/sanitize-html
```

- [ ] **Step 2: Confirm or add a Vitest config and test script**

Check whether the template already configured Vitest:

Run: `npx vitest --version`
Expected: a version prints (installed in Step 1).

If `package.json` has no `"test"` script, add one to its `"scripts"`:

```json
"test": "vitest run"
```

If there is no `vitest.config.ts` and no `test` block in `vite.config.ts`, create
`vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["app/**/*.test.ts"],
    // Vitest 4 exits non-zero when no test files match — keep the script green
    // until the first test exists.
    passWithNoTests: true,
  },
});
```

- [ ] **Step 3: Create `.env.example`**

Create `.env.example`:

```bash
# LLM provider config (swap provider/model without code changes)
LLM_PROVIDER=anthropic
LLM_MODEL=claude-opus-4-8
ANTHROPIC_API_KEY=sk-ant-your-key-here
```

- [ ] **Step 4: Add the real key to the local `.env`**

Append the same three keys to the gitignored `.env` (the template gitignores
`.env`). Put your real `ANTHROPIC_API_KEY` here. Confirm `.env` is in
`.gitignore`:

Run: `git check-ignore .env`
Expected: prints `.env` (meaning it is ignored). If it prints nothing, add a line
`.env` to `.gitignore`.

- [ ] **Step 5: Verify the test runner runs (with zero tests)**

Run: `npm test`
Expected: Vitest runs and reports "no test files found" (or 0 tests) and exits 0.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json .env.example vitest.config.ts
git commit -m "chore: add Anthropic SDK, zod, sanitize-html, vitest, env template"
```

---

## Task 3: Formatting levels and per-level tag allowlists (pure, TDD)

**Files:**
- Create: `app/lib/formatting-levels.ts`
- Test: `app/lib/formatting-levels.test.ts`

- [ ] **Step 1: Write the failing test**

Create `app/lib/formatting-levels.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  FORMATTING_LEVELS,
  isFormattingLevel,
  allowedTagsFor,
} from "./formatting-levels";

describe("formatting levels", () => {
  it("exposes exactly Light, Balanced, Full", () => {
    expect(FORMATTING_LEVELS).toEqual(["Light", "Balanced", "Full"]);
  });

  it("validates known and unknown level strings", () => {
    expect(isFormattingLevel("Balanced")).toBe(true);
    expect(isFormattingLevel("Aggressive")).toBe(false);
    expect(isFormattingLevel("")).toBe(false);
  });

  it("Light allows only paragraph and list tags, no headings or emphasis", () => {
    const tags = allowedTagsFor("Light");
    expect(tags).toEqual(["p", "br", "ul", "ol", "li"]);
    expect(tags).not.toContain("h2");
    expect(tags).not.toContain("strong");
  });

  it("Balanced adds headings but not emphasis or links", () => {
    const tags = allowedTagsFor("Balanced");
    expect(tags).toContain("h2");
    expect(tags).toContain("h3");
    expect(tags).not.toContain("strong");
    expect(tags).not.toContain("a");
  });

  it("Full allows headings, emphasis, and links", () => {
    const tags = allowedTagsFor("Full");
    expect(tags).toEqual(
      expect.arrayContaining(["h2", "h3", "strong", "em", "a"]),
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run app/lib/formatting-levels.test.ts`
Expected: FAIL — cannot find module `./formatting-levels`.

- [ ] **Step 3: Write the implementation**

Create `app/lib/formatting-levels.ts`:

```ts
export const FORMATTING_LEVELS = ["Light", "Balanced", "Full"] as const;

export type FormattingLevel = (typeof FORMATTING_LEVELS)[number];

export const DEFAULT_LEVEL: FormattingLevel = "Balanced";

export function isFormattingLevel(value: string): value is FormattingLevel {
  return (FORMATTING_LEVELS as readonly string[]).includes(value);
}

const ALLOWED_TAGS: Record<FormattingLevel, string[]> = {
  Light: ["p", "br", "ul", "ol", "li"],
  Balanced: ["p", "br", "h2", "h3", "ul", "ol", "li"],
  Full: ["p", "br", "h2", "h3", "ul", "ol", "li", "strong", "em", "a"],
};

export function allowedTagsFor(level: FormattingLevel): string[] {
  return ALLOWED_TAGS[level];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run app/lib/formatting-levels.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add app/lib/formatting-levels.ts app/lib/formatting-levels.test.ts
git commit -m "feat: formatting levels and per-level tag allowlists"
```

---

## Task 4: HTML sanitizer and text-preservation check (pure, TDD)

`sanitizeHtml` strips any tag outside the level's allowlist. `visibleText`
reduces HTML to normalized plain text. `textPreserved` compares the visible text
of two HTML strings — this is the structure-not-substance guardrail. This module
is also the security boundary for the preview: it is the only thing that produces
the HTML the UI later renders, so it must run on every formatter output.

**Files:**
- Create: `app/lib/sanitize.ts`
- Test: `app/lib/sanitize.test.ts`

- [ ] **Step 1: Write the failing test**

Create `app/lib/sanitize.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { sanitizeHtml, visibleText, textPreserved } from "./sanitize";

describe("sanitizeHtml", () => {
  it("keeps allowed tags", () => {
    const out = sanitizeHtml("<p>Hi</p><ul><li>A</li></ul>", [
      "p",
      "ul",
      "li",
    ]);
    expect(out).toContain("<p>Hi</p>");
    expect(out).toContain("<li>A</li>");
  });

  it("strips disallowed tags but keeps their text", () => {
    const out = sanitizeHtml("<h2>Title</h2><p>Body</p>", ["p"]);
    expect(out).not.toContain("<h2>");
    expect(out).toContain("Title");
    expect(out).toContain("<p>Body</p>");
  });

  it("strips script tags and their contents entirely", () => {
    const out = sanitizeHtml('<p>ok</p><script>alert(1)</script>', ["p"]);
    expect(out).not.toContain("script");
    expect(out).not.toContain("alert");
  });

  it("keeps href on anchors when a is allowed", () => {
    const out = sanitizeHtml('<a href="https://x.com">x</a>', ["a"]);
    expect(out).toContain('href="https://x.com"');
  });
});

describe("visibleText", () => {
  it("reduces HTML to normalized text", () => {
    expect(visibleText("<h2>Hi</h2>\n<p>there   world</p>")).toBe(
      "Hi there world",
    );
  });
});

describe("textPreserved", () => {
  it("is true when only the markup differs", () => {
    const original = "Soft merino crew. Machine washable.";
    const formatted =
      "<h2>Soft merino crew.</h2><ul><li>Machine washable.</li></ul>";
    expect(textPreserved(original, formatted)).toBe(true);
  });

  it("is false when wording changed", () => {
    const original = "Soft merino crew. Machine washable.";
    const formatted = "<p>Soft merino crew. Hand wash only.</p>";
    expect(textPreserved(original, formatted)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run app/lib/sanitize.test.ts`
Expected: FAIL — cannot find module `./sanitize`.

- [ ] **Step 3: Write the implementation**

Create `app/lib/sanitize.ts`. Note `nonTextTags` forces `script`/`style` content
to be dropped rather than escaped and surfaced as text.

```ts
import sanitizeHtmlLib from "sanitize-html";

/** Strip every tag not in `allowedTags`; keep the text of stripped tags. */
export function sanitizeHtml(html: string, allowedTags: string[]): string {
  return sanitizeHtmlLib(html, {
    allowedTags,
    allowedAttributes: allowedTags.includes("a") ? { a: ["href"] } : {},
    // Disallowed structural tags: drop the tag, keep its text content.
    disallowedTagsMode: "discard",
    // These tags' *contents* are removed entirely (not escaped into text).
    nonTextTags: ["script", "style", "textarea", "noscript"],
  });
}

/** Reduce HTML to plain text with collapsed whitespace. */
export function visibleText(html: string): string {
  // sanitize-html concatenates content across stripped block tags without
  // inserting whitespace (e.g. "<h2>A.</h2><p>B</p>" -> "A.B"). Insert a space
  // before every tag first so block boundaries become word breaks; the trailing
  // whitespace collapse makes the extra spaces harmless.
  const spaced = html.replace(/</g, " <");
  const text = sanitizeHtmlLib(spaced, {
    allowedTags: [],
    allowedAttributes: {},
    nonTextTags: ["script", "style", "textarea", "noscript"],
  });
  return text.replace(/\s+/g, " ").trim();
}

/**
 * True when the two HTML strings render the same visible text.
 * This is the structure-not-substance guard: formatting may change,
 * wording may not.
 */
export function textPreserved(original: string, formatted: string): boolean {
  return visibleText(original) === visibleText(formatted);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run app/lib/sanitize.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add app/lib/sanitize.ts app/lib/sanitize.test.ts
git commit -m "feat: HTML allowlist sanitizer and text-preservation check"
```

---

## Task 5: Prompt assembly (pure, TDD)

One file holds a shared preamble plus three level guidance blocks. `buildPrompt`
assembles the preamble + the selected level's block + the level's allowed tags +
the injected description and context.

**Files:**
- Create: `app/lib/format-prompt.ts`
- Test: `app/lib/format-prompt.test.ts`

- [ ] **Step 1: Write the failing test**

Create `app/lib/format-prompt.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildPrompt } from "./format-prompt";

const ctx = { title: "Merino Crew", productType: "Sweater", vendor: "Northbound" };

describe("buildPrompt", () => {
  it("includes the non-fabrication rule in every level", () => {
    for (const level of ["Light", "Balanced", "Full"] as const) {
      const p = buildPrompt({
        description: "Soft merino crew. Machine washable.",
        context: ctx,
        level,
      });
      expect(p.toLowerCase()).toContain("never");
      expect(p.toLowerCase()).toContain("wording");
    }
  });

  it("injects the raw description and context", () => {
    const p = buildPrompt({
      description: "RAW_DESCRIPTION_MARKER",
      context: ctx,
      level: "Balanced",
    });
    expect(p).toContain("RAW_DESCRIPTION_MARKER");
    expect(p).toContain("Merino Crew");
    expect(p).toContain("Northbound");
  });

  it("selects a different guidance block per level", () => {
    const light = buildPrompt({ description: "x", context: ctx, level: "Light" });
    const full = buildPrompt({ description: "x", context: ctx, level: "Full" });
    expect(light).toContain("LIGHT");
    expect(full).toContain("FULL");
    expect(light).not.toBe(full);
  });

  it("lists the level's allowed tags in the prompt", () => {
    const light = buildPrompt({ description: "x", context: ctx, level: "Light" });
    expect(light).toContain("<ul>");
    expect(light).not.toContain("<h2>"); // Light forbids headings
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run app/lib/format-prompt.test.ts`
Expected: FAIL — cannot find module `./format-prompt`.

- [ ] **Step 3: Write the implementation**

Create `app/lib/format-prompt.ts`:

```ts
import { type FormattingLevel, allowedTagsFor } from "./formatting-levels";

export interface ProductContext {
  title: string;
  productType: string;
  vendor: string;
}

const PREAMBLE = `You are a product-description FORMATTER for an e-commerce storefront.
The description below was synced from an ERP system with all formatting stripped.
Your job is to restore presentation structure as clean HTML.

HARD RULE — structure, not substance:
- You may ONLY add formatting markup, fix paragraph/line breaks, and tidy whitespace.
- You must NEVER reword, add, remove, or change any word, fact, number, or claim.
- The visible text a customer reads must be byte-for-byte the same words as the input.
- If you are unsure whether something is a heading or a list, leave it as a paragraph.

Return the formatted HTML and a short list of the structural changes you made.`;

const LEVEL_BLOCKS: Record<FormattingLevel, string> = {
  Light: `FORMATTING LEVEL: LIGHT
Only format what is explicit. Turn existing line breaks into paragraphs, and turn
a literal numbered or bulleted sequence into a list. Do NOT infer headings.`,
  Balanced: `FORMATTING LEVEL: BALANCED
Add headings and lists where the text clearly implies them (for example, a
"Features:" line followed by short clauses becomes a heading plus a list).
Leave ambiguous text as paragraphs.`,
  Full: `FORMATTING LEVEL: FULL
Infer structure from prose patterns. Promote run-on feature sentences to lists,
add section headings, and emphasize key terms. Apply the most polish — but still
never change a single word.`,
};

export function buildPrompt(input: {
  description: string;
  context: ProductContext;
  level: FormattingLevel;
}): string {
  const { description, context, level } = input;
  const tags = allowedTagsFor(level)
    .map((t) => `<${t}>`)
    .join(" ");

  return [
    PREAMBLE,
    LEVEL_BLOCKS[level],
    `ALLOWED TAGS (use only these): ${tags}`,
    `PRODUCT CONTEXT (read-only, for your judgment — do not output it):
Title: ${context.title}
Type: ${context.productType}
Vendor: ${context.vendor}`,
    `DESCRIPTION TO FORMAT:
${description}`,
  ].join("\n\n");
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run app/lib/format-prompt.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add app/lib/format-prompt.ts app/lib/format-prompt.test.ts
git commit -m "feat: level-aware transformation prompt assembly"
```

---

## Task 6: Formatter module — pure post-processing (TDD) + Anthropic call

Split into a pure `postProcess` (sanitize + preservation check, fully tested) and
a thin `formatDescription` that calls Claude and delegates to `postProcess`.

**Files:**
- Create: `app/lib/format-description.server.ts`
- Test: `app/lib/format-description.test.ts`

- [ ] **Step 1: Write the failing test for `postProcess`**

Create `app/lib/format-description.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { postProcess } from "./format-description.server";

const original = "Soft merino crew. Machine washable.";

describe("postProcess", () => {
  it("sanitizes against the level allowlist and reports no warning when text preserved", () => {
    const llm = {
      formattedHtml:
        "<h2>Soft merino crew.</h2><ul><li>Machine washable.</li></ul>",
      changes: ["Added a heading", "Converted to a list"],
    };
    const result = postProcess({ original, llmOutput: llm, level: "Balanced" });
    expect(result.formatted).toContain("<h2>");
    expect(result.changes).toHaveLength(2);
    expect(result.warning).toBeNull();
  });

  it("strips tags the level forbids (Light removes a heading)", () => {
    const llm = {
      formattedHtml: "<h2>Soft merino crew.</h2><p>Machine washable.</p>",
      changes: ["Added a heading"],
    };
    const result = postProcess({ original, llmOutput: llm, level: "Light" });
    expect(result.formatted).not.toContain("<h2>");
    expect(result.formatted).toContain("Soft merino crew.");
  });

  it("sets a warning when wording changed", () => {
    const llm = {
      formattedHtml: "<p>Soft merino crew. Hand wash only.</p>",
      changes: [],
    };
    const result = postProcess({ original, llmOutput: llm, level: "Light" });
    expect(result.warning).toMatch(/wording/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run app/lib/format-description.test.ts`
Expected: FAIL — cannot find module `./format-description.server`.

- [ ] **Step 3: Write the implementation**

Create `app/lib/format-description.server.ts`:

```ts
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { type FormattingLevel, allowedTagsFor } from "./formatting-levels";
import { buildPrompt, type ProductContext } from "./format-prompt";
import { sanitizeHtml, textPreserved } from "./sanitize";

export const FormatResultSchema = z.object({
  formattedHtml: z.string(),
  changes: z.array(z.string()),
});

export type LlmOutput = z.infer<typeof FormatResultSchema>;

export interface FormatResult {
  original: string;
  formatted: string;
  changes: string[];
  level: FormattingLevel;
  warning: string | null;
}

/** Pure: sanitize the LLM output for the level and flag wording drift. */
export function postProcess(input: {
  original: string;
  llmOutput: LlmOutput;
  level: FormattingLevel;
}): FormatResult {
  const { original, llmOutput, level } = input;
  const formatted = sanitizeHtml(
    llmOutput.formattedHtml,
    allowedTagsFor(level),
  );
  const warning = textPreserved(original, formatted)
    ? null
    : "Wording may have changed — review carefully before saving.";
  return { original, formatted, changes: llmOutput.changes, level, warning };
}

/** Call Claude to format the description, then post-process. */
export async function formatDescription(input: {
  description: string;
  context: ProductContext;
  level: FormattingLevel;
}): Promise<FormatResult> {
  const { description, context, level } = input;
  const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env
  const model = process.env.LLM_MODEL ?? "claude-opus-4-8";

  const response = await client.messages.parse({
    model,
    max_tokens: 16000,
    messages: [
      { role: "user", content: buildPrompt({ description, context, level }) },
    ],
    output_config: { format: zodOutputFormat(FormatResultSchema) },
  });

  const llmOutput = response.parsed_output;
  if (!llmOutput) {
    throw new Error("LLM did not return a valid formatted result.");
  }
  return postProcess({ original: description, llmOutput, level });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run app/lib/format-description.test.ts`
Expected: PASS (3 tests). These cover the pure `postProcess`; `formatDescription`
(the network call) is verified manually in Task 9.

- [ ] **Step 5: Commit**

```bash
git add app/lib/format-description.server.ts app/lib/format-description.test.ts
git commit -m "feat: formatter module (pure post-process + Claude call)"
```

---

## Task 7: Product read + metafield write/read-back (Admin GraphQL)

These functions wrap the authenticated `admin.graphql` client. They are verified
manually against the dev store (Task 9), not unit-tested — they are thin wrappers
over the live API.

**Files:**
- Create: `app/lib/product.server.ts`

- [ ] **Step 1: Write the implementation**

Create `app/lib/product.server.ts`. `AdminGraphql` is the type of the
`admin.graphql` function returned by `authenticate.admin(request)`.

```ts
import type { ProductContext } from "./format-prompt";

type AdminGraphql = (
  query: string,
  options?: { variables?: Record<string, unknown> },
) => Promise<Response>;

export const DRAFT_METAFIELD_NAMESPACE = "custom";
export const DRAFT_METAFIELD_KEY = "formatted_description_draft";

export interface ProductForFormatting {
  id: string;
  descriptionHtml: string;
  context: ProductContext;
}

/** Read the fields the formatter needs for one product. */
export async function getProduct(
  admin: AdminGraphql,
  productId: string,
): Promise<ProductForFormatting> {
  const response = await admin(
    `#graphql
    query GetProduct($id: ID!) {
      product(id: $id) {
        id
        title
        descriptionHtml
        productType
        vendor
      }
    }`,
    { variables: { id: productId } },
  );
  const body = await response.json();
  const p = body.data.product;
  return {
    id: p.id,
    descriptionHtml: p.descriptionHtml ?? "",
    context: {
      title: p.title ?? "",
      productType: p.productType ?? "",
      vendor: p.vendor ?? "",
    },
  };
}

/** Write formatted HTML to the draft metafield, then read it back. */
export async function saveDraftAndReadBack(
  admin: AdminGraphql,
  productId: string,
  formattedHtml: string,
): Promise<string | null> {
  const write = await admin(
    `#graphql
    mutation SetDraft($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { id namespace key }
        userErrors { field message }
      }
    }`,
    {
      variables: {
        metafields: [
          {
            ownerId: productId,
            namespace: DRAFT_METAFIELD_NAMESPACE,
            key: DRAFT_METAFIELD_KEY,
            type: "multi_line_text_field",
            value: formattedHtml,
          },
        ],
      },
    },
  );
  const writeBody = await write.json();
  const errors = writeBody.data.metafieldsSet.userErrors;
  if (errors.length > 0) {
    throw new Error(`metafieldsSet failed: ${JSON.stringify(errors)}`);
  }

  const read = await admin(
    `#graphql
    query ReadDraft($id: ID!) {
      product(id: $id) {
        metafield(namespace: "${DRAFT_METAFIELD_NAMESPACE}", key: "${DRAFT_METAFIELD_KEY}") {
          value
        }
      }
    }`,
    { variables: { id: productId } },
  );
  const readBody = await read.json();
  return readBody.data.product.metafield?.value ?? null;
}
```

- [ ] **Step 2: Type-check**

Run: `npm run typecheck`
Expected: no type errors in `product.server.ts`. (If the template ships a
different type for the admin client, adjust the `AdminGraphql` signature to match;
the shape — a function taking a query string and `{ variables }` — is stable.)

- [ ] **Step 3: Commit**

```bash
git add app/lib/product.server.ts
git commit -m "feat: admin product read + draft metafield write/read-back"
```

---

## Task 8: The format route (action)

Wire the pieces into a server action: read the product, format it, return the
result; and on Save, write the metafield and read it back.

**Files:**
- Create: `app/routes/app.format.tsx`

- [ ] **Step 1: Write the action**

Create `app/routes/app.format.tsx`. It authenticates, branches on a form
`intent` field (`format` or `save`), and returns JSON for the UI. Confirm the
import path for `authenticate` matches the scaffold (usually `../shopify.server`).

```tsx
import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { isFormattingLevel, DEFAULT_LEVEL } from "../lib/formatting-levels";
import { formatDescription } from "../lib/format-description.server";
import { getProduct, saveDraftAndReadBack } from "../lib/product.server";

export async function action({ request }: ActionFunctionArgs) {
  const { admin } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const productId = String(form.get("productId") ?? "");

  if (!productId) {
    return { ok: false, error: "No product selected." };
  }

  if (intent === "format") {
    const levelRaw = String(form.get("level") ?? DEFAULT_LEVEL);
    const level = isFormattingLevel(levelRaw) ? levelRaw : DEFAULT_LEVEL;
    const product = await getProduct(admin.graphql, productId);
    const result = await formatDescription({
      description: product.descriptionHtml,
      context: product.context,
      level,
    });
    return { ok: true, intent, result };
  }

  if (intent === "save") {
    const formattedHtml = String(form.get("formattedHtml") ?? "");
    const readBack = await saveDraftAndReadBack(
      admin.graphql,
      productId,
      formattedHtml,
    );
    const roundTripped = readBack === formattedHtml;
    return { ok: true, intent, roundTripped };
  }

  return { ok: false, error: `Unknown intent: ${intent}` };
}
```

- [ ] **Step 2: Type-check**

Run: `npm run typecheck`
Expected: no type errors.

- [ ] **Step 3: Commit**

```bash
git add app/routes/app.format.tsx
git commit -m "feat: format route action (format + save intents)"
```

---

## Task 9: The UI — picker, level control, before/after preview, Save

Build the index page with Polaris web components and the App Bridge resource
picker. The before/after panels render the HTML inside **sandboxed iframes**
(`sandbox` with no allow tokens → no scripts, no forms, no same-origin access).
This isolates the preview from the admin DOM and is defense-in-depth on top of the
server-side allowlist sanitizing from Task 4. Verified manually in the embedded
admin.

**Files:**
- Modify: `app/routes/app._index.tsx` (replace the template's demo content)

- [ ] **Step 1: Replace the index route with the formatter UI**

Replace the body of `app/routes/app._index.tsx`. Use `useFetcher` to POST to
`/app/format` without navigation, the resource picker to choose a product, a
segmented control for the level, and two sandboxed iframes for the before/after.
Confirm the Polaris script tag is present in the app's root (the template adds it;
if not, add `<script src="https://cdn.shopify.com/shopifycloud/polaris.js" />`).

```tsx
import { useState } from "react";
import { useFetcher } from "react-router";
import { FORMATTING_LEVELS, DEFAULT_LEVEL } from "../lib/formatting-levels";

/** Render already-sanitized HTML inside a locked-down iframe. */
function HtmlPreview({ html }: { html: string }) {
  return (
    <iframe
      title="preview"
      sandbox=""
      srcDoc={html}
      style={{
        width: "100%",
        minHeight: "240px",
        border: "1px solid #ddd",
        borderRadius: "8px",
      }}
    />
  );
}

export default function Index() {
  const fetcher = useFetcher();
  const [productId, setProductId] = useState<string | null>(null);
  const [productTitle, setProductTitle] = useState<string>("");
  const [level, setLevel] = useState<string>(DEFAULT_LEVEL);

  const data = fetcher.data as
    | {
        ok: boolean;
        intent?: string;
        result?: {
          original: string;
          formatted: string;
          changes: string[];
          warning: string | null;
        };
        roundTripped?: boolean;
        error?: string;
      }
    | undefined;

  const busy = fetcher.state !== "idle";
  const result = data?.intent === "format" && data.ok ? data.result : undefined;

  async function pickProduct() {
    const selected = await (window as any).shopify.resourcePicker({
      type: "product",
      action: "select",
    });
    if (selected && selected[0]) {
      setProductId(selected[0].id);
      setProductTitle(selected[0].title);
    }
  }

  function runFormat() {
    if (!productId) return;
    fetcher.submit(
      { intent: "format", productId, level },
      { method: "post", action: "/app/format" },
    );
  }

  function save() {
    if (!productId || !result) return;
    fetcher.submit(
      { intent: "save", productId, formattedHtml: result.formatted },
      { method: "post", action: "/app/format" },
    );
  }

  return (
    <s-page heading="AI Description Formatter">
      <s-section heading="1. Choose a product">
        <s-stack direction="horizontal" gap="base" align="center">
          <s-button onClick={pickProduct}>Select product</s-button>
          {productTitle ? <s-text>{productTitle}</s-text> : null}
        </s-stack>
      </s-section>

      <s-section heading="2. Formatting level">
        <s-stack direction="horizontal" gap="base">
          {FORMATTING_LEVELS.map((l) => (
            <s-button
              key={l}
              variant={l === level ? "primary" : "secondary"}
              onClick={() => setLevel(l)}
            >
              {l}
            </s-button>
          ))}
        </s-stack>
        <s-button
          variant="primary"
          onClick={runFormat}
          disabled={!productId || busy}
          {...(busy ? { loading: "" } : {})}
        >
          Format description
        </s-button>
      </s-section>

      {result ? (
        <s-section heading="3. Before / after">
          {result.warning ? (
            <s-banner tone="warning">{result.warning}</s-banner>
          ) : null}
          <s-stack direction="horizontal" gap="large">
            <s-box flex="1">
              <s-heading>Original</s-heading>
              <HtmlPreview html={result.original} />
            </s-box>
            <s-box flex="1">
              <s-heading>Formatted</s-heading>
              <HtmlPreview html={result.formatted} />
            </s-box>
          </s-stack>

          <s-section heading="What changed">
            {result.changes.length ? (
              <s-unordered-list>
                {result.changes.map((c, i) => (
                  <s-list-item key={i}>{c}</s-list-item>
                ))}
              </s-unordered-list>
            ) : (
              <s-text>No structural changes were needed.</s-text>
            )}
          </s-section>

          <s-button variant="primary" onClick={save} disabled={busy}>
            Save formatted draft
          </s-button>
          {data?.intent === "save" && data.ok ? (
            <s-banner tone={data.roundTripped ? "success" : "critical"}>
              {data.roundTripped
                ? "Saved to draft metafield and verified round trip."
                : "Saved, but the read-back did not match."}
            </s-banner>
          ) : null}
        </s-section>
      ) : null}
    </s-page>
  );
}
```

> Polaris web-component names/props (`s-box` flex, `loading`, list components)
> should be confirmed against the Polaris web components reference as you build —
> the structure above is the target. If a specific prop differs in the installed
> Polaris version, adjust to the documented equivalent; the layout and data flow
> do not change. The iframe content is already allowlist-sanitized server-side
> (Task 4) and rendered with `sandbox=""` (no script/form/same-origin), so the
> preview cannot execute anything.

- [ ] **Step 2: Type-check**

Run: `npm run typecheck`
Expected: no type errors. (The `window.shopify` cast to `any` avoids needing the
App Bridge global types for the POC.)

- [ ] **Step 3: Prepare a test product on the dev store**

In the Shopify admin, pick (or create) a product and set its description to a
flat, unformatted blob that mimics an ERP sync — no headings or lists, e.g.:

```
Soft merino wool crewneck. Features: temperature regulating, machine washable, tagless collar. Available in navy and heather grey. Care: machine wash cold, lay flat to dry.
```

- [ ] **Step 4: Run the app**

Run: `shopify app dev`
Open the app in the admin.

- [ ] **Step 5: Verify the full happy path (live Anthropic + Admin API)**

This is the brief's required live check. In the app:
1. Click **Select product** → pick the test product. Its title appears.
2. Leave level at **Balanced** → click **Format description**.
3. Confirm the right panel shows the same words with restored structure (a
   heading and a bulleted feature list), the left panel shows the original flat
   text, and the "What changed" list is populated.
4. Switch the level to **Light**, re-format → confirm the output has **no
   heading** (paragraphs/lists only), demonstrating the level control + allowlist
   work.
5. Switch to **Full**, re-format → confirm richer structure (e.g. emphasized
   terms).
6. Click **Save formatted draft** → confirm the success banner says the round
   trip verified.
7. In the Shopify admin, open the product's Metafields and confirm
   `custom.formatted_description_draft` contains the formatted HTML, and the live
   product **description is unchanged**.

- [ ] **Step 6: Commit**

```bash
git add app/routes/app._index.tsx
git commit -m "feat: formatter UI with picker, level control, sandboxed preview, save"
```

---

## Task 10: Final pass — README and full test run

**Files:**
- Create: `README.md`

- [ ] **Step 1: Run the full unit suite**

Run: `npm test`
Expected: all pure-logic tests pass (formatting-levels, sanitize, format-prompt,
format-description postProcess).

- [ ] **Step 2: Write a short README**

Create `README.md` describing: what the app does, the one-thing scope (formatting
restoration only), the deliberate out-of-scope note (no batch, no data
normalization, no SEO — per `docs/design.md`), how to run it (`shopify app dev`),
where the editable prompt lives (`app/lib/format-prompt.ts`), and that write-back
targets a draft metafield (not the live description) with the one-line path to
promote it (`productUpdate`). Include the `.env.example` keys.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add README with scope, run instructions, and prompt location"
```

---

## Notes for the implementer

- **Order matters for the seam between pure and live code.** Tasks 3–6 are pure
  and fully testable offline. Task 7 onward touches the live dev store and the
  real Anthropic API; do not attempt those before Task 1's auth is confirmed.
- **The prompt is the iteration surface.** `app/lib/format-prompt.ts` is meant to
  be edited freely after the build — changing a level block does not require code
  changes elsewhere.
- **Two layers of safety on the rendered HTML.** The server sanitizes against the
  level's tag allowlist (Task 4), and the UI renders the result in a `sandbox=""`
  iframe (Task 9). Never render formatter output directly into the app DOM —
  always through the sandboxed `HtmlPreview`.
- **Scaffold-path caveat.** Exact import paths (`../shopify.server`) and Polaris
  component props come from the generated template and the installed Polaris
  version. Where this plan and the scaffold disagree, the scaffold wins — adjust
  the import/prop and keep the data flow identical.
- **Keep it POC-honest.** Per the spec, no extra error handling, retries, or
  edge-case tests beyond what is written here. The happy path must run live; that
  is the bar.
