/**
 * Static web app contract.
 *
 * The static build is what survives a sandbox recycle, a closed laptop or a
 * dead preview proxy, so it must be complete on its own: every read inlined,
 * no root-absolute path (it has to work at `/` and at `/rea/`), installable,
 * and honest about being read-only.
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { buildStatic } from "../scripts/build-static.mjs";

let outDir;
let html;
let manifest;

before(async () => {
  outDir = join(await mkdtemp(join(tmpdir(), "tallycraft-static-")), "site");
  await buildStatic({ outDir });
  html = await readFile(join(outDir, "index.html"), "utf8");
  manifest = JSON.parse(
    await readFile(join(outDir, "manifest.webmanifest"), "utf8"),
  );
});

after(async () => rm(outDir, { recursive: true, force: true }));

test("the build produces a self-contained site", async () => {
  const files = await readdir(outDir);
  for (const required of [
    "index.html",
    "404.html",
    "manifest.webmanifest",
    "sw.js",
    "favicon.ico",
    ".nojekyll",
  ]) {
    assert.ok(files.includes(required), `${required} is missing`);
  }
  assert.ok(existsSync(join(outDir, "icons", "icon-192.png")));
  assert.ok(existsSync(join(outDir, "icons", "icon-512.png")));
});

test("every asset reference is relative, so a subpath host works", () => {
  const absolute = html.match(/(?:href|src)="\/[^"]*"/g) ?? [];
  assert.deepEqual(absolute, [], "no root-absolute references may remain");
  assert.match(html, /href="manifest\.webmanifest"/);
  assert.match(html, /href="icons\/icon\.svg"/);
  assert.match(
    html,
    /href="apple-touch-icon\.png"|href="icons\/apple-touch-icon\.png"/,
  );
  // The stylesheet and client are inlined, not fetched.
  assert.match(html, /<style>/);
  assert.doesNotMatch(html, /<link rel="stylesheet" href="\/styles\.css"/);
  assert.doesNotMatch(html, /<script type="module" src="\/app\.js"><\/script>/);
});

test("all reads the client makes are inlined", () => {
  const payload =
    /window\.__TALLYCRAFT_DATA__ = (\{[\s\S]*?\});<\/script>/.exec(html);
  assert.ok(payload, "data payload missing");
  const data = JSON.parse(payload[1].replaceAll("<\\/", "</"));

  for (const route of [
    "/api/catalog",
    "/api/company",
    "/api/statistics",
    "/api/ledgers",
    "/api/vouchers",
    "/api/reports/trial-balance",
    "/api/reports/balance-sheet",
    "/api/reports/profit-loss",
    "/api/reports/day-book",
    "/api/reports/outstanding",
    "/api/reports/stock-summary",
    "/api/reports/gst-summary",
  ]) {
    assert.ok(data[route] !== undefined, `${route} is not inlined`);
  }

  const ledgers = data["/api/ledgers"].ledgers;
  for (const ledger of ledgers) {
    assert.ok(
      data[`/api/reports/ledger/${ledger.id}`] !== undefined,
      `statement for ${ledger.name} is missing`,
    );
  }
  assert.equal(data["/api/company"].name, "Surat Weaves Pvt Ltd");
});

test("the static build is installable and works offline", () => {
  assert.equal(manifest.start_url, "./");
  assert.equal(manifest.scope, "./");
  assert.equal(manifest.display, "standalone");
  assert.ok(manifest.icons.every((icon) => !icon.src.startsWith("/")));
  assert.ok(manifest.icons.some((icon) => icon.purpose === "maskable"));

  assert.match(html, /__TALLYCRAFT_STATIC_HOSTED__ = true/);
});

test("the worker resolves its shell against its own scope", async () => {
  const worker = await readFile(join(outDir, "sw.js"), "utf8");
  assert.match(
    worker,
    /self\.registration\.scope/,
    "paths must be scope-relative",
  );
  assert.doesNotMatch(
    worker,
    /"\/(app\.js|styles\.css|index\.html)"/,
    "root paths break subpaths",
  );
  assert.match(worker, /"index\.html"/);
  assert.equal(worker, await readFile(join(outDir, "sw.js"), "utf8"));
});

test("the shim refuses writes instead of pretending they worked", () => {
  assert.match(html, /SNAPSHOT_READ_ONLY/);
  assert.match(html, /status: 501/);
  assert.match(html, /read-only/);
});
