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

## Multi-session coordination (required)

Several dev sessions run in parallel on one machine. `COORDINATION.md` (repo
root) holds the runbook, the prioritized backlog, and the session kickoff
template — read it at the start of a session. In brief:

1. **Own your worktree.** Start with `node scripts/new-session.mjs <branch>` to
   get an isolated `.worktrees/<branch>` folder off fresh `main`. Never share one
   working directory between sessions.
2. **Claim before you edit.** `node scripts/coord.mjs claim <branch> <files>`,
   especially for the shared choke-point files every recipe touches
   (`app/recipes/registry.ts`, `app/agent/tools.ts`,
   `app/agent/recipe-dispatch.server.ts`, `RECIPE_TOOL` in `app/agent/loop.ts`,
   `app/agent/system-prompt.ts`, `prisma/schema.prisma`). Check
   `node scripts/coord.mjs status` first; if another branch already claims a
   choke-point file, coordinate before editing. `release` when done.
3. **One feature per branch.** Hooks (`.githooks/`, auto-wired by `npm install`)
   block commits/pushes to `main` and run typecheck + tests before every push.
4. **GitHub may be unreachable from your environment.** If so, leave the branch
   committed and ready to push and write the PR body to
   `docs-private/pr-drafts/<branch>.md`; the user pushes and opens the PR.

## Architecture invariants

- **Recipes are single-field, versioned skills** (`app/recipes/registry.ts`,
  `recipe@version`). They return a `RecipeProposal` and never write to Shopify.
- **`app/harness/apply.ts` is the only writer.** It exposes the two — and only
  two — paths that write to Shopify, and every write is anchored to a gated
  `Decision` row:
  - `proposeChange` (agent auto-apply): before-image → gate → Decision row →
    maybe write. The gate decides auto-vs-stage.
  - `applyReviewedDecision` (human review): a reviewer's approve/edit of a staged
    Decision performs the field write and records the verdict. The gate is NOT
    re-run — a human verdict is authoritative and is never auto-applied. Route
    actions (per-decision and per-product review) call this; they never call the
    `product.server.ts` writers directly.
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
