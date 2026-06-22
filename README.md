# Product Completeness Agent

A Shopify app that watches products sync in from an ERP and fixes their quality gaps
automatically — unformatted descriptions, missing product types, weak SEO meta, images
without alt text. When a product changes, an agent inspects it, decides which fixes
apply, and either applies the safe ones on its own or stages the riskier ones for a
human to review.

It is built as a study in **agent autonomy earned inside a harness**: the agent acts on
its own only because it operates through a fixed set of tools, a single version-
controlled write path, and a bounded loop. More autonomy doesn't mean more risk, because
the harness bounds the blast radius.

> This is a learning prototype, not a production app. It ships the *structure* for
> trust-earned autonomy (the gate, before-images, the decision log) but deliberately
> stops short of building trust scoring, replay, or rollback. See
> [Scope](#scope-whats-built-vs-deferred).

## How it works

A product syncs in → Shopify fires a webhook → the agent runs → safe changes go live,
risky ones wait for review. No per-product human trigger.

```
Shopify store
    │  products/create · products/update  (webhook)
    ▼
1. TRIGGER   webhooks.products.tsx — validates HMAC, enqueues a Job, returns 200 fast
    │
    ▼  Job row (SQLite via Prisma)
2. AGENT     worker/runner.ts polls the queue → agent/loop.ts runs a hand-rolled
    │         LLM loop over a closed tool registry, reasoning until "done"
    ▼  every proposed change → the gate
3. HARNESS   gate.ts decides auto | stage  ·  apply.ts is the only writer (captures a
    │         before-image first)  ·  every decision recorded in the Decision log
    ▼
4. REVIEW    app._index.tsx — queue of staged changes + auto-applied ones (read-only)
             app.decision.$id.tsx — before/after, approve / edit / reject
```

The four layers are isolated: layers 1, 3, and 4 are fixed infrastructure, and **layer 2
is the only place the agent's reasoning lives**, so the loop can be experimented with
without destabilizing the rest.

## The agent

The agent is a "manager" loop that decides *which* fixes a given product needs. Each fix
is an independent, versioned **recipe**:

| Recipe (`id@version`)       | Gap it addresses                          | Gate behavior |
| --------------------------- | ----------------------------------------- | ------------- |
| `description-formatter@1`   | Flat ERP text → structured HTML           | **auto-applies** when the visible text is provably unchanged |
| `product-type-inferrer@1`   | Missing/blank `productType`               | always staged for review |
| `seo-meta-generator@1`      | Missing/weak SEO title + description       | always staged for review |
| `image-alt-text@1`          | Images with no alt text                    | always staged for review |

The loop (`app/agent/loop.ts`) is written directly against the Anthropic Messages
tool-use protocol rather than hidden in a framework, so the mechanism is visible: the
model picks tools from a **closed registry** (`app/agent/tools.ts`), the loop executes
them and feeds results back, bounded by a step limit. Recipe tools *propose* changes;
they never write. The only path to the store is the proposal → gate → apply funnel.

### The autonomy gate

`app/harness/gate.ts` is the single decider of auto-vs-stage. It is built **atomic** (all
factors must clear to auto-apply) with **static** factors today: `description-formatter`
auto-applies only if its text-preservation check passed; every subjective recipe stages.
The gate's signature already carries `recipe + version`, so swapping today's static
factors for a real trust score (coverage, replay, reviewer agreement, volume) later
touches only this one function.

## Tech stack

- [React Router 7](https://reactrouter.com/) on the Shopify app template (Polaris web components)
- [Prisma](https://www.prisma.io/) + SQLite
- [`@anthropic-ai/sdk`](https://github.com/anthropics/anthropic-sdk-typescript) for the agent loop and recipe LLM calls
- [Zod](https://zod.dev/) for schema-constrained model output
- [Vitest](https://vitest.dev/) for unit tests

## Getting started

### Prerequisites

- Node.js `>=20.19 <22 || >=22.12`
- A [Shopify Partner](https://partners.shopify.com/) account and a development store
- An [Anthropic API key](https://console.anthropic.com/)
- The [Shopify CLI](https://shopify.dev/docs/api/shopify-cli)

### Setup

```bash
npm install
```

Create a `.env` file (it is gitignored — never commit it):

```bash
ANTHROPIC_API_KEY=sk-ant-...
LLM_MODEL=claude-opus-4-8   # optional; this is the default
```

Apply the database migrations:

```bash
npx prisma migrate dev
```

### Run

```bash
npm run dev
```

This starts `shopify app dev`. On first run, accept the prompt to update the app config
and install on your development store so the `products/create` / `products/update`
webhooks and the `read_products,write_products,write_files` scopes register. An
in-process worker starts alongside the dev server (look for `Product-completeness worker
started.` in the logs) and polls the Job queue every few seconds.

To see the agent run: edit a product in your store's admin and save. The webhook enqueues
a Job, the worker runs the agent, and within a few seconds the app's home page shows what
it did — auto-applied changes read-only, staged changes ready to approve or reject.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the app + worker via Shopify CLI |
| `npm test` | Run the Vitest unit suite |
| `npm run typecheck` | React Router typegen + `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run build` | Production build |

## Project layout

```
app/
  routes/
    webhooks.products.tsx     trigger: validate HMAC, enqueue a Job, 200 OK
    app._index.tsx            review queue + auto-applied activity (read-only)
    app.decision.$id.tsx      decision detail: before/after, approve/edit/reject
  agent/
    loop.ts                   hand-rolled manager loop (model injected for testing)
    tools.ts                  the closed, versioned tool registry
    system-prompt.ts          manager instructions
    anthropic-client.server.ts  real Messages tool-use adapter
    recipe-dispatch.server.ts   binds recipe tools to their run() functions
  harness/
    gate.ts                   autonomy gate (atomic structure, static factors)
    apply.ts                  the only write path; captures the before-image first
    decisions.server.ts       Decision log read/write
  recipes/
    registry.ts               recipe ids + versions (single source of truth)
    format-description.ts      description-formatter@1
    infer-product-type.ts      product-type-inferrer@1
    generate-seo-meta.ts       seo-meta-generator@1
    suggest-image-alt-text.ts  image-alt-text@1
  worker/
    runner.ts                 claims a queued Job, runs the agent, records outcome
    start.server.ts           idempotent in-process poller
prisma/
  schema.prisma               Job + Decision models
```

### Data model

- **`Job`** — one row per webhook-triggered agent run. Holds the **replay seam**:
  `inputSnapshot` (the product state the agent saw) + `trace` (every tool call it made).
- **`Decision`** — one row per proposed change. Holds the **trust seams**: `before`
  (rollback target), `gateDecision`, and `reviewerVerdict` (the reviewer-agreement signal).

## Scope: what's built vs. deferred

This prototype builds the **seams** for trust-earned autonomy, not the behavior:

**Built and real** — the closed tool registry, the bounded loop, the single gated write
path, before-image capture, the full decision log, and a working human review queue.

**Deliberately deferred** — trust score computation, the replay engine, sampled review,
the rollback action, and any trust dashboard. The data those features need is captured
from day one (queryable on every `Job` and `Decision`), but no trust *behavior* is built.
The recipe set is also fixed at the four above; a content *rewriter* (one that changes the
words, not just the formatting) would be the natural next recipe, and the gate would
correctly always-stage it.

## Testing

```bash
npm test
```

The unit tests cover the pure, deterministic core — the gate's decision logic, each
recipe's proposal builder, the apply funnel (with injected fakes, no network or DB), and
the agent loop (driven by a scripted fake model). The LLM calls and live Shopify writes
are exercised by running the app against a development store, not by unit tests.

## Background

The design is shaped by the idea that an agent earns the right to act autonomously not
because we trust the model in the abstract, but because the harness around it is closed,
version-controlled, and bounded. The full design rationale and implementation plan live
in [`docs/superpowers/`](docs/superpowers/).

---

This app is built on the
[Shopify React Router app template](https://github.com/Shopify/shopify-app-template-react-router).
The template's setup notes and troubleshooting tips below still apply.

## Troubleshooting

### Database tables don't exist

If you get an error like `The table 'main.Session' does not exist in the current
database`, run the `setup` script: `npm run setup` (this runs `prisma generate &&
prisma migrate deploy`).

### Navigating/redirecting breaks an embedded app

Embedded apps must maintain the user session inside an iFrame. To avoid issues:

1. Use `Link` from `react-router` or `@shopify/polaris`. Do not use `<a>`.
2. Use `redirect` returned from `authenticate.admin`. Do not use `redirect` from `react-router`.
3. Use `useSubmit` or `useFetcher` from `react-router`.

### Webhooks: subscriptions aren't updating

This app declares its webhooks (`products/create`, `products/update`) in
`shopify.app.toml`, which Shopify syncs on `npm run deploy`. If a subscription or scope
change isn't taking effect during development, uninstall and reinstall the app on your
dev store to force a fresh install.

### Webhooks: `admin` is undefined on CLI-triggered events

When you trigger a webhook with `shopify app webhook trigger`, the `admin` object is
`undefined` because the CLI uses a valid-but-nonexistent shop. To exercise the full agent
flow, trigger a real event instead — e.g. edit a product in the dev store admin and save.

### "nbf" claim timestamp check failed

A JWT token is expired, usually because your machine's clock is out of sync. Enable
"Set time and date automatically" in your OS date/time settings.

## Resources

- [Shopify App React Router docs](https://shopify.dev/docs/api/shopify-app-react-router)
- [Polaris Web Components](https://shopify.dev/docs/api/app-home/polaris-web-components)
- [Anthropic API — tool use](https://docs.anthropic.com/en/docs/build-with-claude/tool-use)
- [React Router docs](https://reactrouter.com/home)
