/**
 * Build the React client.
 *
 * One esbuild pass, no Vite, no Babel: JSX in, one hashed-free bundle out into
 * `public/react/assets/` plus a stylesheet. The output is committed so the PHP
 * deployment needs nothing but a PHP binary — the same rule the static build
 * follows, and the reason a fresh clone can be served without `npm install`.
 *
 *   node scripts/build-react.mjs          production bundle
 *   node scripts/build-react.mjs --watch  rebuild on change
 */

import { build, context } from "esbuild";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = join(projectRoot, "web");
const outDir = join(projectRoot, "public", "react");

const options = {
  entryPoints: [join(sourceDir, "src", "main.jsx")],
  outfile: join(outDir, "assets", "app.js"),
  bundle: true,
  format: "esm",
  target: ["es2020"],
  jsx: "automatic",
  minify: true,
  sourcemap: false,
  legalComments: "none",
  loader: { ".js": "jsx" },
  define: { "process.env.NODE_ENV": '"production"' },
  banner: {
    js: "/* TallyCraft React client — built by scripts/build-react.mjs. Do not edit by hand. */",
  },
};

async function writeHtml() {
  const template = await readFile(join(sourceDir, "index.html"), "utf8");
  await writeFile(join(outDir, "index.html"), template, "utf8");
}

async function run() {
  await mkdir(join(outDir, "assets"), { recursive: true });
  const watching = process.argv.includes("--watch");
  if (watching) {
    const watcher = await context(options);
    await watcher.watch();
    await writeHtml();
    console.log("watching web/ — serving public/react");
    return;
  }
  await build(options);
  await copyFile(join(sourceDir, "src", "styles.css"), join(outDir, "assets", "app.css"));
  await writeHtml();
  const bundle = await readFile(join(outDir, "assets", "app.js"));
  console.log(`built public/react/assets/app.js (${(bundle.length / 1024).toFixed(1)} kB)`);
}

await run();
