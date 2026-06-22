# Product Completeness Agent — Design Document

**Status:** Approved in brainstorming (2026-06-20). No code is written until this
spec is reviewed and an implementation plan is approved.

**Supersedes:** the manual, single-product AI Description Formatter
(`docs/design.md`). That prototype required a human to trigger formatting for each
product one at a time, which is no better than pasting a description into a chatbot.
This design reworks the tool into an event-driven, agentic system.

---

## 1. What we are building and why

A merchant's ERP syncs products into Shopify with quality gaps: descriptions
arrive as unformatted walls of text, product type and vendor are sometimes blank,
SEO meta fields are weak or missing, and images lack alt text. Today a human has to
notice and fix each of these, product by product.

This project rebuilds the tool as a **product-completeness agent**: when a product
syncs in, the agent inspects it, decides which gaps it has, proposes fixes through a
bounded set of actions, and either applies safe fixes automatically or stages risky
ones for human review. No human trigger per product.

Two goals carry equal weight:

1. **Real automation.** The per-product manual trigger is gone. Work starts from a
   Shopify webhook.
2. **A genuine reasoning agent.** Not an LLM-as-a-function with fixed steps, but an
   LLM in a loop that decides *which* recipes apply to a given product, proposes
   changes, and stops when done. The agent is the point; it is the thing being
   learned and written about.

### 1.1 The guiding concept: autonomy earned in the harness

The design is shaped by a concept from Vibhu Bhatnagar's essays on agent autonomy
("How Agent Autonomy Is Earned in the Harness: Fixed Tools, Version-Controlled, and
Closed"). The relevant model:

- **The harness makes autonomy safe.** An agent earns the right to act on its own not
  because we trust the model in the abstract, but because it operates inside a harness
  with three properties: a **fixed (closed) set of tools**, **version-controlled**
  (every action recorded and reversible), and a **closed loop** (bounded inputs and
  outputs). More autonomy does not mean more risk, because the harness bounds the
  blast radius.
- **Trust attaches to a recipe, not to "the AI."** Trust is a multi-component report
  card earned by a *specific, versioned recipe* running through the fixed toolset. Its
  four components are **measured coverage** (does the recipe handle the cases it
  claims to), **replay performance** (re-running it against past inputs behaves
  correctly and consistently), **reviewer agreement** (how often a human validates its
  verdict — weighted highest, because only a human catches the quietly-wrong cases),
  and **volume** (enough runs to be a track record, not a lucky streak). Sampled
  review keeps this cheap ("cents, not dollars") — a representative sample, not every
  decision. The closed toolset is what makes the score trustworthy at all: you are
  scoring a known, versioned recipe through a fixed set of actions, not an AI with
  unknown reach, and you can replay old runs precisely because the boundary is fixed.
- **The autonomy gate** is the checkpoint in front of the agent acting alone. It is
  **multi-factor** (coverage, replay, reviewer agreement, volume — checked together)
  and **atomic** (all factors must clear at once; no partial credit). Autonomy is "a
  lifecycle state instead of a prompt-level wish" — a status a recipe earns, enforced
  by the gate.
- **Demote-with-rollback.** When an auto-applied change turns out bad, the change is
  rolled back (possible only because everything is version-controlled) *and* the
  recipe's autonomy is demoted (trust drops, it returns to staging).

**Scope decision for this prototype:** we build the *seams* for this model, not its
*behavior*. The harness properties (fixed tools, before-images, closed loop) ship now
and are real. The gate ships with its atomic structure but **static** factors. The
decision log captures every signal the trust report card will need. We do **not**
build trust scoring, replay, sampling, or the rollback action. The explicit success
criterion for the seams is in §9.

### 1.2 The agent's job: product completeness

The agent inspects each incoming product and decides what it needs across four
completeness dimensions, each implemented as an independent **recipe**:

| Recipe (id @ version)        | Gap it addresses                                   |
| ---------------------------- | -------------------------------------------------- |
| `description-formatter@1`    | Flat ERP description → structured HTML (existing logic) |
| `product-type-inferrer@1`    | Missing/blank `productType`                        |
| `seo-meta-generator@1`       | Missing/weak SEO title + description                |
| `image-alt-text@1`           | Images with no alt text                            |

The agent (a "manager" loop) decides which recipes apply to a given product; each
recipe produces a proposed change; each change is routed through the gate.

### 1.3 Out of scope (deliberately)

- Trust score computation, replay engine, sampled-review sampler, rollback action,
  and any trust dashboard UI. Seams only (§1.1).
- Catalog-wide "product manager" ownership of arbitrary fields/rules. The four
  recipes above are the fixed set for this prototype.
- Batch/bulk-operation triggering. One product per Job; catalog-wide work is many
  Jobs. Bulk operations are a noted future extension, not built.
- A production-grade external job queue (Redis, etc.). See §7.

---

## 2. System shape (four layers)

Each layer has one job and a single well-defined interface to the next.

```
  Shopify store
      │  products/create, products/update  (webhook)
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 1. TRIGGER LAYER                                              │
│    webhook handler — validates HMAC, enqueues a Job, 200 OK   │
│    (responds in <1s; does NO agent work inline)               │
└───────────────────────┬───────────────────────────────────── ┘
                        │ Job row in SQLite (Prisma)
                        ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. AGENT LAYER                                                │
│    worker picks up Job → runs the agent loop:                 │
│    LLM + closed tool registry, reasoning until "done"         │
│    every proposed change → asks the GATE                      │
└───────────────────────┬───────────────────────────────────── ┘
                        │ proposeChange(recipe, field, before, after)
                        ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. HARNESS LAYER                                              │
│    • autonomy gate:  auto | stage   (atomic now, static       │
│      factors)                                                 │
│    • before-image capture (version-control / rollback seam)   │
│    • decision log (input snapshot + tool trace + outcome)     │
│    auto → write to Shopify;  stage → Decision in review queue │
└───────────────────────┬───────────────────────────────────── ┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. REVIEW LAYER                                               │
│    embedded admin page: queue of staged Decisions,            │
│    before/after, approve / edit / reject → records verdict    │
│    (verdict = reviewer-agreement signal for trust later)      │
└─────────────────────────────────────────────────────────────┘
```

**Flow in words:** a product syncs in → Shopify fires a webhook → the trigger layer
validates it and enqueues a Job, nothing more → a worker runs the agent loop, which
decides which recipes apply and proposes changes → each change passes the gate, which
(statically) auto-applies safe changes or stages risky ones → staged changes wait in a
review queue for a human verdict → every step is recorded in the decision log with
enough detail to replay later.

Layers 1, 3, and 4 are fixed infrastructure. **Layer 2 is the only place the agent
reasoning lives**, cleanly isolated so the loop can be experimented with without
destabilizing the rest.

---

## 3. The agent layer (the part being learned)

### 3.1 The closed tool registry — `app/agent/tools.ts`

A single array of named tools. This array **is** the agent's entire reach; nothing
the agent does can exist outside it. That fixed boundary is what makes the trust score
mean something later (§1.1). Each tool has a name, description, Zod input schema, and a
handler. ~8 tools, grouped:

**Read / assess (no side effects):**
- `get_product` — current product state (title, descriptionHtml, productType, vendor,
  seo, images + altText). The result is recorded as the run's input snapshot.
- `assess_completeness` — the agent's structured verdict: which recipes apply and why.
  This is the *coverage* signal for trust later.

**Recipe tools (produce a proposed change; never write):**
- `format_description` → recipe `description-formatter@1` (existing formatter logic).
- `infer_product_type` → recipe `product-type-inferrer@1`.
- `generate_seo_meta` → recipe `seo-meta-generator@1`.
- `suggest_image_alt_text` → recipe `image-alt-text@1`.

Each recipe tool may call the LLM internally (a focused, schema-constrained call, like
the existing `formatDescription`). This gives a clean two-level structure: an outer
*manager* loop that reasons about the product, and recipe tools that each do one
focused LLM task and are independently scoreable.

**The single write path:**
- `propose_change` — the agent calls this to say "set field X to value Y via recipe R."
  It does **not** write to Shopify; it hands the change to the harness/gate (§4). This
  is the only chokepoint to the store.
- `finish` — the stopping condition: "assessed everything and proposed all applicable
  changes."

**Two invariants:** recipe tools *propose*, never write; the *only* way to affect the
store is `propose_change` → gate. The agent cannot bypass the gate because no tool
lets it.

### 3.2 The hand-rolled loop — `app/agent/loop.ts`

The agent loop, written directly against `@shopify/...`'s sibling `@anthropic-ai/sdk`
(already a dependency), so the mechanism is visible rather than hidden in a framework.

```
runAgent(productId):
  messages = [ system_prompt, user: "Make product <id> complete." ]
  for step in 1..MAX_STEPS:               # bounded — part of "closed"
    res = anthropic.messages(model, tools, messages)
    if res.stop_reason == "tool_use":
       for each tool_call:
         result = registry[tool_call.name].handler(tool_call.input)
         append tool_call + result to messages
       continue                            # model reasons again
    else:
       break                               # final answer → done
  return trace                             # full step-by-step record
```

The model decides *which* tools to call and in what order — that is the agency. The
loop just executes tools and feeds results back. `MAX_STEPS` and the fixed registry
are the "closed" property: bounded actions, bounded steps.

The system prompt lives in `app/agent/system-prompt.ts` and instructs the manager to:
assess the product first, propose changes only for genuine gaps, prefer leaving a
field alone when unsure, and call `finish` when done.

### 3.3 What a run records (the replay seam)

Per Job, the loop records an **input snapshot** (the product state seen via
`get_product`) and the **full tool-call trace** (every call + result). That pairing is
what lets a future replay engine re-run a recipe version against this exact input and
check consistency. Captured now; replay engine not built.

### 3.4 Recipe versioning

Each recipe tool carries a version string and records its `recipe id @ version` on
every `propose_change`. This is the anchor the trust report card hangs on later.

### 3.5 Decisions made here (not open questions)

- **One product per Job / per agent run.** The agent loops over *recipes within a
  product*, not over products. Catalog-wide work = many Jobs. Keeps each run small,
  cheap, replayable.
- **Recipe tools call the LLM internally.** Outer manager loop + focused recipe tools;
  each recipe independently scoreable.

---

## 4. The harness layer (where autonomy is made safe)

Three pieces, all built now as structure; only static behavior ships. Each is the seam
for one part of the trust model.

### 4.1 The autonomy gate — `app/harness/gate.ts`

One function, one chokepoint. Every `propose_change` lands here and nowhere else.

```
gate(change) → { decision: "auto" | "stage", reason: string }
  change = { recipe, version, field, before, after, productId, agentReason }

gate(change):
  factors = evaluateFactors(change)        # static stub today
  if ALL factors pass:  return { decision: "auto",  reason }
  else:                 return { decision: "stage", reason }
```

The gate is built **atomic** (all-or-nothing) now; the *factors* are **static**.
Today `evaluateFactors` is hardcoded by recipe: `description-formatter` that passes the
text-preservation check → auto; subjective recipes (`seo-meta-generator`,
`product-type-inferrer`, `image-alt-text`) → stage. Later, `evaluateFactors` reads the
trust report card (coverage, replay, reviewer agreement, volume). Because the gate's
signature already takes `recipe + version`, that swap touches one function. The agent
only ever receives `auto`/`stage`.

### 4.2 Before-image capture — `app/harness/apply.ts` (version-control / rollback seam)

The rule: **no write to Shopify happens without first recording the prior value.**

```
applyChange(change):
  before = readCurrentValue(change.field)   # capture FIRST
  recordBeforeImage(decisionId, before)      # persisted, immutable
  writeToShopify(change.field, change.after)
```

`recordBeforeImage` (persisted on the Decision row) is the seam. Demote-with-rollback
later reads these and re-writes the `before` value. Before-images are persisted now;
the rollback action is not built. Staged changes also carry their `before` so the
reviewer sees a true before/after. `apply.ts` is the **only** writer to Shopify, used
identically by the gate's auto-applies and by reviewer approvals.

### 4.3 The decision log — `Decision` table

The single source of truth the trust model reads later. One row per proposed change
(schema in §5). It captures, as data from day one, everything the four trust
components need: **volume** (count rows per recipe), **reviewer agreement**
(`reviewerVerdict`, highest-weighted), **replay** (`job.inputSnapshot` + `job.trace`),
**coverage** (from `assess_completeness` in the trace). Signals are *stored*, not
*computed*.

### 4.4 The three harness invariants

1. The gate is the only decider of auto-vs-stage.
2. `apply.ts` is the only writer to Shopify, and it always captures a before-image
   first.
3. Every proposed change is recorded in the Decision log with its outcome.

---

## 5. Data model (Prisma)

Three tables alongside the template's existing `Session`. SQLite + JSON columns is the
right scale for a prototype and stays fully replayable. The run's snapshot and trace
live on `Job` (one run = one snapshot+trace, one-to-one).

```prisma
model Job {
  id            String     @id @default(cuid())
  productId     String                 // gid://shopify/Product/...
  shop          String
  trigger       String                 // "products/create" | "products/update"
  status        String     @default("queued") // queued | running | done | failed
  attempts      Int        @default(0)
  error         String?
  createdAt     DateTime   @default(now())
  startedAt     DateTime?
  finishedAt    DateTime?
  inputSnapshot Json?                   // product state the agent saw (replay seam)
  trace         Json?                   // full tool-call trace (replay seam)
  decisions     Decision[]
}

model Decision {
  id              String   @id @default(cuid())
  jobId           String
  job             Job      @relation(fields: [jobId], references: [id])
  productId       String
  recipe          String                // "description-formatter"
  version         String                // "1"
  field           String                // "descriptionHtml" | "seo.title" | ...
  before          String?               // before-image (rollback seam)
  after           String                // what the recipe proposed
  agentReason     String
  gateDecision    String                // "auto" | "stage"
  gateReason      String
  status          String                // applied | staged | approved | edited | rejected | rolled_back
  reviewerVerdict String?               // agree | edit | reject (reviewer-agreement signal)
  finalValue      String?               // what was actually written
  createdAt       DateTime @default(now())
  reviewedAt      DateTime?
}
```

`status` values: `applied` (gate auto-applied), `staged` (awaiting review),
`approved` / `edited` / `rejected` (reviewer outcomes), `rolled_back` (reserved for the
future demote-with-rollback path; not produced by prototype code).

---

## 6. The review layer (human in the loop)

Embedded admin page, same Polaris-web-component style as the current app.

**`app/routes/app._index.tsx` — review queue (rebuilt).** Replaces the per-product
formatter UI. Lists **staged** Decision rows (most recent first): product title,
recipe, the agent's one-line reason, status chip. Auto-applied decisions are shown
**read-only** in the same list, so the agent acting on its own is visible — the point
of the rebuild.

**Decision detail + verdict (`app/routes/app.decision.$id.tsx`).** Shows before/after
for the one changed field (reusing the sandboxed `HtmlPreview` iframe for description
changes; plain text for SEO / product-type / alt-text). Three actions, captured as
distinct reviewer-agreement signals:

- **Approve** → writes `after`, `status = approved`, `reviewerVerdict = agree`.
- **Edit & approve** → reviewer tweaks first, writes edited value,
  `status = edited`, `reviewerVerdict = edit`, `finalValue` = their version. An edit is
  weaker agreement than a clean approve; the trust model cares about the difference, so
  it is captured distinctly.
- **Reject** → writes nothing, `status = rejected`, `reviewerVerdict = reject`.

All three reuse `apply.ts`'s field writers (the same write path the gate's auto-applies
use) and stamp the Decision row. The before-image is **not** re-captured here: it was
already recorded on the Decision when the change was staged, so the reviewer write reuses
that stored `before` rather than re-running capture (or the gate) at approval time. This
is the entire reviewer-agreement dataset, captured as a byproduct of normal review.

**Deliberately not in the UI now** (data seams exist; no screens): trust dashboard,
rollback button, sampling view for auto-applied decisions.

---

## 7. Trigger layer and worker

**Webhook handler — `app/routes/webhooks.products.tsx`.** Subscribes to
`products/create` and `products/update` (declared in `shopify.app.toml`). Validates
HMAC via the template's `authenticate.webhook`, enqueues a `Job`, returns 200 in <1s.
Does no agent work inline (webhooks must respond fast).

**Worker — `app/worker/runner.ts`.** A DB-backed queue polled by an in-process worker
started alongside the app in dev. It claims `queued` Jobs, runs the agent loop, and
marks `done`/`failed` with `attempts`/`error`. No Redis or external service.

**Tradeoff (accepted):** the worker runs in the same process as the dev server — fine
for a prototype; in production it would be a separate process. The DB-backed queue is
swappable for a real queue later without touching the agent or harness layers.

---

## 8. File map

```
app/
  routes/
    webhooks.products.tsx        NEW      trigger: HMAC, enqueue Job, 200 OK
    app._index.tsx               REBUILT  review queue + auto-applied (read-only)
    app.decision.$id.tsx         NEW      approve / edit / reject action
  agent/
    loop.ts                      NEW      hand-rolled manager loop
    tools.ts                     NEW      closed, versioned tool registry
    system-prompt.ts             NEW      manager agent instructions
  harness/
    gate.ts                      NEW      autonomy gate (atomic now, static factors)
    apply.ts                     NEW      the only write path; captures before-image
    decisions.server.ts          NEW      Decision log read/write
  recipes/
    format-description.ts        MOVED    from lib/ (recipe description-formatter@1)
    infer-product-type.ts        NEW      recipe product-type-inferrer@1
    generate-seo-meta.ts         NEW      recipe seo-meta-generator@1
    suggest-image-alt-text.ts    NEW      recipe image-alt-text@1
  worker/
    runner.ts                    NEW      polls Job queue, runs agent, marks status
  lib/
    sanitize.ts                  KEPT     used by format-description recipe
    formatting-levels.ts         KEPT
    product.server.ts            TRIMMED  Shopify read/write helpers only
  shopify.server.ts              EDITED   register products/* webhooks
prisma/schema.prisma             Job + Decision tables
shopify.app.toml                 add products/create + products/update subscriptions
```

The existing `app/routes/app.format.tsx` (the manual formatter action) is removed; its
formatter logic survives as the `description-formatter@1` recipe.

---

## 9. Definition of done

Run the app on the dev store (`shopify app dev`). Edit a product (or sync one in) so
Shopify fires `products/update`:

1. **No human trigger.** The webhook enqueues a Job; the worker runs the agent loop
   automatically. The agent's tool-call trace shows it assessing the product and
   proposing changes only for genuine gaps.
2. **Gate behaves atomically and statically.** A clean description-format change is
   auto-applied to the live product; subjective changes (SEO, product type, alt text)
   are staged.
3. **Auto-applied changes are visible** read-only in the review page, and the live
   product reflects them.
4. **Staged changes are reviewable:** the queue shows them; opening one shows
   before/after; approve / edit / reject each writes the right outcome and stamps the
   Decision row with the correct `reviewerVerdict`.

**Seam acceptance (no trust behavior, but the substrate is provably present):**

5. Every Decision row carries `recipe`, `version`, `before`, `gateDecision`, and (after
   review) `reviewerVerdict` — so volume, reviewer agreement, and the rollback target
   are all queryable.
6. Every Job carries `inputSnapshot` + `trace` — so a run is replayable in principle.
7. The gate is a single function taking `recipe + version`; swapping its static factors
   for trust-based ones touches only `gate.ts`.

Trust scoring, replay, sampling, and rollback are explicitly **not** part of done.
