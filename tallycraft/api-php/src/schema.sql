-- TallyCraft schema, PHP port.
--
-- Byte-for-byte the same contract as src/db.js: integer paise, ISO dates,
-- debit positive / credit negative. `test/php.test.js` compares this schema
-- against the one Node creates, so the two backends cannot drift apart.

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
