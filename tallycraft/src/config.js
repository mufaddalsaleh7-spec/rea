/**
 * Deployment configuration, resolved once from the environment.
 *
 * The app runs in three places: a laptop, the sandbox preview, and a
 * container behind a reverse proxy. Only the last one is configured the way a
 * stranger will run it, so every knob it needs is an environment variable with
 * a safe default, validated at boot rather than at the first request.
 *
 * Rules:
 *  - a bad value stops the process immediately with a message that says which
 *    variable is wrong and what was expected (a container that boots with a
 *    typo silently is worse than one that refuses to boot)
 *  - nothing here reads the filesystem; `openDatabase` callers create the
 *    directory, so this module stays trivially testable
 */

import { resolve } from "node:path";

const TRUE = new Set(["1", "true", "yes", "on"]);
const FALSE = new Set(["0", "false", "no", "off", ""]);

export class ConfigError extends Error {
  constructor(variable, message) {
    super(`${variable}: ${message}`);
    this.name = "ConfigError";
    this.variable = variable;
  }
}

function parseBoolean(name, raw, fallback) {
  if (raw === undefined || raw === null) return fallback;
  const value = String(raw).trim().toLowerCase();
  if (TRUE.has(value)) return true;
  if (FALSE.has(value)) return false;
  throw new ConfigError(name, `expected a boolean, got "${raw}"`);
}

function parsePort(name, raw, fallback) {
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return fallback;
  }
  // Accept the `3000:3000` shape docker-compose users paste by mistake.
  const text = String(raw).trim().split(":")[0];
  const port = Number(text);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new ConfigError(
      name,
      `expected a port between 1 and 65535, got "${raw}"`,
    );
  }
  return port;
}

function parseAliases(name, raw) {
  if (raw === undefined || raw === null || String(raw).trim() === "") return [];
  const ports = String(raw)
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value !== "");
  const parsed = ports.map((value) => {
    const port = Number(value);
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      throw new ConfigError(name, `"${value}" is not a port`);
    }
    return port;
  });
  return [...new Set(parsed)];
}

function parseUrl(name, raw) {
  if (raw === undefined || raw === null || String(raw).trim() === "")
    return null;
  const text = String(raw).trim().replace(/\/+$/, "");
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new ConfigError(
      name,
      `expected an absolute http(s) URL, got "${raw}"`,
    );
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ConfigError(
      name,
      `only http and https are supported, got "${url.protocol}"`,
    );
  }
  return text;
}

/**
 * Resolve the runtime configuration.
 *
 * @param {Record<string, string | undefined>} [env]
 * @param {string} [cwd] base directory for a relative database path
 */
export function resolveConfig(env = process.env, cwd = process.cwd()) {
  const dbPath = String(env.TALLYCRAFT_DB ?? "").trim();

  return {
    port: parsePort("PORT", env.PORT ?? env.TALLYCRAFT_PORT, 3000),
    host: String(env.HOST ?? "0.0.0.0").trim() || "0.0.0.0",
    dbPath:
      dbPath === ""
        ? resolve(cwd, "data", "tallycraft.db")
        : resolve(cwd, dbPath),
    demo: parseBoolean("TALLYCRAFT_DEMO", env.TALLYCRAFT_DEMO, false),
    // Aliases exist for the preview proxy; a real deployment listens once.
    aliases: parseAliases("TALLYCRAFT_ALIASES", env.TALLYCRAFT_ALIASES),
    // What operators should type. Derived from the request when unset.
    publicUrl: parseUrl(
      "PUBLIC_URL",
      env.PUBLIC_URL ?? env.TALLYCRAFT_PUBLIC_URL,
    ),
    environment: String(env.NODE_ENV ?? "development").trim() || "development",
    // Container builds carry their release; local runs read git instead.
    release: String(env.TALLYCRAFT_RELEASE ?? "").trim() || null,
  };
}

/** True when the configuration came from a container/host, not a laptop. */
export function isProduction(config) {
  return config.environment === "production";
}
