/**
 * Run the PHP backend under php-wasm.
 *
 * The sandbox has no PHP binary and the Debian mirrors are unreachable, so the
 * PHP build is executed with `php-wasm` — the real PHP 8.3, compiled to
 * WebAssembly. This module is the bridge: it copies the PHP project into the
 * WASM filesystem and runs `api-php/tests/runner.php`, which drives the actual
 * router. It is a development and test tool; production runs `php -S` (or FPM)
 * against `api-php/public/index.php` and never touches this file.
 *
 * Two entry points:
 *   openPhpSession()  long-lived session for the preview server
 *   runPhpBackend()   one-shot run for the parity test and the CLI
 *
 * CLI:
 *   node scripts/php-harness.mjs --db data/parity.db --requests /tmp/req.json
 */

import { readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const phpRoot = join(projectRoot, "api-php");
const BASE = "/tallycraft";

function parseFlags(argv) {
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

/** Every file the PHP app needs inside the WASM filesystem. */
async function collectProject(directory = phpRoot) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      files.push(...(await collectProject(full)));
    } else if (entry.name !== "harness.json" && !entry.name.endsWith(".db")) {
      files.push(full);
    }
  }
  return files;
}

/**
 * A PHP process with the app on disk.
 *
 * php-wasm has no argv and no host mount, so the project is written into its
 * virtual filesystem once and a descriptor file tells `runner.php` where the
 * database and the request list live.
 */
export async function openPhpSession({ dbPath = null, seed = false, includeWeb = false } = {}) {
  const { loadNodeRuntime } = await import("@php-wasm/node");
  const { PHP } = await import("@php-wasm/universal");

  const runtime = await loadNodeRuntime("8.3", { emscriptenOptions: { processId: 1 } });
  const php = new PHP(runtime);

  for (const file of await collectProject()) {
    const target = `${BASE}/${relative(phpRoot, file).split("\\").join("/")}`;
    php.mkdirTree(target.slice(0, target.lastIndexOf("/")));
    php.writeFile(target, await readFile(file));
  }
  php.mkdirTree(`${BASE}/data`);
  php.mkdirTree("/tmp");

  if (includeWeb) {
    // The front controller serves the client itself; give it the same sibling
    // `public/` directory the container mounts at /app/public.
    for (const file of await collectProject(join(projectRoot, "public"))) {
      const target = `/public/${relative(join(projectRoot, "public"), file).split("\\").join("/")}`;
      php.mkdirTree(target.slice(0, target.lastIndexOf("/")));
      php.writeFile(target, await readFile(file));
    }
  }

  const database = `${BASE}/data/${dbPath === null ? "tallycraft.db" : "parity.db"}`;
  if (dbPath !== null) {
    php.writeFile(database, await readFile(dbPath));
  }
  php.writeFile(
    `${BASE}/data/harness.json`,
    JSON.stringify({ db: database, requests: "/tmp/requests.json" }),
  );

  let queue = Promise.resolve();

  /** Run a list of `{method, path, query, body}` and return the answers. */
  const run = (requests) => {
    queue = queue.then(async () => {
      php.writeFile("/tmp/requests.json", JSON.stringify(requests));
      const out = await php.run({ scriptPath: `${BASE}/tests/runner.php` });
      if (out.exitCode !== 0) {
        throw new Error(`PHP exited ${out.exitCode}: ${String(out.errors ?? "").slice(0, 800)}`);
      }
      const text = out.text.trim();
      const start = text.indexOf("[");
      if (start === -1) {
        throw new Error(`PHP produced no JSON. stderr: ${String(out.errors ?? "").slice(0, 800)}`);
      }
      return JSON.parse(text.slice(start));
    });
    return queue;
  };

  /**
   * Run one request through the real front controller (`public/index.php`).
   * Used to prove the production entry point serves the API, the envelope and
   * the static client — not just the router the parity tests call directly.
   */
  const runFront = (request) => {
    queue = queue.then(async () => {
      php.writeFile("/tmp/front.json", JSON.stringify(request));
      const out = await php.run({ scriptPath: `${BASE}/tests/front.php` });
      return {
        text: out.text ?? "",
        bytes: Buffer.byteLength(out.text ?? "", "utf8"),
        exitCode: out.exitCode,
        errors: out.errors ?? "",
      };
    });
    return queue;
  };

  if (seed) {
    // Seed through the real API, so the demo book is produced by the same code
    // path a user would take (`POST /api/demo/reset`).
    await run([{ method: "POST", path: "/api/demo/reset" }]);
  }

  return { run, runFront, database, php };
}

/** One-shot: run the requests against a copy of `dbPath`, or a fresh seeded book. */
export async function runPhpBackend({ dbPath = null, requests, seed = false }) {
  const session = await openPhpSession(dbPath === null ? { seed } : { dbPath, seed });
  return session.run(requests);
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const dbPath = resolve(projectRoot, String(flags.db ?? "data/parity.db"));
  const requests = flags.requests
    ? JSON.parse(await readFile(resolve(projectRoot, String(flags.requests)), "utf8"))
    : [{ method: "GET", path: "/api/company" }];

  if (flags.front === true) {
    // `--front` drives public/index.php once per request in the list.
    const session = await openPhpSession({ seed: true, includeWeb: true });
    const answers = [];
    for (const request of requests) {
      const answer = await session.runFront({
        uri: `${request.path ?? "/"}${request.query ? `?${new URLSearchParams(request.query)}` : ""}`,
        method: request.method ?? "GET",
        query: request.query ?? {},
      });
      answers.push({ text: answer.text, exitCode: answer.exitCode });
    }
    process.stdout.write(`${JSON.stringify(answers)}\n`);
    process.exit(0);
  }

  // `--fresh` seeds a brand-new book inside the WASM filesystem: the only way
  // to prove the PHP seeder agrees with the Node one.
  const responses = await runPhpBackend({
    dbPath: flags.fresh === true ? null : dbPath,
    requests,
    seed: flags.fresh === true || flags.seed === true,
  });
  if (flags.out) {
    await writeFile(resolve(projectRoot, String(flags.out)), JSON.stringify(responses, null, 2));
  } else {
    process.stdout.write(`${JSON.stringify(responses)}\n`);
  }
  // php-wasm keeps the event loop alive; the answer is already flushed.
  process.exit(0);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
