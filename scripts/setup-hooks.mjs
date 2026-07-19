#!/usr/bin/env node
// scripts/setup-hooks.mjs
// Point git at the tracked .githooks/ directory. Run automatically by the
// `prepare` npm lifecycle script on every `npm install` / `npm ci`, so every
// clone and every worktree on this machine gets the hooks with no manual step.
// core.hooksPath is stored in the shared git config, so one setting covers all
// worktrees. No-ops (exit 0) when not inside a git repo — e.g. an npm install
// from a tarball or CI checkout without .git — so it never breaks a build.
import { execFileSync } from "node:child_process";

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

try {
  // Fails (throws) when not in a work tree; that's our signal to bail quietly.
  const insideRepo = git(["rev-parse", "--is-inside-work-tree"]);
  if (insideRepo !== "true") process.exit(0);
} catch {
  // Not a git repo (or git unavailable). Nothing to wire; succeed silently.
  process.exit(0);
}

try {
  const current = (() => {
    try {
      return git(["config", "--get", "core.hooksPath"]);
    } catch {
      return "";
    }
  })();

  if (current === ".githooks") {
    process.exit(0); // already wired
  }

  git(["config", "core.hooksPath", ".githooks"]);
  console.log("[setup-hooks] core.hooksPath -> .githooks");
} catch (err) {
  // A locked/read-only git config (some sandboxes) shouldn't fail the install.
  console.warn(
    `[setup-hooks] could not set core.hooksPath (${err.message}). ` +
      "Run `git config core.hooksPath .githooks` manually to enable hooks.",
  );
  process.exit(0);
}
