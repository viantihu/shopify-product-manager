# Content-Rewriter Recipe — Design Document

**Status:** Approved in brainstorming (2026-06-23). No code is written until this
spec is reviewed and an implementation plan is approved.

**Builds on:** the product-completeness agent
(`docs/superpowers/specs/2026-06-20-product-completeness-agent-design.md`). That
design ships four recipes and the autonomy harness (gate, before-image, decision
log). This adds a fifth recipe, `content-rewriter@1`, the first one that changes a
product's *words* rather than its presentation or metadata. It exercises the harness's
claim that new, riskier recipes are accommodated cleanly: a substance-changing recipe
that always stays in front of a human.

---

## 1. What we are building and why

The four existing recipes leave one gap untouched: when a description's **words
themselves are low quality** — run-on sentences, grammar errors, incoherent or
child-like copy — no recipe improves them. The `description-formatter` deliberately
preserves wording byte-for-byte (that preservation is exactly what earns it
auto-apply), so it can only ever produce *correctly-formatted bad copy*. Improving the
words is a different operation.

`content-rewriter@1` is that operation: it improves the prose of a product
description — tone, clarity, grammar, coherence — using **only the facts already
present in the source**.

### 1.1 Why this validates the harness

A rewriter changes words, so its `textPreserved` factor is `false` by definition.
Through the existing gate that means it **always stages for human review and never
auto-applies**. That is not a limitation to work around; it is the trust model working
as designed — a riskier operation (substance change) stays in front of a human until a
recipe earns more autonomy. The recipe slots into the fixed set without touching the
gate's decision logic, which is the point: the harness accommodates a new, riskier
recipe by routing it to a human, not by special-casing it.

It is also a concrete instance of the project's recurring thesis — *low-quality input
produces confidently-structured low-quality output*. Here the agent improves the input
quality itself, not just its presentation.

### 1.2 The central risk: fabrication

The real hazard of rewriting is not bad tone; it is **inventing claims** — adding a
spec, number, or feature that was never in the source ("waterproof to 50m" on a product
that never claimed it). The design treats fabrication as the thing to guard against,
with two layers: a hard prompt rule, and a second-pass LLM fact-check that compares the
rewrite against the source and records what (if anything) it added. The human reviewer
is the ultimate backstop; the fact-check makes their job easy by surfacing exactly what
to look at.

---

## 2. Scope decisions (settled in brainstorming)

These were decided during brainstorming and are **not** open questions:

1. **Words-only; stays a separate recipe.** The rewriter improves prose and returns it
   in light paragraph structure. The `description-formatter` still owns structure
   (headings, lists). Two distinct recipes with single responsibilities.
2. **Two-pass: rewrite + fact-check.** The recipe makes two LLM calls internally — a
   rewrite call, then a separate fact-check call. Both live in the recipe, where every
   other recipe's LLM calls live; the harness stays pure.
3. **On fabrication: stage and flag loudly — never silently drop.** A failed
   fact-check does not block or auto-retry. The proposal is still staged (it was going
   to stage anyway); the verdict and the list of added claims ride along so the human
   decides with eyes open.
4. **Trigger: agent judgment, conservative default.** The rewriter joins the recipe set
   the agent considers. The system prompt instructs it to invoke the rewriter only when
   prose has clear quality problems and to leave decent copy alone — mirroring the
   existing "prefer leaving a field alone when unsure" instinct.
5. **Coexistence: mutually exclusive; rewriter wins.** When a description needs
   rewriting, the agent runs the rewriter and **not** the formatter (reformatting words
   about to be replaced is wasted). The rewriter emits light `<p>` structure so a
   rewritten description is never a wall of text while it waits for review. Net effect:
   at most one description decision per product per run.

### 2.1 Out of scope (deliberately)

- Merchant opt-in / preset controls for the rewriter. The rewriter is in the standard
  agent-considered set; bounded merchant presets remain a separate future direction.
- Auto-retry or self-correction loops on a failed fact-check. The human is the backstop.
- Any change to the gate's auto-vs-stage logic. The rewriter stages via the existing
  default-deny path; the fact-check is recorded data, not a gate factor that flips the
  decision.
- Trust scoring, replay, sampling, rollback — same seams-only posture as the parent
  design.

---

## 3. The recipe — `app/recipes/content-rewriter.ts`

A new recipe following the established pattern (`run()` returns a `RecipeProposal`),
but making **two** schema-constrained Claude calls instead of one.

### 3.1 Pass 1 — Rewrite

A `messages.parse` + zod call, like the other recipes.

- **Input:** the original description + read-only product context (title, productType,
  vendor).
- **Output schema:** `{ rewrittenHtml: string, changes: string[] }`.
- **Prompt carries two rules:**
  - *Anti-fabrication (hard rule):* improve tone, clarity, and grammar using only facts
    present in the source. Never add, invent, embellish, or infer a claim, spec,
    feature, or number that the original did not state.
  - *Light structure only:* wrap prose in basic paragraph tags (`<p>`). Do not infer
    headings or lists — that is the formatter's job.
- **Post-processing:** sanitize `rewrittenHtml` with `sanitizeHtml` (from
  `app/lib/sanitize.ts`) against a dedicated minimal allowlist of `["p", "br"]`. This is
  intentionally narrower than every `formatting-levels` level (which all include
  list/heading tags): the rewriter must not introduce headings or lists, so it gets its
  own constant rather than reusing a `FormattingLevel`.

### 3.2 Pass 2 — Fact-check

A second `messages.parse` + zod call, deliberately separate from the writer so it does
not grade its own work.

- **Input:** the original description and the (post-sanitized) rewrite.
- **One narrow question:** does the rewrite assert any claim, spec, number, or fact not
  present in the original?
- **Output schema:** `{ factsPreserved: boolean, addedClaims: string[] }`.
  `addedClaims` lists each fabricated assertion in plain language; empty when
  `factsPreserved` is true.

### 3.3 The resulting proposal

`RecipeProposal` (in `app/recipes/types.ts`) gains one optional field:

```ts
factCheck?: { factsPreserved: boolean; addedClaims: string[] };
```

The rewriter's proposal:

- `recipe: "content-rewriter"`, `version: "1"`, `field: "descriptionHtml"`.
- `after`: the sanitized rewritten HTML.
- `agentReason`: a one-line summary from `changes`.
- `textPreserved: false` — words changed, so the gate stages it.
- `factCheck`: the pass-2 verdict.

`factCheck.factsPreserved` is the rewriter's own recorded factor — the analog of
`textPreserved` for this recipe, and a real signal the trust report card can read later
("how often did this recipe try to fabricate?"). It is **recorded**, not used by the
gate to change the decision.

### 3.4 Cost note

Two Claude calls per rewrite instead of one. Accepted: rewriting fires rarely (only on
genuinely bad copy), and the verification is the point of the recipe.

---

## 4. Agent wiring

A new tool joins the **closed** registry; the loop and dispatch map gain one entry
each; the system prompt gains the trigger and coexistence rules.

- **`app/agent/tools.ts`** — add a `rewrite_description` tool spec: "Rewrite a
  description's prose for clarity and quality. Use only when the wording itself is poor
  (run-ons, grammar errors, incoherent or unprofessional copy), not merely unstructured."
- **`app/agent/recipe-dispatch.server.ts`** — wire `"rewrite-description"` →
  `rewriter.run({ description, context })`.
- **`app/agent/loop.ts`** — add `rewrite_description: "rewrite-description"` to the
  `RECIPE_TOOL` map. No other loop logic changes; the recipe returns a single
  `RecipeProposal` and flows through `proposeChange` like the others.
- **`app/agent/system-prompt.ts`** — add:
  - *Trigger:* invoke `rewrite_description` only when the description's prose has clear
    quality problems; leave decent copy alone.
  - *Coexistence:* if a description needs rewriting, run the rewriter and not the
    formatter. The two target the same field; do not run both on one product.

**Accepted edge:** the agent could misjudge and format prose that actually needed
rewriting, producing correctly-formatted poor copy. That is no worse than today and a
later sync or a human catches it. The conservative prompt is the mitigation; no
machinery is added to prevent a judgment miss.

---

## 5. Harness and persistence

The gate is **untouched**. `content-rewriter` is not `description-formatter`, so the
gate's existing default-deny path stages it. The fact-check never changes the
auto-vs-stage decision; it is recorded alongside it. (A `gate.test.ts` case is added to
assert the rewriter stages.)

**Schema — one new nullable column on `Decision`** (`prisma/schema.prisma`):

```prisma
factCheck String?   // JSON: { factsPreserved: boolean, addedClaims: string[] }; null for non-rewriter recipes
```

Nullable JSON-as-string, consistent with how `before`/`after` encode structured fields.
Additive migration, no backfill. Every other recipe leaves it null.

**Carry-through (no new decision points).** The field rides the existing write path:
`RecipeProposal.factCheck` → `proposeChange` copies it onto the `NewDecision` →
`createDecision` persists it. This matches the spec's "signals are stored as data from
day one, not computed" principle (parent design §4.3).

---

## 6. Review UI

The before/after rendering already handles `descriptionHtml` via the sandboxed iframes,
so the rewrite shows in the existing diff view unchanged.

**`app/routes/app.decision.$id.tsx`** — add one conditional section, shown only when
`decision.factCheck` is present:

- `factsPreserved === true`: a quiet confirmation line ("Fact-check: no added claims
  detected").
- `factsPreserved === false`: a prominent warning listing each entry in `addedClaims`,
  so the reviewer reads exactly what the rewrite added before deciding. This is what
  "flag loudly" means concretely.

The three verdict actions (approve / edit / reject) are unchanged — they already write
`descriptionHtml` through the same `writeDescription` path the formatter uses. **Edit &
approve** is the natural rescue path: the reviewer strips a flagged claim and keeps the
rest.

**`app/routes/app._index.tsx`** — optional: a small badge on staged rewriter rows when
`factsPreserved` is false, so a fabrication-flagged item is visible before it is opened.
Minor nicety.

---

## 7. File map

```
app/recipes/
  content-rewriter.ts          NEW   two-pass: rewrite() + factCheck(), returns RecipeProposal
  content-rewriter.test.ts     NEW   pure post-processing + verdict-merge tests (no live LLM)
  registry.ts                  EDIT  add "content-rewriter": { version: "1", field: "descriptionHtml" }
  types.ts                     EDIT  add optional factCheck to RecipeProposal
app/agent/
  tools.ts                     EDIT  add rewrite_description tool spec
  recipe-dispatch.server.ts    EDIT  wire "rewrite-description" -> content-rewriter.run
  loop.ts                      EDIT  add rewrite_description to RECIPE_TOOL map
  system-prompt.ts             EDIT  trigger rule + "rewriter wins over formatter" rule
app/harness/
  apply.ts                     EDIT  carry proposal.factCheck onto NewDecision
  gate.test.ts                 EDIT  assert content-rewriter stages (textPreserved false)
app/routes/
  app.decision.$id.tsx         EDIT  conditional fact-check section (loud on failure)
  app._index.tsx               EDIT  optional flagged-fabrication badge on staged rows
prisma/schema.prisma           EDIT  Decision.factCheck String?  (+ migration)
```

`gate.ts` needs no change — the rewriter stages via the existing default-deny.

---

## 8. Testing

TDD, matching existing conventions (`format-description.test.ts`). Pure unit tests are
the backbone:

- **Recipe post-processing:** sanitization to the `<p>` allowlist; merge of pass-1
  output + pass-2 verdict into a `RecipeProposal`, covering both `factsPreserved: true`
  and `factsPreserved: false` (with `addedClaims` populated). The two LLM calls are not
  hit live; the pure functions around them are tested.
- **Gate:** a case asserting `content-rewriter` stages.

UI is verified manually in the dev-store run (§9).

---

## 9. Definition of done

Run the app on the dev store and edit/sync a product with a genuinely badly-written
description (the snowboard run-on paragraph is the canonical case):

1. **Agent reaches for the right recipe.** The tool-call trace shows the agent
   assessing the prose as low-quality and calling `rewrite_description` — and **not**
   `format_description` — for that product.
2. **Always staged.** The rewrite is staged, never auto-applied, and appears in the
   review queue.
3. **Fact-check is visible.** Opening the decision shows before/after prose plus the
   fact-check section: clean when no claims were added; a loud warning listing
   `addedClaims` when the checker flagged fabrication.
4. **Verdicts write correctly.** Approve writes the rewrite; edit & approve lets the
   reviewer strip a flagged claim; reject writes nothing — each stamping the Decision
   row with the right `status` and `reviewerVerdict`.
5. **Signal is queryable.** `Decision.factCheck` holds the structured verdict for
   rewriter rows and is null for the other four recipes.
6. **No regression.** A product that only needs structure (good words) still gets the
   formatter auto-applied. A product that needs both gets the rewriter only.

Trust scoring, replay, sampling, and rollback remain explicitly out of scope.
