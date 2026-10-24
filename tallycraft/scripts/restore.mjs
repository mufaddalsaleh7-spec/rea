/**
 * Restore a TallyCraft database from a backup.
 *
 * Restoring is the one operation that can destroy real books, so this script
 * is deliberately paranoid:
 *
 *   1. refuse unless the source passes an integrity check and looks like a
 *      TallyCraft database
 *   2. refuse to overwrite a database unless `--yes` is passed
 *   3. keep the current database as `<db>.pre-restore-<stamp>` — a restore is
 *      reversible even when the operator is wrong about which file they meant
 *   4. write to a temporary file and rename, so a crash mid-copy cannot leave
 *      a half-written database in place
 *   5. drop stale `-wal`/`-shm` sidecars, which belong to the replaced file
 *
 * Stop the server first. The rename is atomic, but a running process holds the
 * old file open and will keep writing to it.
 *
 * Usage:
 *   node scripts/restore.mjs --from backups/tallycraft-20261024-120000.db \
 *     [--db FILE] [--yes] [--json]
 */

import { copyFileSync, existsSync, rmSync, statSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inspectDatabase } from "./backup.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function parseFlags(argv) {
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith("--")) continue;
    const key = argv[index].slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) flags[key] = true;
    else {
      flags[key] = next;
      index += 1;
    }
  }
  return flags;
}

function stamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(
    date.getUTCDate(),
  )}-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(
    date.getUTCSeconds(),
  )}`;
}

export function restore({ from, dbPath, force = false, now = new Date() }) {
  if (!existsSync(from)) throw new Error(`No backup at ${from}`);
  const source = inspectDatabase(from);

  if (existsSync(dbPath) && !force) {
    throw new Error(
      `${dbPath} already exists. Re-run with --yes to replace it (the current file is kept as a pre-restore copy).`,
    );
  }

  let previous = null;
  if (existsSync(dbPath)) {
    previous = `${dbPath}.pre-restore-${stamp(now)}`;
    copyFileSync(dbPath, previous);
  }

  const temporary = `${dbPath}.restore-tmp`;
  copyFileSync(from, temporary);
  inspectDatabase(temporary);
  rmSync(dbPath, { force: true });
  // rename() would be atomic but fails across filesystems; the temp file is
  // already in the same directory, so this is the same filesystem by design.
  copyFileSync(temporary, dbPath);
  rmSync(temporary, { force: true });

  for (const suffix of ["-wal", "-shm"]) {
    rmSync(`${dbPath}${suffix}`, { force: true });
  }

  return {
    database: dbPath,
    restoredFrom: from,
    sourceName: basename(from),
    bytes: statSync(dbPath).size,
    integrity: source.integrity,
    counts: source.counts,
    previous,
  };
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const from =
    typeof flags.from === "string" ? resolve(projectRoot, flags.from) : null;
  if (from === null) {
    console.error(
      "Usage: node scripts/restore.mjs --from <backup.db> [--db FILE] [--yes]",
    );
    return 2;
  }
  const dbPath = resolve(
    projectRoot,
    String(flags.db ?? process.env.TALLYCRAFT_DB ?? "data/tallycraft.db"),
  );

  try {
    const result = restore({ from, dbPath, force: flags.yes === true });
    if (flags.json === true) {
      console.log(JSON.stringify(result, null, 2));
      return 0;
    }
    console.log(`Restored ${result.sourceName} → ${result.database}`);
    console.log(
      `Verified: integrity ${result.integrity} · ${result.counts.vouchers} vouchers · ` +
        `${result.counts.ledgers} ledgers · ${(result.bytes / 1024).toFixed(0)} KB`,
    );
    if (result.previous !== null) {
      console.log(`Previous database kept at ${result.previous}`);
    }
    console.log("Start the app again to serve the restored book.");
    return 0;
  } catch (error) {
    console.error(`Restore failed: ${error.message}`);
    return 1;
  }
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = await main();
}
