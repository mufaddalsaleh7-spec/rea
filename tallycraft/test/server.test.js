import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { TallyCraft } from "../src/app.js";
import { seed } from "../src/seed.js";
import { createAppServer } from "../src/server.js";
import { instanceInfo } from "../src/instance.js";

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
  const startedAt = new Date();
  server = createAppServer({
    dbPath,
    publicDir,
    app,
    logRequests: false,
    // Same wiring the CLI uses: identity is resolved per request from the live
    // port, so the advertised URL always matches where the socket listens.
    instance: () =>
      instanceInfo({
        port: server.address()?.port ?? 0,
        sandboxId: undefined,
        startedAt,
        dbPath,
      }),
  });
  await new Promise((ready) => server.listen(0, "127.0.0.1", ready));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((done) => server.close(done));
  await rm(directory, { recursive: true, force: true });
});

test("the instance endpoint publishes where this server lives", async () => {
  const instance = await fetch(`${base}/api/instance`).then((response) =>
    response.json(),
  );
  assert.equal(instance.service, "tallycraft");
  assert.equal(instance.status, "ok");
  assert.equal(instance.previewUrl, null, "no sandbox id in tests");
  assert.ok(instance.port > 0);
  assert.ok(instance.startedAt);
  assert.equal(typeof instance.uptimeSeconds, "number");
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

test("the shell carries first-paint boot data", async () => {
  const response = await fetch(`${base}/`);
  const html = await response.text();
  assert.match(html, /id="tallycraft-boot"/);
  const match =
    /<script id="tallycraft-boot" type="application\/json">([\s\S]*?)<\/script>/.exec(
      html,
    );
  assert.ok(match, "boot script missing");
  const payload = JSON.parse(match[1].replaceAll("<\\/", "</"));
  assert.equal(payload["/api/company"].name, "Surat Weaves Pvt Ltd");
  assert.ok(payload["/api/catalog"].voucherTypes.length >= 8);
  assert.ok(payload["/api/statistics"].counts.vouchers > 0);
  assert.equal(payload["/api/vouchers?limit=7"].vouchers.length, 7);
});

test("boot data matches what the live API returns", async () => {
  const html = await fetch(`${base}/`).then((response) => response.text());
  const match =
    /<script id="tallycraft-boot" type="application\/json">([\s\S]*?)<\/script>/.exec(
      html,
    );
  const payload = JSON.parse(match[1].replaceAll("<\\/", "</"));

  const company = await fetch(`${base}/api/company`).then((response) =>
    response.json(),
  );
  assert.deepEqual(payload["/api/company"], company);

  const ledgers = await fetch(`${base}/api/ledgers`).then((response) =>
    response.json(),
  );
  assert.equal(payload["/api/ledgers"].ledgers.length, ledgers.ledgers.length);

  const statistics = await fetch(`${base}/api/statistics`).then((response) =>
    response.json(),
  );
  assert.equal(
    payload["/api/statistics"].counts.ledgers,
    statistics.counts.ledgers,
  );
  assert.equal(payload["/api/statistics"].netProfit, statistics.netProfit);
});

test("listenAll binds the primary port and skips aliases that are taken", async () => {
  const { createAppServer } = await import("../src/server.js");
  const extra = createAppServer({ publicDir, app: null, instance: () => ({}) });
  await new Promise((done) => extra.listen(0, "127.0.0.1", done));
  const takenPort = extra.address().port;

  const probe = createAppServer({ publicDir, app: null, instance: () => ({}) });
  await new Promise((done) => probe.listen(0, "127.0.0.1", done));
  const freePort = probe.address().port;
  await new Promise((done) => probe.close(done));

  const primary = createAppServer({
    publicDir,
    app: null,
    instance: () => ({}),
  });
  const bound = await primary.listenAll(0, "127.0.0.1", [takenPort, freePort]);
  assert.ok(bound.port > 0);
  assert.deepEqual(bound.aliases, [freePort], "the free alias should bind");
  assert.deepEqual(
    bound.skipped,
    [takenPort],
    "the taken port should be skipped",
  );

  primary.closeAllConnections();
  extra.closeAllConnections();
  await new Promise((done) => primary.close(done));
  await new Promise((done) => extra.close(done));
});

test("an alias port reports itself in /api/instance", async () => {
  const probe = createAppServer({ publicDir, app: null, instance: () => ({}) });
  await new Promise((done) => probe.listen(0, "127.0.0.1", done));
  const aliasPort = probe.address().port;
  await new Promise((done) => probe.close(done));

  const serverInstance = createAppServer({
    publicDir,
    app: null,
    instance: () => ({
      port: 3000,
      sandboxId: "sandbox123",
      previewUrl: "https://3000-sandbox123.e2b.app",
    }),
  });
  const bound = await serverInstance.listenAll(0, "127.0.0.1", [aliasPort]);
  assert.deepEqual(bound.aliases, [aliasPort]);

  const aliasInfo = await fetch(
    `http://127.0.0.1:${aliasPort}/api/instance`,
  ).then((response) => response.json());
  assert.equal(aliasInfo.port, aliasPort);
  assert.equal(
    aliasInfo.aliasOf,
    3000,
    "the alias names the configured identity",
  );
  assert.equal(aliasInfo.previewUrl, `https://${aliasPort}-sandbox123.e2b.app`);

  const primaryInfo = await fetch(
    `http://127.0.0.1:${bound.port}/api/instance`,
  ).then((response) => response.json());
  assert.equal(
    primaryInfo.port,
    3000,
    "the primary keeps its configured identity",
  );
  assert.equal(primaryInfo.aliasOf, undefined);

  serverInstance.closeAllConnections();
  for (const alias of serverInstance.extraServers) alias.closeAllConnections();
  await new Promise((done) => serverInstance.close(done));
});

/* ------------------------------------------------------------------- web app */

test("the shell advertises an installable manifest", async () => {
  const html = await fetch(`${base}/`).then((response) => response.text());
  assert.match(html, /<link rel="manifest" href="\/manifest\.webmanifest"/);
  assert.match(html, /<meta name="theme-color" content="#0f4c81"/);
  assert.match(
    html,
    /<link rel="apple-touch-icon" href="\/icons\/apple-touch-icon\.png"/,
  );
  assert.match(html, /id="install-app"/);
});

test("the manifest is valid and its icons exist", async () => {
  const response = await fetch(`${base}/manifest.webmanifest`);
  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get("content-type"),
    "application/manifest+json; charset=utf-8",
  );
  const manifest = await response.json();

  assert.equal(manifest.name, "TallyCraft — Accounting Workspace");
  assert.equal(manifest.short_name, "TallyCraft");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.scope, "/");
  assert.ok(manifest.icons.length >= 3);
  assert.ok(
    manifest.icons.some((icon) => icon.purpose === "maskable"),
    "an installable icon needs a maskable variant",
  );

  for (const icon of manifest.icons) {
    const asset = await fetch(`${base}${icon.src}`);
    assert.equal(asset.status, 200, `${icon.src} is missing`);
    assert.equal(
      asset.headers.get("content-type"),
      icon.type === "image/svg+xml" ? "image/svg+xml" : "image/png",
    );
    const bytes = Buffer.from(await asset.arrayBuffer());
    assert.ok(bytes.length > 200, `${icon.src} looks empty`);
  }

  for (const shortcut of manifest.shortcuts) {
    assert.match(shortcut.url, /^\/#\//, "shortcuts must deep-link the router");
  }
});

test("the service worker is served from the root with a root scope", async () => {
  const response = await fetch(`${base}/sw.js`);
  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get("content-type"),
    "text/javascript; charset=utf-8",
  );
  assert.equal(response.headers.get("service-worker-allowed"), "/");
  const source = await response.text();
  assert.match(source, /addEventListener\("install"/);
  assert.match(source, /addEventListener\("fetch"/);
});

test("every file the worker precaches is actually served", async () => {
  const source = await fetch(`${base}/sw.js`).then((response) =>
    response.text(),
  );
  const block = /const SHELL = \[([\s\S]*?)\];/.exec(source);
  assert.ok(block, "SHELL list not found");
  const paths = [...block[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  assert.ok(paths.includes("/"), "the shell must include /");
  assert.ok(paths.includes("/app.js"));

  for (const path of paths) {
    const response = await fetch(`${base}${path}`);
    assert.equal(response.status, 200, `precached path ${path} is missing`);
  }
});
