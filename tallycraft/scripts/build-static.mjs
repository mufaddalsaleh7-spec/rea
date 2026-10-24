/**
 * Build the static web app: total TallyCraft, no server process.
 *
 * The Node server is the full product — it can post vouchers. This build is
 * the same client with every read inlined, so the whole application (all
 * screens, all reports, every ledger statement) opens from a plain file host:
 * GitHub Pages, S3, nginx, a USB stick. Nothing to install, no API to reach.
 *
 * It is read-only by design: a static host cannot accept a post, and pretending
 * otherwise would corrupt a real book. The banner says so, and the shim returns
 * an explicit SNAPSHOT_READ_ONLY error if the client tries.
 *
 * Paths are relative everywhere, so the same output works at `/` (a domain
 * root) and at `/rea/` (a GitHub project site) without a rebuild.
 *
 * Usage: node scripts/build-static.mjs [--out dist]
 */

import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TallyCraft } from "../src/app.js";
import { seed } from "../src/seed.js";
import { CLIENT_SHIM, collectData } from "./snapshot.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = join(projectRoot, "public");

function parseArgs(argv) {
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith("--")) continue;
    const key = argv[index].slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) flags[key] = true;
    else {
      flags[key] = next;
      index += 1;
    }
  }
  return flags;
}

/** The installable-app metadata, rewritten for a subdirectory host. */
function manifestFor(company) {
  return {
    id: "./",
    name: `TallyCraft — ${company.name}`,
    short_name: "TallyCraft",
    description:
      "Keyboard-first double-entry accounting: vouchers, ledgers, trial balance, balance sheet, P&L, inventory and Tally XML interchange.",
    start_url: "./",
    scope: "./",
    display: "standalone",
    orientation: "any",
    theme_color: "#0f4c81",
    background_color: "#0b2f52",
    lang: "en-IN",
    dir: "ltr",
    categories: ["business", "finance", "productivity"],
    icons: [
      {
        src: "icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "icons/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}

/** Point absolute links at the sibling files, so a subpath host works. */
function relativise(html) {
  return html
    .replace('href="/manifest.webmanifest"', 'href="manifest.webmanifest"')
    .replace('href="/favicon.ico"', 'href="favicon.ico"')
    .replace('href="/icons/icon.svg"', 'href="icons/icon.svg"')
    .replace(
      'href="/icons/apple-touch-icon.png"',
      'href="icons/apple-touch-icon.png"',
    );
}

export async function buildStatic({ outDir, seedData = true } = {}) {
  const app = TallyCraft.open(":memory:");
  try {
    if (seedData) seed(app);
    const data = collectData(app);
    const company = app.getCompany();
    const statistics = app.statistics();

    const [html, css, js] = await Promise.all([
      readFile(join(publicDir, "index.html"), "utf8"),
      readFile(join(publicDir, "styles.css"), "utf8"),
      readFile(join(publicDir, "app.js"), "utf8"),
    ]);

    const banner = `
    <div id="static-banner" style="background:#0b2a49;color:#f2b705;font:600 12px/1.4 system-ui,sans-serif;padding:6px 22px;letter-spacing:.3px">
      STATIC WEB APP · ${company.name} · ${statistics.counts.ledgers} ledgers · ${statistics.counts.vouchers} vouchers · read-only
      — postings need the server build (<code>npm start</code>)
    </div>`;

    const page = relativise(html)
      .replace(
        '<link rel="stylesheet" href="/styles.css" />',
        `<style>${css}</style>`,
      )
      .replace(
        "<body>",
        `<body>${banner}<script>window.__TALLYCRAFT_STATIC_HOSTED__ = true;window.__TALLYCRAFT_DATA__ = ${JSON.stringify(
          data,
        ).replaceAll("</", "<\\/")};</script>${CLIENT_SHIM}`,
      )
      .replace(
        '<script type="module" src="/app.js"></script>',
        `<script type="module">${js.replaceAll("</script>", "<\\/script>")}</script>`,
      );

    await rm(outDir, { recursive: true, force: true });
    await mkdir(join(outDir, "icons"), { recursive: true });

    await writeFile(join(outDir, "index.html"), page, "utf8");
    // Deep links (a typed /report/… path) land on the same shell.
    await writeFile(join(outDir, "404.html"), page, "utf8");
    await writeFile(
      join(outDir, "manifest.webmanifest"),
      `${JSON.stringify(manifestFor(company), null, 2)}\n`,
      "utf8",
    );
    await copyFile(join(publicDir, "sw.js"), join(outDir, "sw.js"));
    await copyFile(join(publicDir, "favicon.ico"), join(outDir, "favicon.ico"));
    for (const icon of await readdir(join(publicDir, "icons"))) {
      await copyFile(
        join(publicDir, "icons", icon),
        join(outDir, "icons", icon),
      );
    }
    // GitHub Pages runs Jekyll by default, which drops files it dislikes.
    await writeFile(join(outDir, ".nojekyll"), "", "utf8");

    return {
      outDir,
      bytes: Buffer.byteLength(page),
      responses: Object.keys(data).length,
      counts: statistics.counts,
      company: company.name,
      netProfit: statistics.netProfit,
    };
  } finally {
    app.close();
  }
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  // Served by the Node server at /static/ and committable as a standalone site.
  const outDir = resolve(projectRoot, String(flags.out ?? "public/static"));
  const result = await buildStatic({ outDir });
  console.log(
    `Wrote ${result.outDir} (${(result.bytes / 1024).toFixed(0)} KB shell, ${result.responses} inlined responses)`,
  );
  console.log(
    `Book: ${result.company} · ${result.counts.ledgers} ledgers · ${result.counts.vouchers} vouchers · net profit ${result.netProfit}`,
  );
  console.log("Serve it from any static host, at the root or a subpath.");
  console.log(`Also served by the app itself at /static/`);
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
