# TallyCraft

A keyboard-first, double-entry accounting workspace built as a working
alternative to Tally Prime: masters, vouchers, trial balance, balance sheet,
profit & loss, ledger statements, outstanding with ageing, inventory, GST
summary, and Tally XML interchange.

Runs on Node.js alone — no runtime dependencies, no external database server.
The ledger lives in SQLite through Node's built-in `node:sqlite`.

```bash
cd tallycraft
npm start          # http://localhost:4310 with the demo company loaded
npm test           # 26 tests: accounting invariants, import/export, HTTP surface
```

```
Gateway of Tally · Surat Weaves Pvt Ltd · 37 ledgers · 35 vouchers
₹18,29,650 cash & bank · ₹15,22,350 receivables · ₹6,68,680 payables · ₹2,87,907 net profit
```

## Why this exists

Tally Prime is a Windows desktop product: a keyboard-driven ledger with a fixed
chart of accounts, voucher types bound to function keys, and reports that read
straight from the posting stream. TallyCraft reconstructs that model as a local
web application, using the same vocabulary (groups, ledgers, voucher types,
Dr/Cr, `Stock-in-Hand`) and Tally's own XML envelope as its interchange format,
so a book can move between the two.

The reconstruction was driven by the REA agent toolkit installed in this
repository — see [docs/REA-EVIDENCE.md](docs/REA-EVIDENCE.md) for the installed
agents, the commands run, the evidence relied on, and what could **not** be
verified.

## What is implemented

| Area             | Behaviour                                                                         |
| ---------------- | --------------------------------------------------------------------------------- |
| Company          | One company per book, financial year, GSTIN, base currency INR                    |
| Groups           | All 28 predefined Tally groups, with parent, nature and natural balance direction |
| Ledgers          | Group, Dr/Cr opening balance, GSTIN, party type, credit days, delete guards       |
| Vouchers         | Contra, Payment, Receipt, Journal, Sales, Purchase, Credit Note, Debit Note       |
| Posting          | Double entry enforced; a voucher cannot be saved unless debits equal credits      |
| Numbering        | Per type per financial year (`SAL-0001`), duplicate protection, next-number API   |
| Trial balance    | Hierarchical group tree, Dr/Cr columns, exact zero-difference check               |
| Balance sheet    | Liabilities vs assets, P&L A/c line, inventory-derived closing stock              |
| Profit & loss    | Trading account (direct) and indirect income/expense, gross and net profit        |
| Day book         | Every voucher on a date, with debit and credit legs                               |
| Ledger statement | Opening, running balance, particulars, closing Dr/Cr                              |
| Outstanding      | Receivables or payables, bill-wise ages, 0–30/31–60/61–90/90+ buckets             |
| Inventory        | Stock items, units, weighted-average valuation, quantity inward/outward           |
| GST              | Output tax, input credit, net payable from `Duties & Taxes` ledgers               |
| Interchange      | Tally XML export and import (masters and vouchers), dry-run import                |
| Interface        | Browser client with Tally function keys, print-friendly reports, JSON API         |

Deliberately **not** implemented: payroll, cost centres, budgets, multi-currency,
TDS, e-invoicing, bank reconciliation, multi-user security, and the Windows-only
interfaces (ODBC, TDL, `.900`/`.tsf` native data files). See
[docs/DESIGN.md](docs/DESIGN.md#known-limitations).

## Quick start

```bash
node bin/tallycraft.js serve --demo --port 4310   # demo book, live reload not needed
node bin/tallycraft.js serve                      # empty book at ./data/tallycraft.db
node bin/tallycraft.js seed                       # load the demo company
```

Environment:

| Variable        | Meaning          | Default                         |
| --------------- | ---------------- | ------------------------------- |
| `TALLYCRAFT_DB` | SQLite file path | `tallycraft/data/tallycraft.db` |
| `PORT`, `HOST`  | Listen address   | `4310`, `0.0.0.0`               |

The server binds to `0.0.0.0`, so it can be opened from another machine or a
preview proxy.

## Screens

- **Gateway** — cash & bank, receivables, payables, net profit, recent vouchers.
- **Masters** — chart of accounts, create ledger, stock items.
- **Transactions** — voucher register with type filter, open and delete.
- **Voucher entry** — ledger lines with live difference meter, optional inventory
  allocation, narration, `Ctrl+A` to accept.
- **Reports** — trial balance, balance sheet, P&L, day book, ledger statement,
  outstanding, stock summary, GST summary.
- **Data** — XML download, drag-and-drop XML import, demo reload, REST reference.

### Keyboard

| Key                | Action                              |
| ------------------ | ----------------------------------- |
| `F4` / `F5` / `F6` | Contra / Payment / Receipt          |
| `F7` / `F8` / `F9` | Journal / Sales / Purchase          |
| `Ctrl + A`         | Accept the open voucher             |
| `Alt + F1`         | Toggle detailed and summary reports |
| `Esc`              | Close dialog, then go back          |
| `?`                | Shortcut help                       |

## Command line

```bash
node bin/tallycraft.js report trial-balance --as-of 2026-10-24
node bin/tallycraft.js report balance-sheet
node bin/tallycraft.js report profit-loss --from 2026-04-01 --to 2026-10-24
node bin/tallycraft.js ledger list --group "Sundry Debtors"
node bin/tallycraft.js ledger add "Ganesh Traders" --group "Sundry Debtors" --opening 45000 --cr
node bin/tallycraft.js voucher add --type Receipt --date 2026-10-24 \
  --dr "HDFC Bank - Current A/c:25000" --cr "Ravi Textiles:25000"
node bin/tallycraft.js export --out book.xml
node bin/tallycraft.js import book.xml --dry-run
```

`--json` on any report prints the exact object the browser client renders.

## HTTP API

| Method       | Path                                           | Purpose                                  |
| ------------ | ---------------------------------------------- | ---------------------------------------- |
| GET          | `/api/health`                                  | Liveness plus company statistics         |
| GET          | `/api/catalog`                                 | Groups, voucher types, units, GST rates  |
| GET          | `/api/company`                                 | Company profile and financial year       |
| GET          | `/api/groups`                                  | Group list with ledger counts            |
| GET/POST     | `/api/ledgers`                                 | List (with `group`, `search`) or create  |
| PATCH/DELETE | `/api/ledgers/:id`                             | Update or delete (blocked while in use)  |
| GET/POST     | `/api/vouchers`                                | Register (with filters) or create        |
| GET/DELETE   | `/api/vouchers/:id`                            | Full voucher or delete                   |
| GET          | `/api/vouchers/next?type=&date=`               | Next number for a type                   |
| GET          | `/api/reports/trial-balance?asOf=&detailed=`   | Trial balance                            |
| GET          | `/api/reports/balance-sheet?asOf=`             | Balance sheet                            |
| GET          | `/api/reports/profit-loss?from=&to=`           | P&L                                      |
| GET          | `/api/reports/day-book?date=&type=`            | Day book                                 |
| GET          | `/api/reports/ledger?ledgerId=&from=&to=`      | Ledger statement                         |
| GET          | `/api/reports/outstanding?type=&asOf=`         | Receivables or payables                  |
| GET          | `/api/reports/stock-summary?asOf=`             | Inventory                                |
| GET          | `/api/reports/gst-summary?from=&to=`           | Output tax and input credit              |
| GET          | `/api/stock-items`                             | Stock summary alias                      |
| GET          | `/api/export/xml?from=&to=&masters=&vouchers=` | Tally envelope                           |
| POST         | `/api/import/xml?dryRun=true`                  | Import a Tally envelope                  |
| POST         | `/api/demo/reset`                              | Seed the demo company into an empty book |

Errors are tagged: `{"error":{"code":"UNBALANCED","message":"…","details":{…}}}`.

## Posting example

```bash
curl -s localhost:4310/api/vouchers -H 'content-type: application/json' -d '{
  "type": "SALES",
  "date": "2026-10-24",
  "partyLedgerId": "Ravi Textiles",
  "narration": "Invoice RT/140",
  "lines": [
    {"ledger": "Ravi Textiles", "debit": 52500},
    {"ledger": "Sales - Fabric", "credit": 50000},
    {"ledger": "Output CGST", "credit": 1250},
    {"ledger": "Output SGST", "credit": 1250}
  ],
  "inventory": [{"item": "Cotton Fabric 44in", "qty": 400, "rate": 125}]
}'
```

The response carries the stored voucher and any non-blocking warnings
(`UNUSUAL_LEDGER_GROUP`, `ONE_SIDED`). Unbalanced input is rejected with
`UNBALANCED` and the exact difference.

## Tally XML

Export writes Tally's import envelope: `<ENVELOPE><BODY><IMPORTDATA>…` with
`<LEDGER>` masters and `<VOUCHER VCHTYPE="Sales">` records. Ledger entries use
Tally's sign convention — `ISDEEMEDPOSITIVE=Yes` with a negative `AMOUNT` for a
debit, positive for a credit. Group masters reference their parent by name.

Opening balances are written as signed `OPENINGBALANCE` (debit positive, credit
negative) and read back the same way. Native Tally files (`.900`, `.tsf`) are out
of scope; use the XML gateway.

Round-trip fidelity is covered by a test that exports the demo book, imports it
into a fresh database, and compares trial-balance totals.

## Project layout

```
tallycraft/
  bin/tallycraft.js      CLI: serve, seed, report, ledger, voucher, export, import
  src/catalog.js         28 groups, voucher types, P&L section mapping
  src/money.js           integer paise, Indian digit grouping, Dr/Cr formatting
  src/db.js              schema, catalog seeding, nestable transactions
  src/app.js             service layer: masters, vouchers, reports, XML
  src/xml.js             strict small XML reader for Tally envelopes
  src/server.js          JSON API + static client
  src/seed.js            deterministic demo book (Surat Weaves Pvt Ltd)
  public/                index.html, styles.css, app.js (no build step)
  test/                  accounting invariants + HTTP boundary
  docs/                  reconstruction evidence, design notes
```

## Design rules

1. **Every figure derives from the journal.** Reports aggregate `voucher_lines`
   at read time; nothing is cached or denormalised, so the trial balance cannot
   drift from posted vouchers.
2. **Debit positive, credit negative** everywhere. A voucher is valid only when
   its lines sum to exactly zero in integer paise.
3. **Inventory owns stock.** `Stock-in-Hand` is a reserved ledger group: it
   cannot be posted to, and closing stock comes from the inventory register
   using periodic valuation (see [docs/DESIGN.md](docs/DESIGN.md)).
4. **Imports are transactional.** XML import runs inside a single transaction,
   reports per-record problems, and supports a dry run that rolls back.
5. **No silent correction.** Unusual but legal vouchers earn warnings, not
   blocks; malformed XML fails loudly with a tagged error.

## Verification

```bash
npm test
```

26 tests cover: catalog shape, money parsing and Indian grouping, seeded
balance, balance-sheet identity on four dates, per-voucher balance, rejection
paths (unbalanced, too few lines, outside FY, reserved group, unknown ledger,
duplicate number), numbering, warnings, ledger reconciliation, day-book totals,
outstanding ageing versus the debtors statistic, inventory valuation, P&L
sections, XML round-trip, dry-run rollback, master guards, and the HTTP surface
including static-path traversal.

## Licence

MIT, consistent with the repository it lives in.
