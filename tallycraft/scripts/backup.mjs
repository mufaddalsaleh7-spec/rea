/**
 * Hot backup of the TallyCraft database.
 *
 * `VACUUM INTO` writes a consistent copy through SQLite itself, so it is safe
 * to run against a live server: no downtime, no torn pages, no half-written
 * WAL. The copy is then verified (`PRAGMA integrity_check`) and hashed before
 * the command reports success, because a backup nobody verified is a rumour.
 *
 * Usage:
 *   node scripts/backup.mjs [--db FILE] [--out DIR] [--keep N] [--json]
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

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

/** Single-quote a path for a SQL string literal. */
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;

function stamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return (
    [
      date.getUTCFullYear(),
      pad(date.getUTCMonth() + 1),
      pad(date.getUTCDate()),
    ].join("") +
    `-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(
      date.getUTCSeconds(),
    )}`
  );
}

/** Verify that a file is a readable TallyCraft database. */
export function inspectDatabase(path) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const integrity = db.prepare("PRAGMA integrity_check").get();
    const verdict = Object.values(integrity ?? {})[0] ?? "unknown";
    if (verdict !== "ok") throw new Error(`integrity_check failed: ${verdict}`);
    const tables = new Set(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((row) => row.name),
    );
    if (!tables.has("companies") || !tables.has("vouchers")) {
      throw new Error("not a TallyCraft database (missing core tables)");
    }
    const counts = {
      companies: db.prepare("SELECT count(*) AS n FROM companies").get().n,
      vouchers: db.prepare("SELECT count(*) AS n FROM vouchers").get().n,
      ledgers: db.prepare("SELECT count(*) AS n FROM ledgers").get().n,
    };
    return { integrity: verdict, counts };
  } finally {
    db.close();
  }
}

/** Remove all but the newest `keep` files matching `<prefix>*.db`. */
export function pruneBackups(directory, prefix, keep) {
  if (!Number.isInteger(keep) || keep <= 0) return [];
  const files = readdirSync(directory)
    .filter((name) => name.startsWith(prefix) && name.endsWith(".db"))
    .sort()
    .reverse();
  const doomed = files.slice(keep);
  for (const name of doomed) rmSync(join(directory, name), { force: true });
  return doomed;
}

export async function backup({ dbPath, outDir, keep = 14, now = new Date() }) {
  if (!existsSync(dbPath)) {
    throw new Error(
      `No database at ${dbPath}. Start the app once to create it.`,
    );
  }
  mkdirSync(outDir, { recursive: true });

  const name = `tallycraft-${stamp(now)}.db`;
  const target = resolve(outDir, name);
  if (existsSync(target)) rmSync(target, { force: true });

  const db = new DatabaseSync(dbPath);
  try {
    db.exec(`VACUUM INTO ${quote(target)}`);
  } finally {
    db.close();
  }

  const { integrity, counts } = inspectDatabase(target);
  const bytes = statSync(target).size;
  const digest = createHash("sha256")
    .update(await readFile(target))
    .digest("hex");
  const removed = pruneBackups(outDir, "tallycraft-", keep);

  return {
    file: target,
    name,
    bytes,
    sha256: digest,
    integrity,
    counts,
    pruned: removed,
    database: dbPath,
  };
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const dbPath = resolve(
    projectRoot,
    String(flags.db ?? process.env.TALLYCRAFT_DB ?? "data/tallycraft.db"),
  );
  const outDir = resolve(
    projectRoot,
    String(flags.out ?? process.env.TALLYCRAFT_BACKUP_DIR ?? "backups"),
  );
  const keep = Number(flags.keep ?? process.env.TALLYCRAFT_BACKUP_KEEP ?? 14);

  try {
    const result = await backup({ dbPath, outDir, keep });
    if (flags.json === true) {
      console.log(JSON.stringify(result, null, 2));
      return 0;
    }
    console.log(`Backup: ${result.file}`);
    console.log(
      `Size: ${(result.bytes / 1024).toFixed(0)} KB · integrity ${result.integrity} · ` +
        `${result.counts.vouchers} vouchers · ${result.counts.ledgers} ledgers`,
    );
    console.log(`SHA-256: ${result.sha256}`);
    if (result.pruned.length > 0) {
      console.log(
        `Pruned ${result.pruned.length} old backup(s), keeping ${keep}`,
      );
    }
    return 0;
  } catch (error) {
    console.error(`Backup failed: ${error.message}`);
    return 1;
  }
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = await main();
}
