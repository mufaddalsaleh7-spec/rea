import { bootPlatform, PLATFORM_VERSION } from "./boot.ts";
import { createLogger } from "./core/logging.ts";
import { describeError } from "./core/errors.ts";
import { createPlatformServer } from "./server/server.ts";

/**
 * ReaOS process entry point.
 *
 * Usage:
 *   node src/main.ts [--port 4173] [--host 0.0.0.0] [--root /path/to/home]
 *
 * The process owns the platform services and the shell transport; stopping it
 * (Ctrl+C) shuts services down in reverse order, kills child processes and
 * closes the listening socket.
 */

const argument = (name: string): string | undefined => {
  const withEquals = process.argv.find((value) =>
    value.startsWith(`--${name}=`),
  );
  if (withEquals !== undefined) return withEquals.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const port = Number(argument("port") ?? process.env["REAOS_PORT"] ?? 4173);
const host = argument("host") ?? process.env["REAOS_HOST"] ?? "0.0.0.0";
const root = argument("root");

const logger = createLogger({ scope: "reaos.main", minimumLevel: "info" });

const booted = await bootPlatform(root === undefined ? {} : { root });
if (!booted.ok) {
  console.error(`ReaOS failed to start: ${describeError(booted.error)}`);
  process.exit(1);
}

const platform = booted.value;
const server = createPlatformServer({ platform, logger: logger.child("http") });

try {
  const { url } = await server.listen({ port, host });
  logger.info("ReaOS is ready", {
    version: PLATFORM_VERSION,
    url,
    home: platform.root,
    services: platform.services,
  });
  console.log(
    `\n  ReaOS ${PLATFORM_VERSION} — ${url}\n  home: ${platform.root}\n`,
  );
} catch (cause) {
  console.error(
    `ReaOS could not bind ${host}:${port}: ${cause instanceof Error ? cause.message : String(cause)}`,
  );
  await platform.shutdown();
  process.exit(1);
}

let stopping = false;
const stop = async (signal: string): Promise<void> => {
  if (stopping) return;
  stopping = true;
  logger.info("shutting down", { signal });
  await server.close();
  await platform.shutdown();
  process.exit(0);
};

process.on("SIGINT", () => void stop("SIGINT"));
process.on("SIGTERM", () => void stop("SIGTERM"));
