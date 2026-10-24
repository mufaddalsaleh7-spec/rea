import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { TallyCraft } from "../src/app.js";
import { seed } from "../src/seed.js";
import { createAppServer } from "../src/server.js";

const publicDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "public",
);
let server;
let base;
let directory;

before(async () => {
  directory = await mkdtemp(join(tmpdir(), "tallycraft-"));
  const dbPath = join(directory, "test.db");
  const app = TallyCraft.open(dbPath);
  seed(app);
  server = createAppServer({ dbPath, publicDir, app, logRequests: false });
  await new Promise((ready) => server.listen(0, "127.0.0.1", ready));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((done) => server.close(done));
  await rm(directory, { recursive: true, force: true });
});

test("health and company endpoints answer", async () => {
  const health = await fetch(`${base}/api/health`).then((response) =>
    response.json(),
  );
  assert.equal(health.ok, true);
  assert.equal(health.statistics.counts.vouchers, 35);

  const company = await fetch(`${base}/api/company`).then((response) =>
    response.json(),
  );
  assert.equal(company.name, "Surat Weaves Pvt Ltd");
  assert.equal(company.financialYearStart, "2026-04-01");
});

test("reports are exposed over HTTP", async () => {
  const trial = await fetch(
    `${base}/api/reports/trial-balance?asOf=2026-10-24`,
  ).then((response) => response.json());
  assert.equal(trial.balanced, true);

  const sheet = await fetch(
    `${base}/api/reports/balance-sheet?asOf=2026-10-24`,
  ).then((response) => response.json());
  assert.equal(sheet.balanced, true);

  const profit = await fetch(`${base}/api/reports/profit-loss`).then(
    (response) => response.json(),
  );
  assert.equal(Number(profit.netProfit), 287_907);
});

test("a voucher can be created through the API", async () => {
  const response = await fetch(`${base}/api/vouchers`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "RECEIPT",
      date: "2026-10-23",
      narration: "Received from Ravi Textiles",
      lines: [
        { ledger: "HDFC Bank - Current A/c", debit: 25_000 },
        { ledger: "Ravi Textiles", credit: 25_000 },
      ],
    }),
  });
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.voucher.number, "RCP-0006");
  assert.equal(body.voucher.total, 25_000);

  const list = await fetch(`${base}/api/vouchers?limit=5`).then((entry) =>
    entry.json(),
  );
  assert.equal(list.vouchers[0].number, "RCP-0006");
});

test("invalid vouchers return a tagged 400", async () => {
  const response = await fetch(`${base}/api/vouchers`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "JOURNAL",
      date: "2026-10-23",
      lines: [
        { ledger: "Cash", debit: 100 },
        { ledger: "Rent", credit: 90 },
      ],
    }),
  });
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error.code, "UNBALANCED");
  assert.equal(body.error.details.difference, "10.00");
});

test("unknown ledgers return 404", async () => {
  const response = await fetch(`${base}/api/ledgers/99999`);
  assert.equal(response.status, 404);
  const body = await response.json();
  assert.equal(body.error.code, "UNKNOWN_LEDGER");
});

test("client shell and assets are served", async () => {
  const html = await fetch(`${base}/`).then((response) => response.text());
  assert.match(html, /TallyCraft/);
  assert.match(html, /\/app\.js/);

  const script = await fetch(`${base}/app.js`);
  assert.equal(script.status, 200);
  assert.match(script.headers.get("content-type"), /javascript/);

  const fallback = await fetch(`${base}/reports/anything`);
  assert.equal(fallback.status, 200);
  assert.match(fallback.headers.get("content-type"), /text\/html/);
});

test("static handler refuses paths outside the client root", async () => {
  const response = await fetch(`${base}/..%2f..%2fpackage.json`);
  const body = await response.text();
  assert.equal(body.includes('"name": "tallycraft"'), false);
});

test("Tally XML exports over HTTP", async () => {
  const response = await fetch(`${base}/api/export/xml`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /xml/);
  assert.match(response.headers.get("content-disposition"), /attachment/);
  const xml = await response.text();
  assert.match(xml, /<VOUCHER VCHTYPE="Receipt"/);
});
