#!/usr/bin/env node
/**
 * Idempotent bring-up for a recycled sandbox.
 *
 * A new sandbox restores files but not git state, dependencies, build output or
 * agent registrations. Running this script produces the same working state
 * every time, and skips each step that is already satisfied:
 *
 *   1. reconcile git with the pushed session branch (only when it drifted)
 *   2. install dependencies            (only when node_modules is missing)
 *   3. build REA + skill artifacts     (only when dist is missing)
 *   4. re-register agents              (only when doctor reports drift)
 *   5. optionally hand over to the preview supervisor
 *
 * Usage:
 *   node scripts/bootstrap.mjs             # repair, then print next steps
 *   node scripts/bootstrap.mjs --serve     # repair, then start the server
 *   node scripts/bootstrap.mjs --check     # report only, change nothing
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(projectRoot, "..");

const flags = new Set(
  process.argv.slice(2).filter((token) => token.startsWith("--")),
);
const CHECK_ONLY = flags.has("--check") || flags.has("--dry-run");
const SERVE = flags.has("--serve");

const log = (message) => console.log(message);
const step = (n, total, message) => log(`\n[${n}/${total}] ${message}`);

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
    timeout: options.timeout ?? 300_000,
    env: { ...process.env },
  });
}

function capture(command, args, options = {}) {
  const result = run(command, args, { ...options, capture: true });
  return result.status === 0 ? result.stdout.trim() : null;
}

/**
 * Stdout regardless of exit status. `rea doctor` exits non-zero when optional
 * providers are missing, but its JSON is still the answer we need.
 */
function captureOutput(command, args, options = {}) {
  const result = run(command, args, { ...options, capture: true });
  const output = (result.stdout ?? "").trim();
  return output === "" ? null : output;
}

/** 1. Git state: a fresh sandbox checks out the base commit, not our branch tip. */
function reconcileGit() {
  const branch = capture("git", [
    "-C",
    repoRoot,
    "rev-parse",
    "--abbrev-ref",
    "HEAD",
  ]);
  const head = capture("git", ["-C", repoRoot, "rev-parse", "--short", "HEAD"]);
  log(`     branch ${branch ?? "?"} at ${head ?? "?"}`);

  const target = capturedRemoteHead();
  if (target !== null && head !== null && target.startsWith(head)) {
    log("     already at the pushed tip");
    return "ok";
  }
  if (CHECK_ONLY) {
    log(
      `     drift: run git fetch && git reset --hard origin/arena/12415f30-rea (target ${target ?? "unknown"})`,
    );
    return "drift";
  }
  const fetch = run(
    "git",
    ["-C", repoRoot, "fetch", "origin", "arena/12415f30-rea"],
    { capture: true },
  );
  if (fetch.status !== 0) {
    log("     cannot fetch; continuing with the local tree");
    return "unreachable";
  }
  const reset = run(
    "git",
    ["-C", repoRoot, "reset", "--hard", "origin/arena/12415f30-rea"],
    { capture: true },
  );
  log(
    reset.status === 0
      ? "     reset to the pushed tip"
      : "     reset failed; continuing",
  );
  return reset.status === 0 ? "reset" : "failed";
}

function capturedRemoteHead() {
  const line = capture("git", [
    "-C",
    repoRoot,
    "ls-remote",
    "origin",
    "refs/heads/arena/12415f30-rea",
  ]);
  return line === null ? null : line.split(/\s+/)[0];
}

/** 2 + 3. Dependencies and build output. */
function ensureToolchain() {
  if (existsSync(resolve(repoRoot, "node_modules", "incur"))) {
    log("     node_modules present");
  } else if (CHECK_ONLY) {
    log("     node_modules missing: run npm ci");
  } else {
    const install = run("npm", ["ci", "--no-audit", "--no-fund"], {
      timeout: 600_000,
    });
    if (install.status !== 0) {
      log(
        "     npm ci failed (offline?). The TallyCraft app itself has no dependencies and still runs.",
      );
    }
  }

  if (existsSync(resolve(repoRoot, "dist", "main.js"))) {
    log("     dist present");
    return;
  }
  if (CHECK_ONLY) {
    log("     dist missing: run npm run build:cached");
    return;
  }
  if (!existsSync(resolve(repoRoot, "node_modules"))) return;
  run("npm", ["run", "build:cached"], { timeout: 600_000 });
}

/** 4. Agent registrations. */
function ensureAgents() {
  const rea = resolve(repoRoot, "scripts", "rea.mjs");
  if (!existsSync(rea) || !existsSync(resolve(repoRoot, "node_modules"))) {
    log("     REA is not installed; skip agent registration");
    return "skipped";
  }
  const doctor = captureOutput(process.execPath, [rea, "doctor", "--json"], {
    timeout: 180_000,
  });
  if (doctor === null) {
    log("     doctor failed; run setup manually");
    return "failed";
  }
  let report;
  try {
    report = JSON.parse(doctor);
  } catch {
    log("     doctor output unreadable");
    return "failed";
  }
  const registrations = report.identity?.registrations ?? [];
  const aligned = registrations.filter(
    (entry) => entry.state === "aligned",
  ).length;
  const skillState = report.identity?.skill?.state ?? "missing";
  log(
    `     registrations ${aligned}/${registrations.length} aligned, skill ${skillState}`,
  );

  if (
    aligned === registrations.length &&
    registrations.length > 0 &&
    skillState === "aligned"
  ) {
    log("     agents already configured");
    return "ok";
  }
  if (CHECK_ONLY) {
    log("     drift: run node scripts/rea.mjs setup --all-detected --yes");
    return "drift";
  }
  const setupJson = captureOutput(
    process.execPath,
    [rea, "setup", "--all-detected", "--yes", "--json"],
    { timeout: 300_000 },
  );
  const applied = (() => {
    try {
      return setupJson === null ? null : JSON.parse(setupJson);
    } catch {
      return null;
    }
  })();
  log(
    applied === null
      ? "     setup finished (unstructured output)"
      : `     setup ${applied.status}: applied ${(applied.appliedActions ?? []).length} of ${(applied.plannedActions ?? []).length}`,
  );
  return "configured";
}

const steps = 5;
log(`TallyCraft bootstrap ${CHECK_ONLY ? "(check only)" : ""}`);
log(`  sandbox ${process.env.E2B_SANDBOX_ID ?? "(none)"} · repo ${repoRoot}`);

step(1, steps, "Git state");
const gitResult = reconcileGit();

step(2, steps, "Dependencies and build");
ensureToolchain();

step(3, steps, "Agent registrations");
ensureAgents();

step(4, steps, "TallyCraft readiness");
const readiness = run(
  process.execPath,
  [
    "--disable-warning=ExperimentalWarning",
    resolve(projectRoot, "bin", "tallycraft.js"),
    "seed",
  ],
  { capture: true, cwd: projectRoot },
);
log(
  readiness.status === 0
    ? `     ${readiness.stdout.trim().split("\n").pop()}`
    : "     seed skipped",
);

step(5, steps, "Preview");
if (SERVE && !CHECK_ONLY) {
  log("     handing over to the supervisor\n");
  const supervisor = spawnSync(
    process.execPath,
    [resolve(projectRoot, "scripts", "serve.mjs"), "--port", "3000", "--demo"],
    { cwd: projectRoot, stdio: "inherit", env: { ...process.env } },
  );
  process.exit(supervisor.status ?? 0);
}

const port = 3000;
const url =
  process.env.E2B_SANDBOX_ID === undefined
    ? null
    : `https://${port}-${process.env.E2B_SANDBOX_ID}.e2b.app`;
log(`     start with: npm run preview      (supervised, port ${port})`);
log(`     or:         npm run up          (bootstrap + supervisor)`);
if (url !== null) log(`     preview URL: ${url}`);
if (gitResult === "failed" || readiness.status !== 0) process.exitCode = 1;
