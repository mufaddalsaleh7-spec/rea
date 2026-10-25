/**
 * Run php/tests/run.php through the PHP-WASM runtime so the API suite works on
 * hosts without a PHP binary (including CI sandboxes).
 *
 *   node scripts/run-php-tests.mjs        # or: npm run test:php:wasm
 */

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadNodeRuntime, createNodeFsMountHandler } from "@php-wasm/node";
import { PHP } from "@php-wasm/universal";

const appDir = dirname(dirname(fileURLToPath(import.meta.url)));
const php = new PHP(await loadNodeRuntime(process.env.PHP_WASM_VERSION || "8.3", {
  emscriptenOptions: { processId: 21 },
  followSymlinks: true,
}));
await php.mount("/app", createNodeFsMountHandler(appDir));

const result = await php.run({
  scriptPath: "/app/php/tests/run.php",
  env: { VECTORSTUDIO_DEV_CORS: "0" },
});
process.stdout.write(result.text || "");
if (result.errors) process.stderr.write(String(result.errors));
process.exit(result.exitCode ?? 0);
