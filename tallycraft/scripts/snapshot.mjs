/**
 * Build a self-contained preview snapshot of TallyCraft.
 *
 * The live app is a server plus a client; the snapshot inlines the API
 * responses the client asks for and swaps `fetch` for a lookup table, so the
 * same `public/app.js` renders a real, auditable book from a single HTML file
 * with no server, no network and no build step.
 *
 * Usage: node scripts/snapshot.mjs [--out public/snapshot.html]
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TallyCraft } from "../src/app.js";
import { GST_RATES, UNITS, VOUCHER_TYPES } from "../src/catalog.js";
import { seed } from "../src/seed.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index].startsWith("--")) {
      flags[argv[index].slice(2)] = argv[index + 1]?.startsWith("--")
        ? true
        : argv[index + 1];
      if (!argv[index + 1]?.startsWith("--")) index += 1;
    }
  }
  return flags;
}

/** Every read-only response the client requests, keyed by pathname. */
export function collectData(app) {
  const company = app.getCompany();
  const end = company.financialYearEnd;
  const today = new Date().toISOString().slice(0, 10);
  const latest = app.listVouchers({ limit: 1 })[0];

  const data = {
    "/api/catalog": {
      groups: app.listGroups(),
      primaryGroups: app
        .listGroups()
        .filter((group) => group.parent === null)
        .map((group) => group.name),
      voucherTypes: VOUCHER_TYPES,
      units: UNITS,
      gstRates: GST_RATES,
    },
    "/api/company": company,
    "/api/statistics": app.statistics(),
    "/api/groups": app.listGroups(),
    "/api/ledgers": { ledgers: app.listLedgers() },
    "/api/vouchers": { vouchers: app.listVouchers({ limit: 300 }) },
    "/api/reports/trial-balance": app.trialBalance({
      asOf: end,
      detailed: true,
    }),
    "/api/reports/balance-sheet": app.balanceSheet({ asOf: end }),
    "/api/reports/profit-loss": app.profitLoss({
      from: company.financialYearStart,
      to: end,
    }),
    "/api/reports/day-book": app.dayBook({ date: latest?.date ?? today }),
    "/api/reports/outstanding": app.outstanding({
      asOf: end,
      type: "receivable",
    }),
    "/api/reports/stock-summary": app.stockSummary({ asOf: end }),
    "/api/reports/gst-summary": app.gstSummary({
      from: company.financialYearStart,
      to: end,
    }),
    "/api/health": {
      ok: true,
      database: "(snapshot)",
      statistics: app.statistics(),
    },
  };

  // Ledger statements for every ledger, so "Statement" works offline.
  for (const ledger of app.listLedgers()) {
    data[`/api/reports/ledger/${ledger.id}`] = app.ledgerReport({
      ledgerId: ledger.id,
      from: company.financialYearStart,
      to: end,
    });
  }

  return data;
}

const CLIENT_SHIM = `
<script>
  // Static data table standing in for the JSON API.
  window.__TALLYCRAFT_SNAPSHOT__ = true;
  const DATA = window.__TALLYCRAFT_DATA__;
  const normalize = (path) => path.replace(/\\/+$/, "");
  const routes = Object.keys(DATA).sort((a, b) => b.length - a.length);
  window.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input.url;
    const { pathname } = new URL(url, location.href);
    const method = (init.method ?? "GET").toUpperCase();
    if (method !== "GET" && method !== "HEAD") {
      return {
        ok: false,
        status: 501,
        statusText: "Snapshot is read-only",
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({
          error: {
            code: "SNAPSHOT_READ_ONLY",
            message: "This is a static snapshot. Run the server to post vouchers.",
          },
        }),
        text: async () => "",
      };
    }
    let key = routes.find((route) => normalize(pathname) === route || normalize(pathname).startsWith(route + "/"));
    if (key === undefined && normalize(pathname) === "/api/reports/ledger") {
      // The client asks for a ledger by query string; the table is keyed by id.
      const id = new URL(url, location.href).searchParams.get("ledgerId");
      const candidate = "/api/reports/ledger/" + id;
      if (DATA[candidate] !== undefined) key = candidate;
    }
    if (key === undefined && normalize(pathname) === "/api/vouchers/next") {
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ number: "SNAP-0001" }),
        text: async () => '{"number":"SNAP-0001"}',
      };
    }
    const body = key === undefined ? { error: { code: "NOT_FOUND", message: pathname } } : DATA[key];
    return {
      ok: key !== undefined,
      status: key === undefined ? 404 : 200,
      statusText: key === undefined ? "Not Found" : "OK",
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  };
</script>
`;

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const out = resolve(projectRoot, flags.out ?? "public/snapshot.html");

  const app = TallyCraft.open(":memory:");
  seed(app);
  const data = collectData(app);
  const company = app.getCompany();
  const statistics = app.statistics();

  const [html, css, js] = await Promise.all([
    readFile(join(projectRoot, "public", "index.html"), "utf8"),
    readFile(join(projectRoot, "public", "styles.css"), "utf8"),
    readFile(join(projectRoot, "public", "app.js"), "utf8"),
  ]);

  const banner = `
    <div id="snapshot-banner" style="background:#0b2a49;color:#f2b705;font:600 12px/1.4 system-ui,sans-serif;padding:6px 22px;letter-spacing:.3px">
      STATIC SNAPSHOT · ${company.name} · ${statistics.counts.ledgers} ledgers · ${statistics.counts.vouchers} vouchers · read-only
      — run <code>npm start</code> for the live app
    </div>`;

  const page = html
    .replace(
      '<link rel="stylesheet" href="/styles.css" />',
      `<style>${css}</style>`,
    )
    // A single file has no server, so the manifest, icons and worker would
    // only produce failed requests.
    .replace(/^\s*<link rel="(manifest|icon|apple-touch-icon)"[^>]*\/>$/gm, "")
    .replace(
      "<body>",
      `<body>${banner}<script>window.__TALLYCRAFT_DATA__ = ${JSON.stringify(data).replaceAll("</", "<\\/")};</script>${CLIENT_SHIM}`,
    )
    .replace(
      '<script type="module" src="/app.js"></script>',
      `<script type="module">${js.replaceAll("</script>", "<\\/script>")}</script>`,
    );

  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, page, "utf8");
  app.close();

  const megabytes = (Buffer.byteLength(page) / 1024).toFixed(0);
  console.log(
    `Wrote ${out} (${megabytes} KB, ${Object.keys(data).length} inlined responses)`,
  );
  console.log(
    `Book: ${company.name} · ${statistics.counts.ledgers} ledgers · ${statistics.counts.vouchers} vouchers · net profit ${statistics.netProfit}`,
  );
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
