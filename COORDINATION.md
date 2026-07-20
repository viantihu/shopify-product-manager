# Coordination

How multiple dev sessions (each a Claude Code session = one "developer") work on
this repo in parallel without undoing each other's work. Read this at the start
of a session. This file is the durable home for the backlog and the runbook; the
*live* "who's editing what right now" state lives in an ephemeral ledger in the
shared `.git` dir (see below), not here.

---

## Who does what (the PM vs dev sessions)

The repo owner (Karvi) is the PM, not a DevOps operator. She sets product
direction, reviews and merges PRs in the GitHub UI, and runs the occasional
command a sandboxed session can't (push, `gh pr create`, pulling `main`).
Everything else — including keeping this file current — is on the dev sessions.

**Every dev session is responsible for:**

- **This file.** Backlog upkeep happens on the branch you're already working
  on: move your row to `In progress` on pickup, `In review` when your PR draft
  is written, and delete rows whose PRs have merged. Add rows for new ideas
  raised mid-session so they aren't lost. Never leave the backlog describing a
  state that is no longer true.
- **Start-of-session tidy.** Before building anything: run
  `node scripts/coord.mjs status` and release claims belonging to merged or
  abandoned branches, `git worktree remove` worktrees of merged branches, and
  delete merged backlog rows. Merges happen in the GitHub UI while sessions are
  asleep, so cleanup always falls to the *next* session — that's you.
- **The claim ledger.** Claim before editing, release when done. Never end a
  session with claims still held.
- **Handing the PM copy-paste blocks.** When an action needs her terminal or
  the GitHub UI (push a branch, open a PR, pull `main`), end your turn with one
  exact, complete, copy-paste-ready command block — never a prose description
  of what to do. The files in `docs-private/pr-drafts/` show the format.

**The PM's part (keep it this short):**

- Merge PRs in the GitHub UI. CI and branch protection already enforce green
  typecheck + tests and a review there.
- Paste and run the command blocks sessions hand her.
- Product judgment: priorities, scope, review verdicts on staged decisions.

Before asking the PM to do anything, ask: can this session do it itself? If
yes, do it. If no, make her part a single paste.

---

## Backlog (the vision)

Prioritized. One row per feature. Keep this current — it is the single place the
product direction lives. Move a row to `In progress` when a session picks it up
(note the branch), and delete it once merged.

| Priority | Feature | Status | Branch | Notes |
|---|---|---|---|---|
| P1 | Recipe application UX | Idea | — | The user needs to know which recipes applied when reviewing the product. It's currently not clear to the user what kinds of edits were made to the product upon review. |
| P1 | Verify marketing-optimizer triage live | Ready | — | The one unproven link in shipped code: needs the Anthropic API, so it was never run in-sandbox. Run `shopify app dev`, feed a clean-but-weak product (feature dump, "high quality", no "you") and confirm the agent (1) routes to `optimize_marketing_copy` not rewrite/format, (2) stages (no auto-apply), (3) shows the "Marketing coaching" section. Tuning lever if it misroutes: three-way triage wording in `app/agent/system-prompt.ts`. |
| P2 | Merchant-tunable marketing guidelines | Idea | — | Let marketers tune recipe guidelines to their own brand strategy. `marketing-optimizer` already externalized generic rules to one editable config (`app/lib/marketing-guidelines.ts`) — the first concrete step. Next: a merchant-facing control surface. Scope to `docs-private/specs/` before building. |
| P2 | Marketing crowded out by grammar (recipe precedence) | Idea | — | Strict one-recipe-per-run precedence (`app/agent/system-prompt.ts`) means a description with BOTH a grammar error and weak sales copy only gets `rewrite_description`; `optimize_marketing_copy` never runs that pass. Observed live 2026-07-20 (snowboard: fixed "skiiers"→"skiers", no marketing pass). Marketing is picked up on the NEXT `products/update` once grammar is clean, but that two-step is clunky. Decide: allow rewrite→marketing in one pass when both apply (bigger diffs to review), or keep the sequential model. Not a bug — a product call. |
| P2 | Stale / duplicate description-check flags on validator re-runs | Idea | — | `proposeChange` (`app/harness/apply.ts`) always inserts a fresh `Decision` row; it never supersedes or dedupes a prior staged `descriptionMatch` flag for the same product. Two consequences: (1) after a merchant fixes a flagged description, the next `products/update` re-run returns clean (`[]`, no new row) but the OLD staged flag lingers as an advisory until manually Dismissed; (2) a still-bad description flagged again stacks a second staged row instead of replacing the first. Unlike the description-write recipes — whose composed write supersedes losing rows at review time (`app/routes/app.product.$productId.tsx`) — a clean validator pass emits nothing, so there is no path to clear the stale flag. Decide: on a clean `validate_description`, supersede any open staged `descriptionMatch` for that product (needs a writer-free supersede path, since the validator produces no proposal), and/or dedupe on re-flag. Introduced 2026-07-20 by the review-only detector shape; not a bug — a lifecycle gap. |
| P3 | Self-registration refactor (kill choke points) | Idea | — | Infra, not a feature. Make each recipe self-register (tool spec + dispatch + `RECIPE_TOOL` + trigger) so the five central files auto-collect them and adding a recipe touches zero shared files. See the "Phase 2" section below for detail. Do when collision pain justifies it — now six recipes are each hand-wired into five shared files. |
| P2 | Admin block on Product card | Idea | - | If a user chooses to navigate to the product card to see changes, an admin block should show a history of the changes made by the agend (not the user) |
| P1 | Description validation | Idea | - | The agent must be able to identify when the product description does not match the product. I wrote a description for a sweater when the product was a snowboard. The agent did not catch this. This may occur in a production scenario when there is a data migration mismatch or error |
| P1 | Clean up GitHub repo | Idea | - | There are some files that I believe do not belong in a public repo. This is not a feature, but it is important when preparing to publish my article

Status values: `Idea` → `Ready` (scoped enough to build) → `In progress`
(a session owns it) → `In review` (PR open) → merged (delete the row).

---

## Session runbook

### 0. Tidy before you build
Merges happen in the GitHub UI while sessions are asleep, so every session
starts by paying down the last one's exit debt:
```
node scripts/coord.mjs status                # release claims of merged/dead branches
git worktree list                            # remove worktrees of merged branches
```
Then check the backlog table above: delete rows whose PRs have merged, and fix
any row whose status is stale. Commit backlog fixes on your own feature branch
(docs edits ride along; they don't need their own PR).

### 1. Start an isolated worktree
```
node scripts/new-session.mjs <branch>        # e.g. feat/color-normalizer
```
This branches off **fresh `origin/main`** into `.worktrees/<branch>` (its own
folder, own branch, shared `.git`). If GitHub is unreachable it falls back to
local `main` and says so. `cd` into the printed path — that folder is yours;
another session's worktree can't touch it.

> Not using a worktree (working in the main checkout)? Then you MUST still branch
> off fresh main and never leave the checkout on a branch another session needs.
> Worktrees are strongly preferred because they remove that whole failure mode.

### 2. Claim the files you'll edit
```
node scripts/coord.mjs status                # see what others are touching
node scripts/coord.mjs claim <branch> <file...>
```
Always claim the **choke-point files** (below) before editing them — that's
where parallel work collides. If `status` shows another branch already claims a
file you need, coordinate (with the user) before editing; the tool warns but
won't stop you.

### 3. Build one feature
- One feature per branch. No drive-by unrelated edits (backlog upkeep from
  step 0 is the one exception).
- Picking up a backlog row? Set it to `In progress` with your branch name in
  the same commit series as your work.
- `npm run typecheck` and `npm test` as you go.
- New recipe? It **stages** for review — do not special-case the gate
  (`app/harness/gate.ts`). See CLAUDE.md architecture invariants.
- Prisma changes are **additive** migrations (`npx prisma migrate dev`).

### 4. Finish
```
node scripts/coord.mjs release <branch>      # drop your claims
git push -u origin <branch>                  # if you can reach GitHub
```
The `pre-push` hook runs typecheck + tests and blocks a red branch from leaving
the machine. Open a PR against `main` (the template will load). **If GitHub is
unreachable from your session**, commit everything, leave the branch
ready-to-push, and write the PR body to `docs-private/pr-drafts/<branch>.md` —
then end your final message to the PM with the exact commands she pastes:

```
git push -u origin <branch>
gh pr create --base main --head <branch> \
  --title "<title>" \
  --body-file docs-private/pr-drafts/<branch>.md
```

Update your backlog row to `In review` before handing off. The PM's only jobs
are pasting that block and merging in the GitHub UI — don't leave her anything
else to figure out.

### 5. After merge
```
git worktree remove .worktrees/<branch>
```
The remote branch auto-deletes on merge. Delete the local worktree and remove
the backlog row. If your session is already gone by merge time, the next
session's step-0 tidy catches both — that's why step 0 exists.

---

## Recovering a paused or branchless session

The steps above assume a session starts clean via `new-session.mjs`. A session
that paused mid-work — especially one still on `main` with **no branch yet** — is
the highest-risk state: its work isn't isolated, isn't claimed, and any commit it
makes would hit `main` (the `pre-commit` hook blocks that). Get it onto a branch
and a claim *before* it does anything else.

**If it has no uncommitted work yet** (just an intent, nothing edited) — start it
properly:
```
node scripts/new-session.mjs <branch>          # isolated worktree off fresh main
cd .worktrees/<branch>
node scripts/coord.mjs claim <branch> <files>  # the choke-point files it will touch
```

**If it already has uncommitted work in the main checkout** — do NOT try to move
the files by hand. Branch in place so the work travels with you, then claim:
```
git switch -c <branch>                          # carries uncommitted changes onto the new branch
node scripts/coord.mjs claim <branch> <files>
```
(Optionally `git stash` first, make a worktree, then `git stash pop` inside it —
but `git switch -c` in place is simpler and loses nothing.)

**Placeholder claims.** If you know a paused session is working on something but
it hasn't picked a branch name, you can reserve its files under a provisional
name (e.g. `feat/suggestion-recipe`) so other sessions steer clear. When the real
session resumes, `release` the placeholder and re-`claim` under its actual branch
so the `pre-commit` cross-branch warning matches reality.

**Cross-clone limit.** The claim ledger lives in this repo's shared `.git`, so it
only coordinates sessions that share it (this checkout + its worktrees). A session
running from a *separate clone* has its own ledger and can't see these claims —
coordinate those at the branch/PR layer instead, or bring the session into a
worktree of this repo.

---

## Choke-point files (claim these before editing)

Adding a recipe hand-edits several **shared, append-to-one-list** files. Two
sessions editing the same one will hit a merge conflict, and a careless merge can
silently drop a recipe. Claim them, and prefer to have only one session adding a
recipe at a time.

| File | What every recipe adds |
|---|---|
| `app/recipes/registry.ts` | a key in the `RECIPES` object |
| `app/agent/tools.ts` | a tool spec in the `TOOLS` array |
| `app/agent/recipe-dispatch.server.ts` | an import + a handler in `runRecipe` |
| `app/agent/loop.ts` | a line in the `RECIPE_TOOL` map |
| `app/agent/system-prompt.ts` | a trigger rule in the prompt string |
| `prisma/schema.prisma` (+ new migration) | only if the recipe needs a new column |
| `app/harness/apply.ts` | only if the recipe introduces a **new field** |

The recipe's own module + its `*.test.ts` under `app/recipes/` are isolated —
low conflict risk. It's the registration wiring above that collides.

---

## How the pieces fit

- **Worktrees** (`scripts/new-session.mjs`, `/.worktrees/` gitignored): isolation
  so sessions never clobber each other's working tree.
- **Claim ledger** (`scripts/coord.mjs`): stored in
  `<git-common-dir>/coordination/claims.json` — outside version control, so it's
  live-visible to every worktree on the machine and can never itself cause a
  merge conflict. Advisory: it warns, it doesn't block.
- **Git hooks** (`.githooks/`, auto-wired by the `prepare` script on
  `npm install`): `pre-commit` blocks commits on `main` and warns on cross-branch
  claim overlap; `pre-push` blocks pushes to `main` and requires green
  typecheck + tests.
- **CI + review** (`.github/`): `ci.yml` re-runs typecheck + tests on every PR;
  `CODEOWNERS` auto-requests the owner's review; the PR template enforces the
  checklist. Branch protection (owner-configured) makes the CI check + 1 review
  required before merge.

---

## Session kickoff template

Paste this to each new session:

> You are one of several parallel dev sessions on this repo. Read
> `COORDINATION.md` first and do its step-0 tidy (release stale claims, remove
> merged worktrees, prune merged backlog rows). Run
> `node scripts/new-session.mjs <branch>` to get an isolated worktree off fresh
> `main`, then `cd` into it. Claim the files you'll edit with
> `node scripts/coord.mjs claim <branch> <files>` (check
> `node scripts/coord.mjs status` first — especially for the choke-point files).
> Build ONLY this feature: **<feature>**, and keep the COORDINATION.md backlog
> row for it current (`In progress` → `In review`). Run `npm run typecheck` and
> `npm test`, then prepare a PR against `main` and `release` your claim. The
> user is the PM, not an operator: if you can't reach GitHub, leave the branch
> ready-to-push, write the PR body to `docs-private/pr-drafts/<branch>.md`, and
> end your final message with the exact push + `gh pr create` commands for her
> to paste — never a prose description of what to do.

---

## One-time GitHub setup (owner only — Claude can't reach GitHub)

Do this once in the GitHub web UI:

1. **Branch protection** — Settings → Branches → Add rule for `main`:
   - Require a pull request before merging; require **1 approval**.
   - Require status checks to pass → select the **CI / build** check (appears
     after the first CI run).
   - Do not allow bypassing; block direct pushes to `main`.
2. **Auto-delete branches** — Settings → General → "Automatically delete head
   branches" → on. Keeps merged feature branches from piling up.
3. **Prune old merged remotes once** — the already-merged
   `feat/content-rewriter`, `feat/per-product-review`, `feat/index-group-by-product`,
   and `docs/claude-md` remote branches can be deleted from the Branches page.

---

## Phase 2 (not built yet): kill the choke points at the source

The claim ledger *manages* choke-point collisions; it doesn't remove them. The
permanent fix is a **self-registration refactor**: make each recipe a single
self-contained module that registers its own tool spec, dispatch handler,
`RECIPE_TOOL` entry, and trigger rule, with the five central files
auto-collecting them (a registry loop over a recipes index). Adding a recipe
would then touch **zero** shared files, and two sessions could add recipes
simultaneously with no conflict.

There is no auto-registration today (all five central files are hand-maintained
literals). Do this when collision pain justifies it; give it its own
`docs-private/specs/` design doc, plan, and PR. Until then, the ledger + CI
backstop is the working answer.
