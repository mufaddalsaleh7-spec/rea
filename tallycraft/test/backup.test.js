import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { TallyCraft } from "../src/app.js";
import { seed } from "../src/seed.js";
import { backup, inspectDatabase, pruneBackups } from "../scripts/backup.mjs";
import { restore } from "../scripts/restore.mjs";

let directory;
let dbPath;
let backupDir;

before(() => {
  directory = mkdtempSync(join(tmpdir(), "tallycraft-backup-"));
  dbPath = join(directory, "books.db");
  backupDir = join(directory, "backups");
  const app = TallyCraft.open(dbPath);
  seed(app);
  app.close();
});

after(() => rmSync(directory, { recursive: true, force: true }));

test("a backup is verified, hashed and self-describing", async () => {
  const result = await backup({ dbPath, outDir: backupDir, keep: 5 });

  assert.ok(existsSync(result.file));
  assert.match(result.name, /^tallycraft-\d{8}-\d{6}\.db$/);
  assert.equal(result.integrity, "ok");
  assert.equal(result.counts.vouchers, 35);
  assert.equal(result.counts.ledgers, 37);
  assert.match(result.sha256, /^[a-f0-9]{64}$/);
  assert.ok(result.bytes > 0);
});

test("the backup can be opened as a normal database", async () => {
  const result = await backup({ dbPath, outDir: backupDir, keep: 5 });
  const app = TallyCraft.open(result.file);
  try {
    assert.equal(app.getCompany().name, "Surat Weaves Pvt Ltd");
    assert.equal(app.trialBalance().balanced, true);
  } finally {
    app.close();
  }
});

test("restoring refuses to clobber an existing book without permission", async () => {
  const result = await backup({ dbPath, outDir: backupDir, keep: 5 });
  assert.throws(
    () => restore({ from: result.file, dbPath }),
    /already exists.*--yes/s,
  );
});

test("restoring replaces the book and keeps the old one", async () => {
  const snapshot = await backup({ dbPath, outDir: backupDir, keep: 5 });

  // Make the live book differ from the backup.
  const app = TallyCraft.open(dbPath);
  app.createLedger({ name: "Restore Probe", group: "Indirect Expenses" });
  assert.ok(
    app.listLedgers().some((ledger) => ledger.name === "Restore Probe"),
  );
  app.close();

  const result = restore({ from: snapshot.file, dbPath, force: true });
  assert.equal(result.integrity, "ok");
  assert.equal(result.counts.ledgers, 37);
  assert.ok(existsSync(result.previous), "the replaced database is kept");

  const reopened = TallyCraft.open(dbPath);
  try {
    assert.equal(
      reopened.listLedgers().some((ledger) => ledger.name === "Restore Probe"),
      false,
      "the restored book must not contain the later edit",
    );
    assert.equal(reopened.getCompany().name, "Surat Weaves Pvt Ltd");
  } finally {
    reopened.close();
  }
});

test("a corrupt file is rejected before anything is replaced", async () => {
  const junk = join(directory, "junk.db");
  writeFileSync(junk, "this is not a database");
  assert.throws(() => inspectDatabase(junk));
  assert.throws(
    () => restore({ from: junk, dbPath, force: true }),
    /integrity|not a database/i,
  );
});

test("retention keeps the newest backups only", async () => {
  const outDir = join(directory, "retention");
  const stamps = [
    "2026-10-20T00:00:00Z",
    "2026-10-21T00:00:00Z",
    "2026-10-22T00:00:00Z",
    "2026-10-23T00:00:00Z",
  ];
  for (const stamp of stamps) {
    await backup({ dbPath, outDir, keep: 99, now: new Date(stamp) });
  }
  assert.equal(readdirSync(outDir).length, 4);

  const pruned = pruneBackups(outDir, "tallycraft-", 2);
  assert.equal(pruned.length, 2);
  const remaining = readdirSync(outDir).sort();
  assert.deepEqual(remaining, [
    "tallycraft-20261022-000000.db",
    "tallycraft-20261023-000000.db",
  ]);
});

test("a missing database is reported, not silently created", async () => {
  await assert.rejects(
    backup({ dbPath: join(directory, "nope.db"), outDir: backupDir }),
    /No database/,
  );
  assert.equal(existsSync(join(directory, "nope.db")), false);
});

test("backup and restore survive a WAL-mode database with pending writes", async () => {
  const live = join(directory, "live.db");
  const app = TallyCraft.open(live);
  seed(app);
  // Leave the connection open, as a running server would: VACUUM INTO must
  // still produce a consistent copy.
  app.createLedger({ name: "In Flight", group: "Indirect Expenses" });

  const result = await backup({
    dbPath: live,
    outDir: join(directory, "wal"),
    keep: 3,
  });
  const copy = TallyCraft.open(result.file);
  try {
    assert.ok(copy.listLedgers().some((ledger) => ledger.name === "In Flight"));
  } finally {
    copy.close();
    app.close();
  }
});

test("a half-written copy is not left behind when the target exists", async () => {
  const outDir = join(directory, "twice");
  const first = await backup({
    dbPath,
    outDir,
    keep: 3,
    now: new Date("2026-10-24T10:00:00Z"),
  });
  const second = await backup({
    dbPath,
    outDir,
    keep: 3,
    now: new Date("2026-10-24T10:00:00Z"),
  });
  assert.equal(first.file, second.file, "the same minute reuses the same name");
  assert.equal(inspectDatabase(second.file).integrity, "ok");

  // Renaming a live file away must not confuse the inspector.
  const parked = `${second.file}.parked`;
  renameSync(second.file, parked);
  assert.throws(() => inspectDatabase(second.file));
  renameSync(parked, second.file);
});
