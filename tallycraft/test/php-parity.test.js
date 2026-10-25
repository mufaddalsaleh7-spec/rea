/**
 * Node ↔ PHP parity.
 *
 * Two backends, one contract. This test seeds a real book with the Node
 * seeder, asks both backends the same questions against the same file, and
 * requires identical answers — status, payload and JSON text. It is the only
 * thing standing between "we ported it" and "the reports agree".
 *
 * PHP is executed with php-wasm because this sandbox has no PHP binary; the
 * child process exits when it is done, because the WASM runtime keeps the event
 * loop alive. If php-wasm is not installed the test skips with a message rather
 * than pretending to have checked anything.
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { after, before, describe, test } from "node:test";
import { TallyCraft } from "../src/app.js";
import { seed } from "../src/seed.js";

const run = promisify(execFile);
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Start a PHP child process, retrying once.
 *
 * php-wasm boots an 8 MB WebAssembly PHP on first use; under a loaded machine
 * that first boot can exceed the spawn budget and fail for no reason of ours.
 * One retry turns a flake into a slow pass.
 */
async function harness(args) {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const { stdout } = await run(
        process.execPath,
        ["--disable-warning=ExperimentalWarning", join(projectRoot, "scripts", "php-harness.mjs"), ...args],
        { cwd: projectRoot, timeout: 240_000, maxBuffer: 64 * 1024 * 1024 },
      );
      return stdout;
    } catch (error) {
      if (attempt === 2) throw error;
      await new Promise((done) => setTimeout(done, 2_000));
    }
  }
  throw new Error("unreachable");
}

/** Every question the client asks, plus the reports that carry arithmetic. */
const REQUESTS = [
  { method: "GET", path: "/healthz" },
  { method: "GET", path: "/api/catalog" },
  { method: "GET", path: "/api/company" },
  { method: "GET", path: "/api/statistics" },
  { method: "GET", path: "/api/groups" },
  { method: "GET", path: "/api/ledgers" },
  { method: "GET", path: "/api/ledgers", query: { group: "Sundry Debtors" } },
  { method: "GET", path: "/api/ledgers", query: { search: "bank" } },
  { method: "GET", path: "/api/vouchers" },
  { method: "GET", path: "/api/vouchers", query: { limit: "5", type: "SALES" } },
  { method: "GET", path: "/api/vouchers/1" },
  { method: "GET", path: "/api/vouchers/next", query: { type: "SALES", date: "2026-04-01" } },
  { method: "GET", path: "/api/vouchers/next", query: { type: "F8" } },
  { method: "GET", path: "/api/reports/trial-balance" },
  { method: "GET", path: "/api/reports/trial-balance", query: { asOf: "2026-09-30" } },
  { method: "GET", path: "/api/reports/balance-sheet" },
  { method: "GET", path: "/api/reports/balance-sheet", query: { asOf: "2027-03-31" } },
  { method: "GET", path: "/api/reports/profit-loss" },
  { method: "GET", path: "/api/reports/profit-loss", query: { from: "2026-04-01", to: "2026-12-31" } },
  { method: "GET", path: "/api/reports/day-book", query: { date: "2026-04-01" } },
  { method: "GET", path: "/api/reports/outstanding" },
  { method: "GET", path: "/api/reports/outstanding", query: { type: "payable" } },
  { method: "GET", path: "/api/reports/stock-summary" },
  { method: "GET", path: "/api/reports/gst-summary" },
  { method: "GET", path: "/api/reports/ledger", query: { ledgerId: "1" } },
  { method: "GET", path: "/api/reports/ledger", query: { ledgerId: "37" } },
  { method: "GET", path: "/api/reports/nope" },
  { method: "GET", path: "/api/stock-items" },
  { method: "GET", path: "/api/vouchers/9999" },
  { method: "GET", path: "/api/nothing" },
];

let directory;
let dbPath;
let phpResponses;

/** Ask the Node server the same questions, in-process. */
async function askNode(requests) {
  const { createAppServer } = await import("../src/server.js");
  const app = TallyCraft.open(dbPath);
  const server = createAppServer({
    publicDir: join(projectRoot, "public"),
    app,
    instance: () => ({ service: "tallycraft", status: "ok", port: 0 }),
    logRequests: false,
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address();
  const answers = [];
  try {
    for (const request of requests) {
      const query = new URLSearchParams(request.query ?? {}).toString();
      const url = `http://127.0.0.1:${port}${request.path}${query === "" ? "" : `?${query}`}`;
      const response = await fetch(url, { method: request.method ?? "GET" });
      const text = await response.text();
      answers.push({ status: response.status, text });
    }
  } finally {
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
  }
  return answers;
}

let phpAvailable = true;

before(async () => {
  directory = await mkdtemp(join(tmpdir(), "tallycraft-parity-"));
  dbPath = join(directory, "books.db");
  const app = TallyCraft.open(dbPath);
  seed(app);
  app.close();

  const requestsFile = join(directory, "requests.json");
  await writeFile(requestsFile, JSON.stringify(REQUESTS), "utf8");
  // PHP writes (it opens the book read-write), so give it its own copy.
  const phpDb = join(directory, "php.db");
  await copyFile(dbPath, phpDb);

  try {
    phpResponses = JSON.parse(await harness(["--db", phpDb, "--requests", requestsFile]));
  } catch (error) {
    phpAvailable = false;
    console.error("php harness unavailable:", error.message.slice(0, 400));
  }
});

after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

describe("the PHP backend answers exactly like the Node backend", { skip: !phpAvailable }, () => {
  test("every route returns the same status and the same JSON text", async () => {
    const nodeAnswers = await askNode(REQUESTS);
    assert.equal(phpResponses.length, REQUESTS.length, "PHP must answer every request");

    for (const [index, request] of REQUESTS.entries()) {
      const label = `${request.method ?? "GET"} ${request.path}${request.query ? ` ${JSON.stringify(request.query)}` : ""}`;
      const node = nodeAnswers[index];
      const php = phpResponses[index];

      assert.equal(php.status, node.status, `${label}: status`);
      if (typeof php.body === "string") {
        assert.equal(php.body, node.text.trim(), `${label}: body`);
        continue;
      }
      // Compare parsed payloads, then the serialised text, so a key order or
      // number-format difference is caught rather than silently tolerated.
      assert.deepEqual(php.body, JSON.parse(node.text), `${label}: payload`);
      assert.equal(
        php.json,
        node.text,
        `${label}: byte-for-byte JSON (key order and number format)`,
      );
    }
  });

  test("the reports agree on the numbers that matter", () => {
    const find = (path) => phpResponses[REQUESTS.findIndex((request) => request.path === path)].body;

    const trialBalance = find("/api/reports/trial-balance");
    assert.equal(trialBalance.balanced, true);
    assert.deepEqual(trialBalance.totals, { debit: 5_293_580, credit: 5_293_580 });

    const balanceSheet = find("/api/reports/balance-sheet");
    assert.equal(balanceSheet.balanced, true);

    const profitLoss = find("/api/reports/profit-loss");
    assert.equal(profitLoss.netProfit, 287_907);

    const statistics = find("/api/statistics");
    assert.deepEqual(statistics.counts, { ledgers: 37, vouchers: 35, groups: 28, stockItems: 3 });
    assert.equal(statistics.netProfit, 287_907);
  });

  test("PHP refuses bad input with the same codes as Node", () => {
    const unknownReport = phpResponses[REQUESTS.findIndex((r) => r.path === "/api/reports/nope")];
    assert.equal(unknownReport.status, 404);
    assert.equal(unknownReport.body.error.code, "UNKNOWN_REPORT");

    const unknownVoucher = phpResponses[REQUESTS.findIndex((r) => r.path === "/api/vouchers/9999")];
    assert.equal(unknownVoucher.status, 404);
    assert.equal(unknownVoucher.body.error.code, "UNKNOWN_VOUCHER");

    const unknownRoute = phpResponses[REQUESTS.findIndex((r) => r.path === "/api/nothing")];
    assert.equal(unknownRoute.status, 404);
    assert.equal(unknownRoute.body.error.code, "NOT_FOUND");
  });
});

describe("the PHP backend can write", { skip: !phpAvailable }, () => {
  /** The same write scenario, run against both backends on their own copy. */
  const WRITES = [
    {
      method: "POST",
      path: "/api/vouchers",
      body: {
        type: "SALES",
        date: "2026-06-15",
        narration: "Parity probe",
        lines: [
          { ledger: "Ravi Textiles", debit: "11,80,000" },
          { ledger: "Sales - Fabric", credit: "10,00,000" },
          { ledger: "Output CGST", credit: "90,000" },
          { ledger: "Output SGST", credit: "90,000" },
        ],
      },
    },
    { method: "GET", path: "/api/vouchers", query: { limit: "50" } },
    { method: "GET", path: "/api/reports/trial-balance" },
    // Opening balance zero: an opening figure with no contra entry would make
    // the sheet disagree, and that is not what this test is about.
    {
      method: "POST",
      path: "/api/ledgers",
      body: { name: "Parity Bank", group: "Bank Accounts", opening: "0" },
    },
    {
      method: "POST",
      path: "/api/vouchers",
      body: {
        type: "JOURNAL",
        date: "2026-06-16",
        lines: [
          { ledger: "Cash", debit: 100 },
          { ledger: "Parity Bank", debit: 100 },
        ],
      },
    },
    {
      method: "POST",
      path: "/api/vouchers",
      body: {
        type: "JOURNAL",
        date: "2026-06-16",
        narration: "Transfer to bank",
        lines: [
          { ledger: "Parity Bank", debit: "5,000" },
          { ledger: "Cash", credit: "5,000" },
        ],
      },
    },
    { method: "GET", path: "/api/reports/balance-sheet" },
    { method: "GET", path: "/api/reports/ledger", query: { ledgerId: "38" } },
    { method: "GET", path: "/api/ledgers/38" },
    {
      method: "PATCH",
      path: "/api/ledgers/38",
      body: { opening: "2,500", openingType: "Cr", phone: "0261-4000000" },
    },
    {
      method: "POST",
      path: "/api/stock-items",
      body: { name: "Silk Scarf", group: "Garments", unit: "Pcs", openingQty: 40, openingValue: 12000, gstRate: 12, hsn: "6214" },
    },
    { method: "GET", path: "/api/reports/stock-summary" },
    { method: "DELETE", path: "/api/ledgers/38" },
  ];

  let nodeAnswers;
  let phpAnswers;

  before(async () => {
    const shared = join(directory, "write-source.db");
    const app = TallyCraft.open(shared);
    seed(app);
    app.close();

    const nodeDb = join(directory, "write-node.db");
    const phpDb = join(directory, "write-php.db");
    await copyFile(shared, nodeDb);
    await copyFile(shared, phpDb);

    // Node: drive the real HTTP server so nothing is special-cased.
    const { createAppServer } = await import("../src/server.js");
    const nodeApp = TallyCraft.open(nodeDb);
    const server = createAppServer({
      publicDir: join(projectRoot, "public"),
      app: nodeApp,
      instance: () => ({}),
      logRequests: false,
    });
    await new Promise((done) => server.listen(0, "127.0.0.1", done));
    const { port } = server.address();
    nodeAnswers = [];
    try {
      for (const request of WRITES) {
        const query = new URLSearchParams(request.query ?? {}).toString();
        const response = await fetch(
          `http://127.0.0.1:${port}${request.path}${query === "" ? "" : `?${query}`}`,
          {
            method: request.method ?? "GET",
            headers: request.body ? { "content-type": "application/json" } : {},
            body: request.body ? JSON.stringify(request.body) : undefined,
          },
        );
        nodeAnswers.push({ status: response.status, text: await response.text() });
      }
    } finally {
      server.closeAllConnections();
      await new Promise((done) => server.close(done));
    }

    const requestsFile = join(directory, "write-requests.json");
    await writeFile(requestsFile, JSON.stringify(WRITES), "utf8");
    phpAnswers = JSON.parse(await harness(["--db", phpDb, "--requests", requestsFile]));
  });

  test("a posted voucher lands identically in both books", () => {
    for (const [index, request] of WRITES.entries()) {
      const label = `${request.method} ${request.path}`;
      assert.equal(phpAnswers[index].status, nodeAnswers[index].status, `${label}: status`);
      assert.deepEqual(
        phpAnswers[index].body,
        JSON.parse(nodeAnswers[index].text),
        `${label}: payload`,
      );
    }
  });

  test("the write actually happened and the book still balances", () => {
    const created = phpAnswers[0];
    assert.equal(created.status, 201);
    assert.equal(created.body.voucher.total, 1_180_000);
    assert.equal(created.body.voucher.typeName, "Sales");
    assert.equal(created.body.voucher.party.name, "Ravi Textiles");
    assert.deepEqual(created.body.warnings, []);

    const numbers = phpAnswers[1].body.vouchers.map((voucher) => voucher.number);
    assert.ok(
      numbers.includes(created.body.voucher.number),
      "the new voucher is in the book",
    );
    assert.equal(phpAnswers[2].body.balanced, true, "trial balance holds after the sale");
    assert.equal(phpAnswers[6].body.balanced, true, "balance sheet balances after the writes");
  });

  test("a ledger created in PHP is readable through the same API", () => {
    const ledger = phpAnswers[3];
    assert.equal(ledger.status, 201);
    assert.equal(ledger.body.name, "Parity Bank");
    assert.equal(ledger.body.group, "Bank Accounts");
    assert.equal(ledger.body.opening, 0);
  });

  test("an unbalanced voucher is refused, never stored", () => {
    const refused = phpAnswers[4];
    assert.equal(refused.status, 400);
    assert.equal(refused.body.error.code, "UNBALANCED");
    assert.equal(refused.body.error.details.difference, "200.00");
  });

  test("a posted transfer moves money between the two ledgers", () => {
    const transfer = phpAnswers[5];
    assert.equal(transfer.status, 201);
    assert.equal(transfer.body.voucher.total, 5000);
    assert.equal(transfer.body.voucher.type, "JOURNAL");

    // The ledger report for the new bank account shows the 5,000 debit.
    const bank = phpAnswers[7].body;
    assert.equal(bank.ledger.name, "Parity Bank");
    assert.equal(bank.closing, 5000);
  });
});

describe("the XML bridge behaves the same in both backends", { skip: !phpAvailable }, () => {
  let nodeXml;
  let phpXml;
  let nodeAnswers;
  let phpAnswers;

  before(async () => {
    const shared = join(directory, "xml-source.db");
    const app = TallyCraft.open(shared);
    seed(app);
    nodeXml = app.exportXml({});
    app.close();

    const nodeDb = join(directory, "xml-node.db");
    const phpDb = join(directory, "xml-php.db");
    await copyFile(shared, nodeDb);
    await copyFile(shared, phpDb);

    const { createAppServer } = await import("../src/server.js");
    const nodeApp = TallyCraft.open(nodeDb);
    const server = createAppServer({
      publicDir: join(projectRoot, "public"),
      app: nodeApp,
      instance: () => ({}),
      logRequests: false,
    });
    await new Promise((done) => server.listen(0, "127.0.0.1", done));
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    try {
      // Export the same window from both sides, then re-import the Node export
      // into both books: a dry run first, then the real thing.
      const exportResponse = await fetch(`${base}/api/export/xml`);
      nodeXml = await exportResponse.text();
      nodeAnswers = [];
      for (const query of ["dryRun=true", "dryRun=false"]) {
        const response = await fetch(`${base}/api/import/xml?${query}`, {
          method: "POST",
          headers: { "content-type": "application/xml" },
          body: nodeXml,
        });
        nodeAnswers.push({ status: response.status, text: await response.text() });
      }
    } finally {
      server.closeAllConnections();
      await new Promise((done) => server.close(done));
    }

    const requestsFile = join(directory, "xml-requests.json");
    await writeFile(
      requestsFile,
      JSON.stringify([
        { method: "GET", path: "/api/export/xml" },
        { method: "POST", path: "/api/import/xml", query: { dryRun: "true" }, body: nodeXml },
        { method: "POST", path: "/api/import/xml", query: { dryRun: "false" }, body: nodeXml },
        { method: "GET", path: "/api/statistics" },
      ]),
      "utf8",
    );
    phpAnswers = JSON.parse(await harness(["--db", phpDb, "--requests", requestsFile]));
    phpXml = phpAnswers[0].body;
  });

  test("the exported envelope is identical", () => {
    assert.equal(phpXml, nodeXml);
    assert.ok(nodeXml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
    assert.match(nodeXml, /<VOUCHER VCHTYPE="Sales" ACTION="Create">/);
  });

  test("importing that envelope reports the same result", () => {
    for (const [index, request] of [
      { method: "POST", path: "/api/import/xml?dryRun=true" },
      { method: "POST", path: "/api/import/xml?dryRun=false" },
    ].entries()) {
      assert.equal(phpAnswers[index + 1].status, nodeAnswers[index].status, `${request.path}: status`);
      assert.deepEqual(
        phpAnswers[index + 1].body,
        JSON.parse(nodeAnswers[index].text),
        `${request.path}: summary`,
      );
    }
  });

  test("a dry run is a preview: it writes nothing", () => {
    const dry = phpAnswers[1].body;
    assert.equal(dry.dryRun, true);
    assert.equal(dry.vouchers, 0, "the book already contains these vouchers");
    assert.ok(dry.skipped > 0);
    assert.equal(phpAnswers[3].body.counts.vouchers, 35, "the book is unchanged");
  });
});

describe("the PHP seeder reproduces the Node demo book", { skip: !phpAvailable }, () => {
  // The parity suites above run on a book seeded by Node, which would hide a
  // seeder that writes different numbers. This suite seeds with PHP alone
  // (`POST /api/demo/reset`) and compares every report against Node's seed.
  let nodeReports;
  let phpReports;
  const PATHS = [
    "/api/statistics",
    "/api/reports/trial-balance",
    "/api/reports/balance-sheet",
    "/api/reports/profit-loss",
    "/api/reports/stock-summary",
    "/api/reports/gst-summary",
    "/api/reports/outstanding",
    "/api/reports/day-book?date=2026-04-03",
    "/api/ledgers",
    "/api/vouchers?limit=500",
  ];

  before(async () => {
    const requestsFile = join(directory, "seed-requests.json");
    await writeFile(
      requestsFile,
      JSON.stringify(
        PATHS.map((path) => {
          const [pathname, query = ""] = path.split("?");
          return {
            method: "GET",
            path: pathname,
            query: Object.fromEntries(new URLSearchParams(query)),
          };
        }),
      ),
      "utf8",
    );
    // A child process: a fresh PHP book leaves the WASM runtime holding the
    // event loop, and the child knows how to end itself.
    phpReports = JSON.parse(await harness(["--fresh", "--requests", requestsFile])).map(
      (answer) => answer.body,
    );

    const nodeDb = join(directory, "seed-node.db");
    const app = TallyCraft.open(nodeDb);
    seed(app);
    const reports = [];
    for (const path of PATHS) {
      const [pathname, query = ""] = path.split("?");
      const params = Object.fromEntries(new URLSearchParams(query));
      switch (pathname) {
        case "/api/statistics":
          reports.push(app.statistics());
          break;
        case "/api/reports/trial-balance":
          reports.push(app.trialBalance({ asOf: undefined }));
          break;
        case "/api/reports/balance-sheet":
          reports.push(app.balanceSheet({ asOf: undefined }));
          break;
        case "/api/reports/profit-loss":
          reports.push(app.profitLoss({}));
          break;
        case "/api/reports/stock-summary":
          reports.push(app.stockSummary({}));
          break;
        case "/api/reports/gst-summary":
          reports.push(app.gstSummary({}));
          break;
        case "/api/reports/outstanding":
          reports.push(app.outstanding({}));
          break;
        case "/api/reports/day-book":
          reports.push(app.dayBook({ date: params.date }));
          break;
        case "/api/ledgers":
          reports.push({ ledgers: app.listLedgers({}) });
          break;
        case "/api/vouchers":
          reports.push({ vouchers: app.listVouchers({ limit: 500 }) });
          break;
        default:
          throw new Error(`unhandled ${pathname}`);
      }
    }
    nodeReports = reports;
    app.close();
  });

  test("every report matches, including inventory valuation and net profit", () => {
    for (const [index, path] of PATHS.entries()) {
      // Compare the serialised contract, not object identity: `-0` and `0`
      // are the same response on the wire, which is what clients see.
      assert.equal(
        JSON.stringify(phpReports[index]),
        JSON.stringify(nodeReports[index]),
        `${path} differs after a PHP seed`,
      );
    }
    const statistics = phpReports[0];
    assert.deepEqual(statistics.counts, { ledgers: 37, vouchers: 35, groups: 28, stockItems: 3 });
    assert.equal(statistics.netProfit, 287_907);
    assert.equal(phpReports[4].totalValue, 349_957);
    assert.equal(phpReports[3].netProfit, 287_907);
  });
});

describe("the production front controller serves the whole app", { skip: !phpAvailable }, () => {
  // Everything above drives the router directly. This suite drives
  // `api-php/public/index.php`, the file a web server actually executes.
  const FRONT_REQUESTS = [
    { method: "GET", path: "/api/company" },
    { method: "GET", path: "/healthz" },
    { method: "GET", path: "/api/export/xml", query: { vouchers: "false", masters: "false" } },
    { method: "GET", path: "/api/nothing" },
    { method: "GET", path: "/app/index.html" },
    { method: "GET", path: "/snapshot.html" },
  ];
  let answers;

  before(async () => {
    const requestsFile = join(directory, "front-requests.json");
    await writeFile(requestsFile, JSON.stringify(FRONT_REQUESTS), "utf8");
    answers = JSON.parse(await harness(["--front", "--requests", requestsFile]));
  });

  test("it answers the API exactly like the router does", () => {
    const company = JSON.parse(answers[0].text);
    assert.equal(company.name, "Surat Weaves Pvt Ltd");
    assert.equal(company.gstin, "24AABCS4321P1Z9");
    assert.equal(answers[1].text.trim(), "ok");
    assert.match(answers[2].text, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<ENVELOPE>/);
    assert.match(answers[2].text, /<\/ENVELOPE>\n$/);
    assert.equal(JSON.parse(answers[3].text).error.code, "NOT_FOUND");
  });

  test("it serves the React shell and the offline snapshot", () => {
    assert.match(answers[4].text, /<div id="root"><\/div>/);
    assert.match(answers[4].text, /\.\/assets\/app\.js/);
    assert.match(answers[5].text, /TallyCraft/);
    assert.ok(answers[5].text.length > 10_000, "the snapshot is a whole document");
  });
});
