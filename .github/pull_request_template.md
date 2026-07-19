<!--
  One feature per PR. Keep it small and reviewable.
  See COORDINATION.md for the full session runbook.
-->

## What & why

<!-- One or two sentences: what this changes and the problem it solves. -->

## Choke-point files touched

<!--
  Adding a recipe edits shared, append-to-a-single-list files. List which of
  these you touched so the reviewer can spot parallel-work collisions:
    - app/recipes/registry.ts
    - app/agent/tools.ts
    - app/agent/recipe-dispatch.server.ts
    - app/agent/loop.ts (RECIPE_TOOL)
    - app/agent/system-prompt.ts
    - prisma/schema.prisma + a new migration
    - app/harness/apply.ts (only if adding a NEW field)
  Write "none" if this PR touches no shared files.
-->

## Checklist

- [ ] Branched from **fresh `main`** (`git fetch origin --prune`, main up to date).
- [ ] **One feature** in this branch — no unrelated changes.
- [ ] `npm run typecheck` passes locally.
- [ ] `npm test` passes locally.
- [ ] Any new recipe stages for review (did **not** special-case the gate).
- [ ] Prisma changes are **additive** migrations (`npx prisma migrate dev`).
- [ ] Released my coordination claim (`node scripts/coord.mjs release`).
- [ ] Internal specs/plans went to `docs-private/`, not this repo.
