#!/usr/bin/env node
// scripts/new-session.mjs
// Spin up an isolated git worktree for a new dev session. Each parallel Claude
// session gets its OWN folder + branch off a shared .git, so sessions can never
// clobber each other's working tree or fight over which branch is checked out.
//
// It always branches from fresh origin/main (never a stale local ref). If the
// network is down (Claude sessions here can't reach GitHub), it says so and
// offers to base off the local main instead — an explicit choice, not a silent
// stale base.
//
// Usage:
//   node scripts/new-session.mjs <branch-name>
//   node scripts/new-session.mjs <branch-name> --from-local   (skip fetch, use local main)
import { execFileSync } from "node:child_process";
import { join } from "node:path";

function git(args, opts = {}) {
  return execFileSync("git", args, { encoding: "utf8", ...opts }).trim();
}

function tryGit(args) {
  try {
    // Capture stderr (don't inherit) so expected failures — e.g. the
    // branch-existence pre-check — don't leak "fatal:" noise to the terminal.
    return { ok: true, out: git(args, { stdio: ["ignore", "pipe", "pipe"] }) };
  } catch (err) {
    return { ok: false, out: (err.stderr || err.message || "").toString().trim() };
  }
}

const [, , rawBranch, ...flags] = process.argv;
if (!rawBranch) {
  console.error("usage: node scripts/new-session.mjs <branch-name> [--from-local]");
  process.exit(1);
}

// Normalize: allow "feat/foo" or a bare name.
const branch = rawBranch.trim();
const fromLocal = flags.includes("--from-local");

const top = git(["rev-parse", "--show-toplevel"]);
const worktreePath = join(top, ".worktrees", branch.replace(/\//g, "-"));

// Refuse to reuse a branch that already exists (local or in a worktree).
const existing = tryGit(["rev-parse", "--verify", `refs/heads/${branch}`]);
if (existing.ok) {
  console.error(
    `Branch '${branch}' already exists. Pick a new name, or resume its worktree:\n` +
      `  git worktree list`,
  );
  process.exit(1);
}

let base = "origin/main";
if (fromLocal) {
  base = "main";
  console.log("[new-session] --from-local: basing off local main (fetch skipped).");
} else {
  console.log("[new-session] fetching origin ...");
  const fetch = tryGit(["fetch", "origin", "--prune"]);
  if (!fetch.ok) {
    console.warn(
      "\n[new-session] Could not reach origin (network/GitHub unavailable):\n" +
        `  ${fetch.out.split("\n").slice(-1)[0]}\n` +
        "Falling back to LOCAL main as the base. Make sure your local main is\n" +
        "current (git log main..origin/main from a networked terminal) before\n" +
        "relying on this. Re-run with --from-local to silence this warning.\n",
    );
    base = "main";
  } else {
    // Report whether local main is behind, purely informational.
    const behind = tryGit(["rev-list", "--count", "main..origin/main"]);
    if (behind.ok && behind.out !== "0") {
      console.log(`[new-session] note: local main is ${behind.out} commit(s) behind origin/main (basing off origin/main anyway).`);
    }
  }
}

console.log(`[new-session] creating worktree at .worktrees/${branch.replace(/\//g, "-")} on '${branch}' off ${base} ...`);
const add = tryGit(["worktree", "add", worktreePath, "-b", branch, base]);
if (!add.ok) {
  console.error(`[new-session] failed:\n  ${add.out}`);
  process.exit(1);
}

console.log(
  [
    "",
    "Worktree ready. Next steps for this session:",
    `  cd ${worktreePath}`,
    `  node scripts/coord.mjs claim ${branch} <files you'll edit>`,
    "  # build only this feature, then typecheck + test before pushing",
    "",
    "When done:",
    `  node scripts/coord.mjs release ${branch}`,
    `  git worktree remove ${worktreePath}   # after the PR merges`,
  ].join("\n"),
);
