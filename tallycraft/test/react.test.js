/**
 * The React client, rendered for real.
 *
 * The bundle in `public/react/assets/app.js` is the artefact that ships, so
 * this test loads that file — not the sources — into jsdom, points it at a
 * running PHP bridge, and asserts each screen paints the numbers the backend
 * returns. It catches the failures a build cannot: a bad hook, a missing
 * import, a report that reads a field the API does not have.
 *
 * Requires `npm run build:react` to have run; skips with a message if the
 * bundle or jsdom is absent.
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { after, before, describe, test } from "node:test";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bundlePath = join(projectRoot, "public", "react", "assets", "app.js");

let available = true;
let skipReason = "";
try {
  await access(bundlePath);
} catch {
  available = false;
  skipReason = "public/react/assets/app.js missing — run `npm run build:react`";
}
try {
  await import("jsdom");
} catch {
  available = false;
  skipReason ||= "jsdom is not installed";
}

function freePort() {
  return new Promise((done, fail) => {
    const probe = createServer();
    probe.once("error", fail);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => done(port));
    });
  });
}

async function waitForHealth(url, timeoutMs = 120_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(`${url}/healthz`);
      if (response.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((done) => setTimeout(done, 250));
  }
  throw new Error(`PHP bridge did not answer on ${url}`);
}

/** Poll the document until `predicate` is satisfied, or fail loudly. */
async function waitFor(predicate, message, timeoutMs = 20_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return;
    await new Promise((done) => setTimeout(done, 50));
  }
  const text = globalThis.document.body.textContent.replace(/\s+/g, " ").slice(0, 600);
  throw new Error(`${message}\nrendered: ${text}`);
}

describe("the React client renders against the PHP backend", { skip: !available, concurrency: 1 }, () => {
  let server;
  let base;
  let dom;

  before(async () => {
    const port = await freePort();
    base = `http://127.0.0.1:${port}`;
    server = spawn(process.execPath, ["scripts/serve-php.mjs", "--port", String(port)], {
      cwd: projectRoot,
      env: { ...process.env, NODE_NO_WARNINGS: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    server.stderr.on("data", (chunk) => {
      const text = String(chunk);
      if (text.includes("Error")) process.stderr.write(text);
    });
    await waitForHealth(base);

    const { JSDOM } = await import("jsdom");
    dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", {
      url: `${base}/app/`,
      pretendToBeVisual: true,
    });

    const { window } = dom;
    globalThis.window = window;
    globalThis.document = window.document;
    // Node ships read-only `navigator` and `location` getters, so use
    // defineProperty instead of assignment.
    for (const [key, value] of [
      ["navigator", window.navigator],
      ["location", window.location],
      ["HTMLElement", window.HTMLElement],
      ["Node", window.Node],
      ["Event", window.Event],
      ["getComputedStyle", window.getComputedStyle.bind(window)],
    ]) {
      Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
    }
    globalThis.addEventListener = window.addEventListener.bind(window);
    globalThis.removeEventListener = window.removeEventListener.bind(window);
    globalThis.TALLYCRAFT_BASE = base;
    globalThis.IS_REACT_ACT_ENVIRONMENT = false;

    await import(pathToFileURL(bundlePath).href);
    await waitFor(
      () => window.document.body.textContent.includes("Cash in hand"),
      "the gateway never loaded the numbers",
    );
  });

  after(() => {
    server?.kill("SIGTERM");
  });

  const bodyText = () => globalThis.document.body.textContent.replace(/\s+/g, " ");

  async function go(hash, expected) {
    globalThis.location.hash = hash;
    await waitFor(() => bodyText().includes(expected), `${hash} did not render "${expected}"`);
  }

  test("gateway shows the company, the money and the voucher keys", () => {
    const text = bodyText();
    assert.match(text, /Surat Weaves Pvt Ltd/);
    assert.match(text, /Cash in hand/);
    assert.match(text, /Trial balance agrees/);
    assert.match(text, /F8/);
    assert.match(text, /2,87,907|287,907|2,87,907\.00/);
  });

  test("ledgers list loads masters and can filter", async () => {
    await go("#/ledgers", "Ravi Textiles");
    assert.match(bodyText(), /Sundry Debtors/);
    assert.match(bodyText(), /New ledger/);
  });

  test("day book shows a posted date", async () => {
    await go("#/day-book?date=2026-04-03", "SAL-0001");
    assert.match(bodyText(), /Day book/);
    assert.match(bodyText(), /1,93,200/);
  });

  test("trial balance balances", async () => {
    await go("#/report/trial-balance", "Balanced");
    assert.match(bodyText(), /52,93,580/);
  });

  test("balance sheet shows both sides and the closing stock", async () => {
    await go("#/report/balance-sheet", "Assets equal liabilities");
    assert.match(bodyText(), /Capital Account/);
    assert.match(bodyText(), /Closing stock/);
    assert.match(bodyText(), /3,49,957/);
  });

  test("profit and loss reports the net profit", async () => {
    await go("#/report/profit-loss", "Profit & loss account");
    assert.match(bodyText(), /2,87,907/);
    assert.match(bodyText(), /Gross profit/);
  });

  test("outstanding ages the debtors", async () => {
    await go("#/report/outstanding", "Outstanding receivables");
    assert.match(bodyText(), /Ravi Textiles/);
    assert.match(bodyText(), /Over 180 days/);
  });

  test("GST summary nets output against input", async () => {
    await go("#/report/gst-summary", "Output tax");
    assert.match(bodyText(), /Output tax/);
    assert.match(bodyText(), /10,620/);
  });

  test("stock summary values the closing quantity", async () => {
    await go("#/report/stock-summary", "Cotton Fabric 44in");
    assert.match(bodyText(), /Cotton Fabric 44in/);
    assert.match(bodyText(), /3,49,957/);
  });

  test("voucher entry opens on the shortcut's type with an auto number", async () => {
    await go("#/voucher/new?type=SALES", "Post voucher");
    assert.match(bodyText(), /Sales voucher/);
    // The voucher number lives in an input, so read the field, not the text.
    await waitFor(
      () => globalThis.document.querySelector("input.mono")?.value === "SAL-0009",
      "the next voucher number never arrived",
    );
  });

  test("a voucher opens read-only with its double entry", async () => {
    await go("#/voucher/1", "SAL-0001");
    assert.match(bodyText(), /Double entry/);
    assert.match(bodyText(), /Ravi Textiles/);
  });

  test("an unknown screen explains itself", async () => {
    await go("#/nope", "No such screen");
  });
});
