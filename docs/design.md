# AI Description Formatter — Design Document

**Status:** Draft for review (v3 — reframed around the real business case).
No code will be written until this is approved.

**Project:** Proof-of-concept embedded Shopify admin app that takes a product
description that arrived from an ERP system as flat, unformatted text and uses an
LLM to **restore presentation structure** (headings, lists, emphasis, paragraph
breaks) as clean HTML — then shows a rendered before/after and saves the result
back to the product safely.

> **Version history.** v1 proposed a Remix stack; v2 corrected it to Shopify's
> current React Router template. v3 (this version) reframes the *product* around
> the business case below: the center of gravity is the **description field and
> its formatting**, not a general data-normalization schema. The stack decisions
> from v2 are unchanged and confirmed against Shopify's live docs via the Dev MCP.

---

## 1. The business case (why this exists)

A client discovered that product descriptions syncing from their ERP into Shopify
arrive with **all formatting stripped** — no headings, no lists, no emphasis, just
a wall of text. That formatting is exactly what makes a product page look
intentional and trustworthy. Restoring it is normally manual work.

The people who feel this pain are **ecommerce and marketing teams**, who otherwise
spend days hand-formatting product copy before a new product-line drop or in the
crunch of a system-migration cutover. The tool's promise is to collapse those days
into a review-and-approve pass: the AI proposes the formatting, a human glances at
the before/after, and applies it.

This framing drives every decision below:
- The **output is formatted description HTML**, not a broad data schema.
- The **preview is a rendered before/after** of the description, because the value
  is visual — a JSON diff wouldn't show it.
- **Write-back is core, not a stretch.** A preview-only tool proves the AI *can*
  format; it doesn't deliver the "saves the team days" value. But the write is
  **non-destructive** (see §4) so the demo never clobbers live copy.

### Out of scope (deliberately)

The earlier drafts proposed a full normalized storefront object (name, category,
specs, highlights, SEO, variant reshaping). That's a real adjacent idea, but it's
broader than the client's actual pain and dilutes the story. **This POC does one
thing: restore formatting to the description.** Title, variants, price, tags, and
metafields are read only as *context* the model may use to format well — they are
never modified.

---

## 2. What the AI does (and the hard boundary)

**Input:** the product's current description (the flat text synced from the ERP),
plus light read-only context (title, product type, vendor) so the model can make
sensible structural choices.

**Output:** the same description, marked up as clean HTML — headings for section
breaks, `<ul>`/`<ol>` for lists, `<strong>`/`<em>` for emphasis, real `<p>`
paragraph breaks.

**The hard boundary — structure, not substance:**
The AI may add formatting markup, fix obvious paragraph/line breaks, and tidy
whitespace. It may **not** reword sentences, add claims, remove information, or
change any fact, number, or product detail. The text a customer reads must be the
same text the ERP supplied — only its *presentation* changes. If the model is
unsure whether something is a heading or a list item, it leaves it as a paragraph
rather than inventing structure.

This is a stricter, cleaner boundary than generic "normalize but don't fabricate":
here the AI is a formatter, not a copywriter. It's also the more defensible
position for the teams who own this copy — they trust the words; they just need
them to look right.

**Allowed HTML tag set (allowlist):** `h2`, `h3`, `p`, `ul`, `ol`, `li`,
`strong`, `em`, `br`, `a`. Anything outside this set is stripped before preview
and before write. This keeps output safe and matches what Shopify themes reliably
render. (The *effective* allowlist narrows per formatting level — see §3.)

---

## 3. Formatting level (user-controlled aggressiveness)

The user chooses **how aggressively** the AI imposes structure. Because the AI
never changes wording, "aggressiveness" is not "how much it rewrites" — it's **how
willing the model is to infer structure that the source text only implies.** Low
means format only what's unambiguous; high means infer headings and lists from
prose patterns even when the ERP text didn't delimit them. The knob stays entirely
inside the structure-not-substance boundary.

**Control: three named presets** (a Polaris segmented/choice control —
`Light` / `Balanced` / `Full`, default `Balanced`). Presets beat a slider or a
checklist here because the axis is genuinely one-dimensional ("how much inference"),
each level is a fixed, explainable prompt block (reproducible run to run), and
"the same description at Light vs Full" is a strong before/after for the demo and
the article.

| Level | Inference posture | Effective tag allowlist |
| --- | --- | --- |
| **Light** | Only format what's explicit: existing line breaks become paragraphs; a literal `1. 2. 3.` or bullet sequence becomes a list. No inferred headings. | `p`, `br`, `ul`, `ol`, `li` |
| **Balanced** (default) | Add headings and lists where the text *clearly* implies them (e.g. a "Features:" line followed by short clauses). Ambiguous text stays as paragraphs. | `p`, `br`, `h2`, `h3`, `ul`, `ol`, `li` |
| **Full** | Infer structure from prose patterns; promote run-on feature sentences to lists; emphasize key terms. Most polished, most inference. | `p`, `br`, `h2`, `h3`, `ul`, `ol`, `li`, `strong`, `em`, `a` |

**How it threads through the system** (one axis, four touch-points):
1. **UI** — a segmented control on the form; the chosen level submits with the
   product ID.
2. **Action** — reads the level from the submitted form data.
3. **Prompt** — selects the matching guidance block from `format-prompt.ts` (the
   three blocks live side by side in that one editable file, so you can tune each
   level's behavior independently).
4. **Sanitizer** — applies that level's tag allowlist, so even if the model
   over-reaches, `Light` output can't contain a heading. The allowlist is the
   structural backstop for the prompt instruction.

This makes the level *enforced*, not just *requested* — the prompt asks for the
right posture and the allowlist guarantees the ceiling.

---

## 4. The transformation approach

### 4.1 Where the call lives

A single server-side React Router route (an `action`) is the only place the LLM
is called; the Anthropic API key never reaches the browser. The route:

1. Receives a product ID **and the chosen formatting level** from the UI.
2. Authenticates with `authenticate.admin(request)` and uses the returned
   `admin.graphql(...)` client to read the product's `descriptionHtml`, `title`,
   `productType`, and `vendor`. (Built-in template auth — managed OAuth/session,
   no token handling.)
3. Calls one isolated module — `app/lib/format-description.server.ts` — passing the
   raw description, the read-only context, and the level; gets back the formatted
   HTML.
4. Returns `{ original, formatted, changes, level }` to the UI for the rendered
   before/after.

Server-only modules keep the `.server.ts` suffix under React Router (same as
Remix), so the SDK and key are never bundled to the client.

### 4.2 The formatter module (the part you'll write about)

`app/lib/format-description.server.ts` exposes one function,
`formatDescription({ description, context, level })`, and is small and readable:
- Selects the prompt block for `level` (`Light` | `Balanced` | `Full`) from the
  prompt file.
- Calls Claude (`claude-opus-4-8`) with the description + context.
- Constrains output to a tiny schema — `{ formattedHtml: string, changes:
  string[] }` — via the Anthropic SDK's schema-validated output
  (`messages.parse()` + Zod). `changes` is a short list of what the model did
  ("Added 3 section headings", "Converted feature paragraph to a bullet list"),
  which feeds the "what changed" panel and gives you concrete detail for the
  write-up.
- Runs the returned HTML through the sanitizer using **that level's** tag allowlist
  (see §3) before returning.

Provider/model are read from env vars (`LLM_PROVIDER`, `LLM_MODEL`,
`ANTHROPIC_API_KEY`) so swapping models or providers is a config change.

### 4.3 The prompt (the part you'll iterate on)

The prompt lives in its own clearly-labeled file —
`app/lib/format-prompt.ts` — not buried in logic. It holds a shared preamble plus
**three guidance blocks, one per formatting level**, so you can tune each level
independently. The assembled prompt contains:
- The role: "you are a formatter; restore structure, never change wording."
- The structure-not-substance rule, stated explicitly with examples.
- The selected level's guidance block (its inference posture from §3) and that
  level's allowed tag set.
- The raw description and the read-only context, injected in.

The output *shape* is enforced by the schema; the prompt's job is the *editorial
judgment* (when something is a heading vs a list vs a paragraph, and how much to
infer at this level). Keeping them separate lets you tune the prompt without
breaking output validity.

### 4.4 Handling a bad LLM response

1. **Schema validation (primary):** malformed shape is caught and retried by the
   SDK before we see it.
2. **Tag-allowlist sanitization:** any tag outside the selected level's allowed
   set is stripped, so the preview and any write only ever contain safe,
   theme-renderable markup — and `Light` output can't smuggle in a heading.
3. **Text-preservation check (lightweight):** strip tags from both original and
   formatted, normalize whitespace, and compare. If the visible text diverges
   beyond whitespace, flag it in the UI ("⚠ wording may have changed — review
   carefully") rather than silently trusting it. This operationalizes the
   structure-not-substance rule cheaply, without trying to be a perfect diff.
4. **Factual integrity beyond that is a human check** — the rendered before/after
   is the reviewer's tool, exactly as a marketing lead would use it.

---

## 5. Write-back (core, and safe)

The value is "saves the team days," so the round trip is part of the POC, not a
stretch. But the demo must never overwrite live copy on the dev store.

**Safe target:** write the formatted HTML to a **metafield** —
`custom.formatted_description_draft`, type `multi_line_text_field` — via the
`metafieldsSet` mutation. Then re-read it to prove the round trip.

**Why a `multi_line_text_field` metafield and not the live field or a rich-text
metafield:**
- Writing to a metafield (not `descriptionHtml`) means the live product page is
  untouched — the formatted version sits in a "draft" slot the team can inspect.
- A `multi_line_text_field` holds the **exact HTML string** that would eventually
  go into `descriptionHtml`. So the saved draft is byte-for-byte what would go
  live — the preview, the saved value, and the future real write are all the same
  HTML. (Shopify's `rich_text_field` metafield stores a *different*, structured-JSON
  format — using it would force a second output shape and break that 1:1 mirror.
  Confirmed via Dev MCP.)
- **Promoting to live later is a one-line change:** swap the `metafieldsSet` call
  for `productUpdate(input: { id, descriptionHtml })`. The doc notes this as the
  obvious next step beyond the POC.

**Scope:** writing the metafield needs `write_products` in `shopify.app.toml`
(reads alone need only `read_products`).

---

## 6. Architecture sketch

```
┌─────────────────────────────────────────────────────────────┐
│ Embedded Admin App (React Router + Polaris web components,     │
│ in Shopify admin via App Bridge)                               │
│                                                               │
│  ┌──────────────┐   ┌──────────────────────────────────────┐ │
│  │ Resource     │   │ [Light] [Balanced]* [Full]  ← level    │ │
│  │ Picker       │──►│ Rendered before / after of the         │ │
│  │ (product)    │   │ DESCRIPTION  +  "what changed" panel    │ │
│  └──────────────┘   │           [ Save formatted draft ]      │ │
│                     └──────────────────────────────────────┘ │
└───────────────────────────────┬───────────────────────────────┘
                                 │ (1) product id + level
                                 ▼
┌─────────────────────────────────────────────────────────────┐
│ Server-side React Router route  (app/routes/app.format.tsx)   │
│                                                               │
│  authenticate.admin(request) → { admin, session }             │
│  (2) admin.graphql: product(id:) {                            │
│        descriptionHtml, title, productType, vendor }          │
│                          │                                    │
│                          ▼                                    │
│  (3) format-description.server.ts ── reads block[level] ──►   │
│         │                              format-prompt.ts        │
│         ▼  Claude (claude-opus-4-8), schema-constrained        │
│         ▼  → { formattedHtml, changes }                        │
│         ▼  → sanitize with allowlist[level]                    │
│                          │                                    │
│                          ▼                                    │
│  (4) returns { original, formatted, changes, level } to UI    │
│                                                               │
│  [Save] → admin.graphql: metafieldsSet(                       │
│      namespace:"custom", key:"formatted_description_draft",   │
│      type:"multi_line_text_field", value: formattedHtml)      │
│      → re-read to confirm round trip                          │
└─────────────────────────────────────────────────────────────┘
   (beyond POC) swap metafieldsSet → productUpdate(descriptionHtml)
   to publish to the live description
```

**Flow in words:** pick a product and a formatting level → server reads its
description + light context → formatter module picks the level's prompt block, sends
it to Claude → HTML comes back, gets sanitized against the level's allowlist → UI
renders the original and the formatted version side by side with a "what changed"
list → one button saves the formatted HTML into a draft metafield and re-reads it to
prove the round trip. Changing the level and re-running gives an instant
Light-vs-Full comparison.

### Stack specifics (current Shopify best practices, confirmed via Dev MCP)

- **Scaffold:** `shopify app init` → **"Build a React Router app"** (the
  actively-maintained `@shopify/shopify-app-react-router` template; gives OAuth,
  session, webhooks out of the box).
- **Local dev:** `shopify app dev` (CLI tunnels via Cloudflare to HTTPS, installs
  on your dev store).
- **Admin access:** `authenticate.admin(request)` → `admin.graphql` client.
  Read with `product(id:)`; write with `metafieldsSet` (POC) and, beyond the POC,
  `productUpdate`.
- **UI:** Polaris **web components** (`s-page`, `s-section`, `s-stack`,
  `s-button`, `s-text`, …) from `cdn.shopify.com/shopifycloud/polaris.js`, with
  `@shopify/polaris-types@latest`. The rendered HTML preview is shown in a bounded
  container. (Web components are the current recommended approach for App Home,
  API 2025-10+; this replaces the older React `@shopify/polaris` library.)
- **Product selection:** App Bridge **Resource Picker API** —
  `window.shopify.resourcePicker({ type: "product", action: "select" })`.

### Files that will exist

```
app/
  routes/
    app._index.tsx              # picker + level control + before/after + Save (Polaris web components)
    app.format.tsx              # action: read description, call formatter w/ level, return result; Save → metafield
  lib/
    product.server.ts           # Admin GraphQL read + metafield write/read-back
    format-description.server.ts# the isolated AI formatter module (takes a level)
    format-prompt.ts            # shared preamble + 3 level guidance blocks  ← you iterate here
    formatting-levels.ts        # the Light/Balanced/Full enum + per-level tag allowlists
    sanitize.ts                 # tag-allowlist sanitizer + text-preservation check
  shopify.server.ts             # provided by the template (authenticate, session)
.env.example                    # ANTHROPIC_API_KEY, LLM_PROVIDER, LLM_MODEL
shopify.app.toml                # scopes: read_products, write_products
```

---

## 7. Resolved decisions (previously open)

1. **Formatting aggressiveness → user-controlled, 3 presets.** Light / Balanced /
   Full, default Balanced; implemented as prompt blocks + per-level tag allowlists.
   See §3. (Resolved: presets over a slider or checklist, for reproducibility and a
   clean before/after demo.)
2. **"What changed" panel → keep.** Cheap (the model already knows what it did),
   builds reviewer trust, and gives concrete material for the Substack piece ("the
   AI reported converting 4 run-on paragraphs into a spec list").
3. **Input source → `descriptionHtml`.** Confirmed: the client's ERP syncs product
   copy into the native Shopify product description field, so that is the read
   source. (No metafield-source branch needed.)
4. **Single product only → confirmed.** Batch formatting (a whole product-line drop
   at once) is the obvious real-world extension and a natural thing to gesture at in
   the write-up, but it is explicitly out of scope for this POC. This exclusion will
   be called out in the public GitHub repo / Substack article.

---

## 8. Definition of done

Run the app on the dev store (`shopify app dev`), pick a product whose description
is flat ERP-synced text, choose a formatting level (Light / Balanced / Full), and
see a rendered before/after where the AI has restored headings, lists, and emphasis
to the depth that level allows — with a "what changed" summary — then click Save and
confirm the formatted HTML round-tripped into the draft metafield. Re-running at a
different level visibly changes the output. The prompt lives in
`app/lib/format-prompt.ts`, a file you can open and edit.
