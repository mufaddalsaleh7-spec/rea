/**
 * SQLite storage for TallyCraft.
 *
 * Uses Node's built-in `node:sqlite`, so the application has no runtime
 * dependencies. Money columns are integer paise; dates are ISO `YYYY-MM-DD`
 * strings that sort lexicographically, which is what every report relies on.
 */

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { GROUPS } from "./catalog.js";

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS companies (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  mailing_name TEXT,
  address TEXT,
  gstin TEXT,
  state TEXT,
  financial_year_start TEXT NOT NULL,
  financial_year_end TEXT NOT NULL,
  base_currency TEXT NOT NULL DEFAULT 'INR',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS groups (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  parent TEXT,
  nature TEXT NOT NULL CHECK (nature IN ('assets','liabilities','income','expense')),
  natural TEXT NOT NULL CHECK (natural IN ('Dr','Cr')),
  predefined INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS ledgers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  group_id INTEGER NOT NULL REFERENCES groups(id),
  opening_paise INTEGER NOT NULL DEFAULT 0,
  opening_dated TEXT,
  gstin TEXT,
  party_type TEXT CHECK (party_type IN ('debtor','creditor',NULL)),
  mailing_name TEXT,
  address TEXT,
  phone TEXT,
  credit_days INTEGER,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS vouchers (
  id INTEGER PRIMARY KEY,
  type TEXT NOT NULL,
  number TEXT NOT NULL,
  date TEXT NOT NULL,
  narration TEXT,
  reference TEXT,
  party_ledger_id INTEGER REFERENCES ledgers(id),
  total_paise INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (type, number)
);

CREATE TABLE IF NOT EXISTS voucher_lines (
  id INTEGER PRIMARY KEY,
  voucher_id INTEGER NOT NULL REFERENCES vouchers(id) ON DELETE CASCADE,
  ledger_id INTEGER NOT NULL REFERENCES ledgers(id),
  amount_paise INTEGER NOT NULL,
  bill_ref TEXT,
  position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS stock_groups (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS stock_items (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  stock_group TEXT,
  unit TEXT NOT NULL DEFAULT 'Nos',
  opening_qty_milli INTEGER NOT NULL DEFAULT 0,
  opening_value_paise INTEGER NOT NULL DEFAULT 0,
  gst_rate REAL NOT NULL DEFAULT 0,
  hsn TEXT
);

CREATE TABLE IF NOT EXISTS voucher_inventory (
  id INTEGER PRIMARY KEY,
  voucher_id INTEGER NOT NULL REFERENCES vouchers(id) ON DELETE CASCADE,
  stock_item_id INTEGER NOT NULL REFERENCES stock_items(id),
  qty_milli INTEGER NOT NULL,
  rate_paise INTEGER NOT NULL,
  amount_paise INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_voucher_lines_ledger ON voucher_lines(ledger_id);
CREATE INDEX IF NOT EXISTS idx_voucher_lines_voucher ON voucher_lines(voucher_id);
CREATE INDEX IF NOT EXISTS idx_vouchers_date ON vouchers(date);
CREATE INDEX IF NOT EXISTS idx_vouchers_type ON vouchers(type, date);
`;

/** Open a database handle, applying the schema and catalog idempotently. */
export function openDatabase(filePath) {
  if (filePath !== ":memory:") {
    mkdirSync(dirname(filePath), { recursive: true });
  }
  const db = new DatabaseSync(filePath);
  db.exec(SCHEMA);
  seedCatalog(db);
  return db;
}

function seedCatalog(db) {
  const insert = db.prepare(
    `INSERT INTO groups (name, parent, nature, natural, predefined)
     VALUES (?, ?, ?, ?, 1)
     ON CONFLICT(name) DO UPDATE SET parent = excluded.parent, nature = excluded.nature, natural = excluded.natural`,
  );
  db.exec("BEGIN");
  try {
    for (const group of GROUPS) {
      insert.run(group.name, group.parent, group.nature, group.natural);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

const transactionDepths = new WeakMap();

/**
 * Run `work` inside a transaction, rolling back on any throw.
 *
 * Nested calls become savepoints, so a service method that owns its own
 * transaction (voucher creation) can be reused inside a larger batch import.
 * `options.rollback` discards a successful unit of work, which is how the
 * import preview validates data without persisting it.
 */
export function transaction(db, work, options = {}) {
  const depth = transactionDepths.get(db) ?? 0;
  const savepoint = `tc_savepoint_${depth}`;
  if (depth === 0) db.exec("BEGIN IMMEDIATE");
  else db.exec(`SAVEPOINT ${savepoint}`);
  transactionDepths.set(db, depth + 1);
  try {
    const result = work();
    if (depth === 0) db.exec(options.rollback === true ? "ROLLBACK" : "COMMIT");
    else db.exec(`RELEASE ${savepoint}`);
    return result;
  } catch (error) {
    if (depth === 0) db.exec("ROLLBACK");
    else {
      db.exec(`ROLLBACK TO ${savepoint}`);
      db.exec(`RELEASE ${savepoint}`);
    }
    throw error;
  } finally {
    transactionDepths.set(db, depth);
  }
}

export function all(db, sql, ...params) {
  return db.prepare(sql).all(...params);
}

export function one(db, sql, ...params) {
  return db.prepare(sql).get(...params) ?? null;
}

export function run(db, sql, ...params) {
  return db.prepare(sql).run(...params);
}
