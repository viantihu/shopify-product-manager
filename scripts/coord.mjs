#!/usr/bin/env node
// scripts/coord.mjs
// Ephemeral cross-session claim ledger. Records which branch is touching which
// files RIGHT NOW, so parallel dev sessions on this machine can see each other
// and avoid editing the same choke-point files at once.
//
// The ledger lives in the SHARED git common dir
// (<git-common-dir>/coordination/claims.json), NOT in the work tree. That means:
//   - every worktree on this machine reads/writes the same file (live view), and
//   - it is never version-controlled, so it can never itself cause a merge
//     conflict — the thing it exists to prevent.
//
// It is advisory: the pre-commit hook reads it to WARN about cross-branch
// overlap, never to block. Claims are yours to release; nothing expires them
// automatically, so `release` when you finish (or `status` to see stale ones).
//
// Usage:
//   node scripts/coord.mjs claim <branch> <file...>   add/refresh a claim
//   node scripts/coord.mjs release [branch]           drop a branch's claims
//                                                      (defaults to current branch)
//   node scripts/coord.mjs status                     show all claims
//   node scripts/coord.mjs mine                       show current branch's claims
//   node scripts/coord.mjs owners <file...>           branches claiming these files
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function ledgerPath() {
  const commonDir = git(["rev-parse", "--git-common-dir"]);
  // --git-common-dir may be relative to CWD; resolve against the repo toplevel.
  const top = git(["rev-parse", "--show-toplevel"]);
  const abs = commonDir.startsWith("/") ? commonDir : join(top, commonDir);
  return join(abs, "coordination", "claims.json");
}

function currentBranch() {
  return git(["rev-parse", "--abbrev-ref", "HEAD"]);
}

function load(path) {
  if (!existsSync(path)) return { claims: [] };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return parsed && Array.isArray(parsed.claims) ? parsed : { claims: [] };
  } catch {
    // Corrupt ledger shouldn't wedge a session; start clean.
    return { claims: [] };
  }
}

function save(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  // Write-then-rename for atomicity against concurrent sessions.
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n");
  renameSync(tmp, path);
}

// A fixed timestamp source: Date is intentionally avoided elsewhere in agent
// code, but this is a plain CLI, so wall-clock is fine and useful for staleness.
function now() {
  return new Date().toISOString();
}

function fmtClaim(c) {
  return `  [${c.branch}] ${c.files.join(", ")}  (since ${c.updatedAt})`;
}

const [, , cmd, ...rest] = process.argv;
const path = ledgerPath();

switch (cmd) {
  case "claim": {
    const [branch, ...files] = rest;
    const br = branch || currentBranch();
    if (!files.length) {
      console.error("usage: coord.mjs claim <branch> <file...>");
      process.exit(1);
    }
    const data = load(path);
    let entry = data.claims.find((c) => c.branch === br);
    if (!entry) {
      entry = { branch: br, files: [], createdAt: now(), updatedAt: now() };
      data.claims.push(entry);
    }
    const set = new Set(entry.files);
    files.forEach((f) => set.add(f));
    entry.files = [...set].sort();
    entry.updatedAt = now();
    save(path, data);

    // Surface any overlap so the session knows immediately, not at commit time.
    const overlaps = data.claims
      .filter((c) => c.branch !== br)
      .flatMap((c) => c.files.filter((f) => files.includes(f)).map((f) => ({ f, branch: c.branch })));
    console.log(`Claimed for [${br}]: ${entry.files.join(", ")}`);
    if (overlaps.length) {
      console.log("\n  WARNING: files also claimed by other branches:");
      overlaps.forEach((o) => console.log(`    ${o.f}  <- also [${o.branch}]`));
      console.log("  Coordinate before editing these, or you will conflict.");
    }
    break;
  }

  case "release": {
    const br = rest[0] || currentBranch();
    const data = load(path);
    const before = data.claims.length;
    data.claims = data.claims.filter((c) => c.branch !== br);
    save(path, data);
    console.log(
      before === data.claims.length
        ? `No claims found for [${br}].`
        : `Released all claims for [${br}].`,
    );
    break;
  }

  case "status": {
    const data = load(path);
    if (!data.claims.length) {
      console.log("No active claims.");
      break;
    }
    console.log("Active claims:");
    data.claims.forEach((c) => console.log(fmtClaim(c)));
    break;
  }

  case "mine": {
    const br = currentBranch();
    const data = load(path);
    const mine = data.claims.filter((c) => c.branch === br);
    if (!mine.length) {
      console.log(`No claims for [${br}].`);
      break;
    }
    mine.forEach((c) => console.log(fmtClaim(c)));
    break;
  }

  case "owners": {
    const files = rest;
    if (!files.length) {
      console.error("usage: coord.mjs owners <file...>");
      process.exit(1);
    }
    const data = load(path);
    let found = false;
    files.forEach((f) => {
      const owners = data.claims.filter((c) => c.files.includes(f)).map((c) => c.branch);
      if (owners.length) {
        found = true;
        console.log(`${f}: ${owners.join(", ")}`);
      }
    });
    if (!found) console.log("No claims on those files.");
    break;
  }

  case "conflicts": {
    // Print, one per line, "<file>\t<branch>" for each file claimed by a branch
    // OTHER than <self>. Used by the pre-commit hook. Exact branch comparison in
    // JS avoids fragile shell substring matching. Exits 0 with no output when
    // there are no cross-branch conflicts, so the hook can test for emptiness.
    const [self, ...files] = rest;
    if (!self || !files.length) {
      console.error("usage: coord.mjs conflicts <self-branch> <file...>");
      process.exit(1);
    }
    const data = load(path);
    files.forEach((f) => {
      data.claims
        .filter((c) => c.branch !== self && c.files.includes(f))
        .forEach((c) => console.log(`${f}\t${c.branch}`));
    });
    break;
  }

  default:
    console.log(
      [
        "coord.mjs — cross-session file claim ledger",
        "",
        "  claim <branch> <file...>   add/refresh a claim",
        "  release [branch]           drop a branch's claims (default: current)",
        "  status                     show all active claims",
        "  mine                       show current branch's claims",
        "  owners <file...>           which branches claim these files",
        "  conflicts <self> <file...> files claimed by OTHER branches (hook use)",
      ].join("\n"),
    );
    if (cmd && cmd !== "help" && cmd !== "--help") process.exit(1);
}
