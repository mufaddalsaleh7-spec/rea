# TallyCraft

A keyboard-first, double-entry accounting workspace built as a working
alternative to Tally Prime: masters, vouchers, trial balance, balance sheet,
profit & loss, ledger statements, outstanding with ageing, inventory, GST
summary, and Tally XML interchange.

Runs on Node.js alone — no runtime dependencies, no external database server.
The ledger lives in SQLite through Node's built-in `node:sqlite`.

```bash
cd tallycraft
npm run up         # bootstrap + supervised preview on http://localhost:3000
npm test           # 39 tests: accounting, import/export, snapshot, supervisor, HTTP
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

### Bring it up in one command

A sandbox is recycled between sessions and comes back with a new hostname, an
empty `$HOME` and the base commit checked out. `npm run up` repairs all of that
idempotently and starts a supervised server:

```bash
npm run check   # diagnosis only, changes nothing
npm run up      # repair drifted state, then serve under supervision
```

The server publishes its own identity, including the preview URL, so nothing has
to be guessed:

```bash
curl -s localhost:3000/api/instance
# { "service": "tallycraft", "status": "ok", "port": 3000,
#   "previewUrl": "https://3000-<sandbox>.e2b.app", "git": { ... }, ... }
```

The supervisor reuses or skips a held port, restarts on crash with backoff,
restarts on hang after three failed probes, and refuses to double-bind. See
[docs/RUNBOOK.md](docs/RUNBOOK.md) for the failure model and incident record.

### Three ways to open it

|               | How                                                              | What you get                                                        |
| ------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------- |
| **Live app**  | `npm start` → http://localhost:3000 (or the chat's live preview) | Full read-write book: post vouchers, create ledgers, import XML     |
| **Installed** | same URL → **Install app**, or _Add to Home screen_ on a phone   | Standalone window, own icon, offline shell                          |
| **Snapshot**  | open `public/snapshot.html` (also served at `/snapshot.html`)    | The same screens over a frozen copy of the book, no server required |

The snapshot inlines the API responses (`npm run snapshot`) and swaps `fetch`
for a lookup table, so one 176 KB HTML file renders real reports offline. It is
read-only by design; posting is disabled.

### Install it as an app

TallyCraft ships as a progressive web app, so it behaves like a desktop or
phone app without a wrapper:

- `public/manifest.webmanifest` — name, icons (192/512, maskable), theme
  colours, standalone display, and three shortcuts (new sale, day book, trial
  balance) that deep-link the router.
- `public/sw.js` — a service worker. Navigations are network-first with the
  cached shell as fallback; `/api/*` reads fall back to the last good response;
  writes are never faked. The header shows an **offline** pill while the device
  has no network, and an **Install app** button appears when the browser offers
  one.
- Mobile layout — under 640 px the primary navigation becomes a bottom tab bar
  with 44 px tap targets, the F-key strip is hidden, and safe-area insets are
  respected in standalone mode.
- Icons are generated, not pasted: `npm run icons` redraws the PNG set and
  `favicon.ico` from the same geometry as `public/icons/icon.svg`.

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
npm run snapshot                                        # rebuild public/snapshot.html
```

`--json` on any report prints the exact object the browser client renders.

## HTTP API

| Method       | Path                                           | Purpose                                  |
| ------------ | ---------------------------------------------- | ---------------------------------------- |
| GET          | `/healthz`                                     | Plain-text liveness probe (`ok`)         |
| GET          | `/snapshot.html`                               | Offline, read-only copy of the client    |
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
  src/instance.js        run identity and preview-URL derivation
  src/seed.js            deterministic demo book (Surat Weaves Pvt Ltd)
  scripts/snapshot.mjs   builds public/snapshot.html from the live service
  scripts/generate-icons.mjs  rasterises the app icons with no dependencies
  scripts/serve.mjs      supervisor: port resolution, restart, watchdog, discovery
  scripts/bootstrap.mjs  idempotent bring-up for a recycled sandbox
  scripts/backup.mjs     hot, verified backup (VACUUM INTO) with retention
  scripts/restore.mjs    guarded restore that keeps the replaced database
  scripts/healthcheck.mjs container health probe for /healthz
  src/config.js          environment contract, validated at boot
  public/                index.html, styles.css, app.js (no build step)
  public/manifest.webmanifest  installable-app metadata and shortcuts
  public/sw.js           service worker: offline shell and cached reads
  public/icons/          generated PNG icons, maskable and apple-touch
  test/                  accounting invariants, HTTP boundary, deploy contract
  docs/                  reconstruction evidence, design notes, deploy guide
  Dockerfile             production image: node:22-alpine, non-root, healthcheck
  docker-compose.yml     single-host deploy with a named volume at /data
  render.yaml, fly.toml  managed-platform blueprints
  deploy/                systemd unit, nginx and Caddy configs
```

## Deploy it

The app is one Node process and one SQLite file, so deployment is mostly about
where that file lives and who can reach the port.

```bash
cp .env.example .env          # TALLYCRAFT_DEMO=0 for a real book
docker compose up -d --build  # → http://localhost:3000
docker compose ps             # STATUS becomes "healthy"
```

| Target          | Files                                                  |
| --------------- | ------------------------------------------------------ |
| Single host     | `docker-compose.yml`, `Dockerfile`                     |
| VPS + TLS       | `deploy/systemd/`, `deploy/nginx/`, `deploy/Caddyfile` |
| Render / Fly.io | `render.yaml`, `fly.toml`                              |

Configuration is environment-only and validated at boot (`src/config.js`): a
bad `PORT` or `PUBLIC_URL` stops the process with the variable named instead of
booting into a wrong configuration.

```bash
node scripts/backup.mjs                    # hot, verified, hashed
node scripts/restore.mjs --from <file> --yes
docker compose exec tallycraft node scripts/backup.mjs
```

Backups use `VACUUM INTO`, so they are consistent while the server is writing.
Restores verify the source first, keep the replaced database, and replace the
file atomically. **Run exactly one instance per database** — SQLite allows many
readers but one writer, which is the same rule as a paper book having one keeper.

Full guide, including TLS, auth, upgrade and rollback procedures:
[docs/DEPLOY.md](docs/DEPLOY.md).

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

## Operations

| Command               | Purpose                                                           |
| --------------------- | ----------------------------------------------------------------- |
| `npm run check`       | Report drift (git, deps, build, agents) without changing anything |
| `npm run up`          | Repair drift, then serve under the supervisor                     |
| `npm run preview`     | Start/verify the supervised preview on port 3000                  |
| `--aliases 8080,5173` | Extra ports that answer the same app (default `8080,5173,4000`)   |
| `npm run bootstrap`   | Repair only, no server                                            |
| `npm run snapshot`    | Rebuild the offline `public/snapshot.html`                        |
| `npm run icons`       | Regenerate the PNG icons and `favicon.ico`                        |
| `npm run backup`      | Verified hot backup into `backups/` (retention 14)                |
| `npm run restore`     | Restore a backup; keeps the replaced file as `.pre-restore-*`     |
| `npm run health`      | Probe `/healthz` the way the container healthcheck does           |
| `npm run docker:up`   | Build and start the single-host deployment                        |

Supervisor guarantees, each covered by a test or a recorded manual check:

- reuses its own listener, skips a foreign one, never binds over a stranger
- second start prints `already running` and exits 0
- crash restart with exponential backoff, bounded to avoid crash loops
- hang watchdog restarts after three consecutive failed health probes
- `SIGKILL` of the supervisor cannot orphan the server: the child watches its
  parent and exits, releasing the port within ~2 s

## Verification

```bash
npm test
```

71 tests cover: catalog shape, money parsing and Indian grouping, seeded
balance, balance-sheet identity on four dates, per-voucher balance, rejection
paths (unbalanced, too few lines, outside FY, reserved group, unknown ledger,
duplicate number), numbering, warnings, ledger reconciliation, day-book totals,
outstanding ageing versus the debtors statistic, inventory valuation, P&L
sections, XML round-trip, dry-run rollback, master guards, and the HTTP surface
including static-path traversal, plus a check that a dry-run import reports
exactly what the real import would do, and that a generated snapshot inlines
every response the client asks for, plus the supervisor's port resolution
(reuse, skip, exhaust), instance identity, and the readiness contract, plus the
web-app contract: the manifest is valid and every icon it lists is served, the
worker is delivered from the root with a root scope, and every path the worker
precaches actually exists, the deployment contract (the image exposes the port
the app uses, the volume sits where `TALLYCRAFT_DB` points, the proxies forward
the host and never cache the API), configuration parsing, and backup/restore
including the refusal paths.

## Licence

MIT, consistent with the repository it lives in.
