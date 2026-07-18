# shopify-product-manager

Event-driven product-completeness agent for Shopify. A products webhook enqueues
a Job; an in-process worker runs a hand-rolled LLM agent loop over a closed tool
registry; every proposed change passes the autonomy gate (`app/harness/gate.ts`)
and is either auto-applied or staged for human review.

## Git workflow (required)

Multiple assistant sessions and tools work on this repo concurrently. History
has been rewritten before, and merges often happen in the GitHub UI, so local
state goes stale easily.

**Before starting ANY code change:**

1. `git fetch origin --prune`, then check `git log main..origin/main`.
2. If local `main` is behind, fast-forward it (`git checkout main && git pull`)
   BEFORE branching. Never build on a stale main or a leftover feature branch.
3. If GitHub is unreachable from your environment (proxy 403 / DNS failure),
   verify the state of `origin/main` another way (e.g. the GitHub commits page)
   and ask the user to pull in their own terminal — do not silently build on a
   stale base.
4. Check `git status` for uncommitted changes from other sessions. Stage and
   commit only files that belong to your task.

Branch from fresh `main`; open PRs against `main`; do not commit directly to it.

## Architecture invariants

- **Recipes are single-field, versioned skills** (`app/recipes/registry.ts`,
  `recipe@version`). They return a `RecipeProposal` and never write to Shopify.
- **`app/harness/apply.ts` is the only writer.** Every proposal flows through
  `proposeChange`: before-image → gate → Decision row → maybe write.
- **The gate is default-deny.** Only recipes explicitly trusted to auto-apply
  do so (currently `description-formatter`, and only when `textPreserved` is
  true); everything else stages for human review. New recipes stage until they
  earn trust — do not special-case the gate.
- **The agent's tool registry is closed** (`app/agent/tools.ts`). Adding a
  recipe means: recipe module + registry entry + tool spec + dispatch entry +
  `RECIPE_TOOL` map entry + system-prompt trigger rules, plus tests.
- Recorded signals (e.g. `Decision.factCheck`) are data for the reviewer and a
  future trust report card; they never change the gate's auto-vs-stage decision.

## Conventions

- Tests: vitest, colocated `*.test.ts`. Pure post-processing functions are
  tested; live LLM calls are not. Run `npm test` and `npm run typecheck` before
  committing.
- Schema changes: additive Prisma migrations (`npx prisma migrate dev`).
- Internal design docs/specs are IP and live outside version control, in
  `docs-private/` at the repo root (gitignored via `/docs-private/`) — never
  commit them. Write new specs to `docs-private/specs/`, plans to
  `docs-private/plans/`.
