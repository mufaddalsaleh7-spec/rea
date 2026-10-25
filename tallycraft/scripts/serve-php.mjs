/**
 * Preview server: PHP backend, React client, one port.
 *
 * On a normal host the PHP build is served by PHP itself:
 *
 *   php -S 0.0.0.0:8080 -t api-php/public      # API + /app/ + legacy client
 *
 * This sandbox has no PHP binary, so this script runs the same PHP code through
 * php-wasm and proxies HTTP to it. It exists for the live preview and for
 * parity debugging only; it is not needed in production.
 *
 *   node scripts/serve-php.mjs --port 8080
 *
 * Routes:
 *   /api/*, /healthz   → PHP router (php-wasm)
 *   /, /app, /app/*    → public/react (the React build)
 *   everything else    → public/ (icons, manifest, the legacy client)
 */

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { openPhpSession } from "./php-harness.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = join(projectRoot, "public");
const reactDir = join(publicDir, "react");

const flags = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  flags.set(process.argv[index]?.replace(/^--/, ""), process.argv[index + 1]);
}

const port = Number(flags.get("port") ?? process.env.PORT ?? 8080);
const aliases = (process.env.TALLYCRAFT_ALIASES ?? "")
  .split(",")
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isInteger(value) && value > 0 && value !== port);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

console.log("booting PHP 8.3 (php-wasm)…");
const php = await openPhpSession({ seed: true });
console.log(`PHP ready · database ${php.database}`);

function send(response, status, body, headers = {}) {
  response.writeHead(status, {
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    ...headers,
  });
  response.end(body);
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 12 * 1024 * 1024) throw new Error("body too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function serveFile(response, file) {
  try {
    const info = await stat(file);
    if (!info.isFile()) return false;
    const body = await readFile(file);
    send(response, 200, body, {
      "content-type": TYPES[extname(file)] ?? "application/octet-stream",
      "cache-control": file.endsWith(".html") ? "no-store" : "public, max-age=60",
    });
    return true;
  } catch {
    return false;
  }
}

/** Keep a request inside the directory it asked for. */
function safeJoin(root, relative) {
  const target = resolve(root, `.${normalize(`/${relative}`)}`);
  return target.startsWith(root) ? target : null;
}

async function handler(request, response) {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  const path = url.pathname;

  if (path === "/api/instance") {
    send(
      response,
      200,
      JSON.stringify({
        service: "tallycraft",
        status: "ok",
        runtime: "php 8.3 (php-wasm preview bridge)",
        port,
        environment: process.env.NODE_ENV ?? "development",
        database: php.database,
        productionServer: "php -S 0.0.0.0:8080 -t api-php/public",
      }),
      { "content-type": "application/json; charset=utf-8" },
    );
    return;
  }

  if (path === "/healthz") {
    send(response, 200, "ok", { "content-type": "text/plain; charset=utf-8" });
    return;
  }

  if (path.startsWith("/api/")) {
    const method = (request.method ?? "GET").toUpperCase();
    const body = method === "GET" || method === "HEAD" ? undefined : await readBody(request);
    try {
      const [answer] = await php.run([
        {
          method,
          path,
          query: Object.fromEntries(url.searchParams),
          body,
        },
      ]);
      if (typeof answer.body === "string") {
        send(response, answer.status, answer.body, {
          "content-type": path.startsWith("/api/export/xml")
            ? "application/xml; charset=utf-8"
            : "text/plain; charset=utf-8",
        });
        return;
      }
      send(response, answer.status, answer.json, {
        "content-type": "application/json; charset=utf-8",
      });
    } catch (error) {
      send(
        response,
        500,
        JSON.stringify({ error: { code: "BRIDGE_ERROR", message: String(error.message ?? error) } }),
        { "content-type": "application/json; charset=utf-8" },
      );
    }
    return;
  }

  // The root is the app: a preview URL should never need a redirect to be
  // useful, and hash routes are origin-relative anyway.
  if (path === "/" || path === "/app" || path === "/app/") {
    if (await serveFile(response, join(reactDir, "index.html"))) return;
    send(response, 404, "React build missing. Run: npm run build:react");
    return;
  }

  if (path.startsWith("/app/")) {
    const relative = path.slice("/app/".length);
    const file = safeJoin(reactDir, relative === "" ? "index.html" : relative);
    if (file !== null && (await serveFile(response, file))) return;
    // Hash routing needs the shell for any unknown path under /app/.
    if (await serveFile(response, join(reactDir, "index.html"))) return;
    send(response, 404, "React build missing. Run: npm run build:react");
    return;
  }

  const file = safeJoin(publicDir, path);
  if (file !== null && (await serveFile(response, file))) return;
  if (await serveFile(response, join(publicDir, "index.html"))) return;
  send(response, 404, "Not found");
}

const server = createServer((request, response) => {
  handler(request, response).catch((error) => {
    console.error("request failed:", error);
    if (!response.headersSent) send(response, 500, "Internal error");
    else response.end();
  });
});

const bound = [port];
for (const alias of aliases) {
  const extra = createServer(server.listeners("request")[0]);
  extra.listen(alias, "0.0.0.0", () => bound.push(alias));
}

server.listen(port, "0.0.0.0", () => {
  console.log(`TallyCraft (React + PHP) on http://0.0.0.0:${port}/app/`);
  if (aliases.length > 0) console.log(`aliases: ${aliases.join(", ")}`);
});
