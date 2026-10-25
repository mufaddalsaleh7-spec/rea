# React client + PHP backend

TallyCraft now ships in two runtimes that answer the same requests:

| Build | Client | Server | Purpose |
| ----- | ------ | ------ | ------- |
| Node (original) | `public/app.js` (vanilla ESM) | `src/server.js` on `node:sqlite` | parity reference, CLI, offline snapshot |
| **PHP + React (this document)** | `web/` → `public/react/` | `api-php/` on `pdo_sqlite` | the deployable web app |

Both read the same SQLite schema, expose the same `/api/*` contract, and are
proven identical by `test/php-parity.test.js`.

```
web/                      React sources (JSX, no framework beyond React)
  index.html              shell, loads ./assets/app.js
  src/main.jsx            mount
  src/App.jsx             shell, sidebar, function keys, screen switch
  src/api.js              fetch wrapper + useApi hook
  src/format.js           Indian grouping, Dr/Cr, dates
  src/router.js           hash router (no router dependency)
  src/components.jsx      Card, Table, Field, Badge, Notice, …
  src/pages/*.jsx         one file per screen
  src/styles.css          dense accounting layout
api-php/
  public/index.php        front controller: /api/*, /healthz, /app/, legacy /
  autoload.php            PSR-4-ish autoloader, no Composer
  src/Bootstrap.php       config, PDO, schema, catalogue sync
  src/Router.php          every route, same payloads as src/server.js
  src/TallyCraft.php      the accounting engine (double entry, reports)
  src/Catalog.php         groups, voucher types, units, GST rates
  src/Money.php           integer paise, Indian formatting
  src/Seed.php            replays data/seed.json (generated)
  src/Xml.php             Tally envelope reader/writer
  src/schema.sql          PDO mirror of src/db.js
  data/catalog.json       generated: chart of accounts + voucher types
  data/seed.json          generated: the demo book
  tests/runner.php        request-list driver used by the parity tests
```

## Run it

### Production shape (any PHP host)

```bash
npm run build:react                                   # once, or after editing web/
php -S 0.0.0.0:8080 -t api-php/public api-php/public/index.php
# open http://localhost:8080/            → redirects to /app/
```

Requirements: PHP 8.2+ with `pdo_sqlite` and `sqlite3`. No Composer, no
extension beyond that, no build step at deploy time (the bundle is committed).

Apache/FPM: point the document root at `api-php/public` and send unknown paths
to `index.php`; the front controller serves `/api/*`, `/healthz`, `/app/*` and
falls back to the classic client for everything else.

Docker:

```bash
docker build -f Dockerfile.php -t tallycraft-php .
docker run -p 8080:8080 -v tallycraft-data:/data tallycraft-php
```

### In this sandbox / for the live preview

The sandbox has no PHP binary, so the preview runs the *same PHP files* through
`php-wasm` (real PHP 8.3 compiled to WebAssembly) behind a thin Node HTTP
server:

```bash
npm run build:react
npm run php:serve         # http://localhost:8080/app/
```

`scripts/serve-php.mjs` is a preview bridge, not production: it copies the PHP
project into the WASM filesystem once, serialises requests through one PHP
process, and serves static files itself. `api-php/public/index.php` remains the
real entry point for a host with PHP.

## Regenerating the PHP data

`api-php/data/*.json` is produced from the Node source of truth. Never edit it.

```bash
npm run export:php
# Wrote api-php/data/catalog.json (28 groups, 8 voucher types)
# Wrote api-php/data/seed.json (37 ledgers, 35 vouchers, 3 stock items)
```

Rows are exported in **insert order** so the PHP seeder assigns the same ids as
the Node one: `/api/vouchers/7` is the same voucher on both backends.

## What proves the port is honest

`npm run php:test` (also part of `npm test`) runs five suites:

1. **Route parity** — 30+ requests covering every endpoint, compared as status,
   parsed payload *and* byte-for-byte JSON text, so key order and number format
   cannot drift.
2. **Writes** — posting the same voucher, ledger, patch, stock item and delete
   against both backends and comparing the answers, then checking the book still
   balances.
3. **XML bridge** — export from Node, import into both, compare the summaries;
   assert a dry run writes nothing.
4. **Seed parity** — a book built *only* by the PHP seeder is compared with the
   Node one: totals, stock valuation, net profit, ageing, ledgers, vouchers.
5. **Front controller** — `api-php/public/index.php` is executed the way a web
   server executes it (`tests/front.php` fills in the superglobals), and must
   serve the API, the XML envelope and the React shell.

Run the React client's own render tests with:

```bash
npm run build:react
node --test test/react.test.js
```

They load the built bundle into jsdom against the PHP bridge and assert each
screen paints the numbers the API returns.

## Two bugs the port found in the original Node backend

Porting a thing is the best code review there is. Both were fixed in
`src/app.js` and covered by tests, because the reference implementation has to
be right for parity to mean anything:

- **Balance sheet headings were 100× too small.** `#sectionRows` already returns
  rupee amounts, and the liabilities branch passed them through `moneyNumber()`
  again, which divides by 100. Capital Account showed ₹24,395 instead of
  ₹24,39,500. Fixed in `src/app.js`, asserted in `test/accounting.test.js`.
- **Ledger statement totals were 100× too small.** The same double conversion,
  this time on the sum of the printed rows. Totals are now accumulated in paise.

## Deliberate differences

- **Ids and timestamps**: identical for seeded data (same insert order). Rows
  created *after* the seed interleave differently because the two processes have
  independent autoincrement counters only if their histories differ; a fresh
  book is identical.
- **`/api/instance`**: the PHP build reports `runtime: php 8.3`, the bridge
  reports itself as a preview bridge, and the Node build reports Node. Everything
  else about the payload is the same shape.
- **Static client**: the React build lives under `/app/`; the original vanilla
  client stays at `/` and `/static/` in the PHP front controller so old links
  keep working.

## Deploy checklist

- [ ] `npm run build:react` and commit `public/react/` (already committed).
- [ ] `npm run export:php` if the catalogue or demo book changed.
- [ ] Point the web root at `api-php/public`; make `data/` writable by PHP.
- [ ] Set `TALLYCRAFT_DB` to an absolute path on a persistent volume, or mount
      the default `api-php/data/tallycraft.db`.
- [ ] Back up that file. One book, one file, no server to administer.
- [ ] `curl -s /api/health` returns `{ ok: true, statistics: … }`.
