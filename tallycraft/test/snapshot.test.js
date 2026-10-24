import assert from "node:assert/strict";
import { test } from "node:test";
import { TallyCraft } from "../src/app.js";
import { seed } from "../src/seed.js";
import { collectData } from "../scripts/snapshot.mjs";

/** Every endpoint the browser client requests while browsing, in order. */
const CLIENT_REQUESTS = [
  "/api/catalog",
  "/api/company",
  "/api/statistics",
  "/api/vouchers",
  "/api/ledgers",
  "/api/reports/trial-balance",
  "/api/reports/balance-sheet",
  "/api/reports/profit-loss",
  "/api/reports/day-book",
  "/api/reports/outstanding",
  "/api/reports/stock-summary",
  "/api/reports/gst-summary",
  "/api/health",
];

function app() {
  const instance = TallyCraft.open(":memory:");
  seed(instance);
  return instance;
}

test("snapshot inlines every API response the client asks for", () => {
  const instance = app();
  const data = collectData(instance);

  for (const path of CLIENT_REQUESTS) {
    assert.ok(data[path] !== undefined, `snapshot is missing ${path}`);
  }
  // Ledger statements are keyed by id, one per ledger.
  for (const ledger of instance.listLedgers()) {
    assert.ok(
      data[`/api/reports/ledger/${ledger.id}`] !== undefined,
      `snapshot is missing the statement for ${ledger.name}`,
    );
  }
  instance.close();
});

test("snapshot figures match the live service", () => {
  const instance = app();
  const data = collectData(instance);

  assert.equal(data["/api/statistics"].counts.vouchers, 35);
  assert.equal(data["/api/reports/trial-balance"].balanced, true);
  assert.equal(data["/api/reports/balance-sheet"].balanced, true);
  assert.equal(Number(data["/api/reports/profit-loss"].netProfit), 287_907);
  assert.equal(data["/api/ledgers"].ledgers.length, 37);
  assert.equal(data["/api/reports/stock-summary"].rows.length, 3);

  const bank = data["/api/ledgers"].ledgers.find(
    (ledger) => ledger.name === "HDFC Bank - Current A/c",
  );
  const statement = data[`/api/reports/ledger/${bank.id}`];
  assert.equal(statement.closing, 569_400);
  instance.close();
});

test("snapshot data is JSON-serialisable", () => {
  const instance = app();
  const data = collectData(instance);
  const round = JSON.parse(JSON.stringify(data));
  assert.deepEqual(Object.keys(round).sort(), Object.keys(data).sort());
  instance.close();
});
