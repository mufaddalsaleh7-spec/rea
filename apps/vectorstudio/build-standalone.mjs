#!/usr/bin/env node
/**
 * Build a single self-contained HTML file for VectorStudio.
 *
 *   cd apps/vectorstudio && node build-standalone.mjs
 *
 * The app itself has no dependencies; this build step only needs esbuild,
 * fetched once with `npx esbuild`. The output, `vectorstudio.html`, inlines the
 * stylesheet and every ES module, so it opens by double-click from disk
 * (file://), works offline, and can be published as one static file anywhere.
 */

import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const outFile = join(root, "vectorstudio.html");

const scratch = await mkdtemp(join(tmpdir(), "vectorstudio-build-"));
const bundlePath = join(scratch, "app.js");

const esbuild = spawnSync(
  process.platform === "win32" ? "npx.cmd" : "npx",
  [
    "--yes",
    "esbuild",
    join(root, "js/main.js"),
    "--bundle",
    "--format=iife",
    "--target=es2020",
    "--charset=utf8",
    `--outfile=${bundlePath}`,
  ],
  { encoding: "utf8", stdio: "inherit" },
);
if (esbuild.status !== 0) {
  await rm(scratch, { recursive: true, force: true });
  throw new Error("esbuild failed — run `npx esbuild` once to install it");
}

const [html, css, js] = await Promise.all([
  readFile(join(root, "index.html"), "utf8"),
  readFile(join(root, "css/app.css"), "utf8"),
  readFile(bundlePath, "utf8"),
]);
await rm(scratch, { recursive: true, force: true });

const guard = (text) => text.replace(/<\/script>/gi, "<\\/script>");

const standalone = html
  .replace(
    '<link rel="stylesheet" href="css/app.css" />',
    () => `<style>\n${css}\n</style>`,
  )
  .replace(
    '<script type="module" src="js/main.js"></script>',
    () => `<script>\n${guard(js)}\n</script>`,
  );

if (standalone.includes('href="css/app.css"') || standalone.includes('src="js/main.js"')) {
  throw new Error("index.html no longer matches the inlining rules");
}

await writeFile(outFile, standalone);
const kb = (standalone.length / 1024).toFixed(0);
console.log(`wrote ${outFile} (${kb} kB, self-contained)`);
