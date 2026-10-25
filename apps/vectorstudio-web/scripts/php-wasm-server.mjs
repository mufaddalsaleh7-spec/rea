/**
 * PHP runtime bridge.
 *
 * The React front end talks to a real PHP application (php/). In environments
 * where the host has no `php` binary — including this sandbox and the static
 * preview container — the same PHP sources are executed by the PHP-WASM
 * runtime instead, mounted straight from the repository so storage stays on
 * disk and the code under test is exactly the code you deploy.
 *
 *   node scripts/php-wasm-server.mjs            # http://0.0.0.0:8080
 *   PORT=9000 node scripts/php-wasm-server.mjs
 *
 * With a real PHP install prefer:
 *   php -S 127.0.0.1:8080 -t php/public php/public/index.php
 */

import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appDir = dirname(here);
const port = Number(process.env.PORT || 8080);
const phpVersion = process.env.PHP_WASM_VERSION || "8.3";

let runtime;
try {
  ({ loadNodeRuntime: runtime } = await import("@php-wasm/node"));
  await import("@php-wasm/universal");
} catch {
  console.error(
    "[php-wasm] @php-wasm/node is not installed.\n" +
      "Install it with `npm install` (dev dependencies) or run the API with a real PHP binary:\n" +
      "  php -S 127.0.0.1:8080 -t php/public php/public/index.php",
  );
  process.exit(1);
}

const { loadNodeRuntime, createNodeFsMountHandler } = await import("@php-wasm/node");
const { PHP } = await import("@php-wasm/universal");

const instance = new PHP(
  await loadNodeRuntime(phpVersion, {
    emscriptenOptions: { processId: 7 },
    followSymlinks: true,
  }),
);

await instance.mount("/app", createNodeFsMountHandler(appDir));

instance.writeFile(
  "/tmp/vs-bridge.php",
  `<?php
declare(strict_types=1);
require '/app/php/bootstrap.php';

$request = json_decode((string) file_get_contents('/tmp/vs-request.json'), true) ?: [];
$headers = [];
foreach (($request['headers'] ?? []) as $name => $value) {
    $headers[strtolower((string) $name)] = (string) $value;
}
putenv('VECTORSTUDIO_DIST=/app/dist');
putenv('VECTORSTUDIO_STORAGE=/app/php/storage');
$config = \\VectorStudio\\Support\\Config::fromEnvironment('/app/php');
try {
    $app = \\VectorStudio\\App::boot($config);
    $response = $app->handle(new \\VectorStudio\\Http\\Request(
        (string) ($request['method'] ?? 'GET'),
        (string) ($request['path'] ?? '/'),
        (array) ($request['query'] ?? []),
        (array) ($request['body'] ?? []),
        $headers,
        (string) ($request['rawBody'] ?? ''),
    ));
    $payload = [
        'status' => $response->status,
        'headers' => $response->headerList(),
        'body' => base64_encode($response->body),
    ];
} catch (\\Throwable $error) {
    $payload = [
        'status' => 500,
        'headers' => ['content-type' => 'application/json'],
        'body' => base64_encode((string) json_encode([
            'error' => 'PHP-WASM bridge failure',
            'message' => $error->getMessage(),
            'file' => $error->getFile(),
            'line' => $error->getLine(),
        ])),
    ];
}
file_put_contents('/tmp/vs-response.json', json_encode($payload));
`,
);

let queue = Promise.resolve();

/** Run one request through the shared PHP runtime, serialised. */
function handleOverPhp(request) {
  const run = async () => {
    instance.writeFile("/tmp/vs-request.json", JSON.stringify(request));
    const result = await instance.run({ scriptPath: "/tmp/vs-bridge.php" });
    if (result.errors) {
      console.error("[php]", String(result.errors).slice(0, 2000));
    }
    const raw = instance.readFileAsText("/tmp/vs-response.json");
    return JSON.parse(raw);
  };
  queue = queue.then(run, run);
  return queue;
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://localhost");
  const rawBody = await readBody(req);
  let body = {};
  if (rawBody && (req.headers["content-type"] || "").includes("json")) {
    try {
      body = JSON.parse(rawBody);
    } catch {
      body = {};
    }
  }

  try {
    const response = await handleOverPhp({
      method: req.method || "GET",
      path: url.pathname,
      query: Object.fromEntries(url.searchParams.entries()),
      headers: Object.fromEntries(
        Object.entries(req.headers).filter(([, value]) => typeof value === "string"),
      ),
      body,
      rawBody,
    });
    res.writeHead(response.status, response.headers || {});
    res.end(req.method === "HEAD" ? undefined : Buffer.from(response.body || "", "base64"));
  } catch (error) {
    console.error("[bridge]", error);
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "PHP bridge error", message: String(error?.message || error) }));
  }
});

server.listen(port, "0.0.0.0", () => {
  const bundle = join(appDir, "dist", "index.html");
  console.log(`[php-wasm] PHP ${phpVersion} API + static host on http://0.0.0.0:${port}`);
  console.log(`[php-wasm] serving ${appDir}`);
  if (!existsSync(bundle)) {
    console.warn("[php-wasm] dist/index.html not found — run `npm run build` for the production bundle.");
  } else {
    console.log(`[php-wasm] bundle ${readFileSync(bundle, "utf8").length} bytes of HTML`);
  }
});
