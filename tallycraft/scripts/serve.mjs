#!/usr/bin/env node
/**
 * TallyCraft preview supervisor.
 *
 * A sandbox is an unreliable host: it is recycled between sessions, ports can
 * be left held by an orphan from a previous run, processes get stopped without
 * notice, and saturation makes a healthy server look dead. This supervisor owns
 * those failure modes so the operator does not have to:
 *
 *   - port resolution  reuse our own listener, skip a foreign one, never crash
 *   - crash restart    exponential backoff with a bounded restart budget
 *   - hang watchdog    probe /healthz; restart after consecutive failures
 *   - discovery        publish the instance identity and preview URL
 *   - no wrapper chain spawn node directly so signals reach the server
 *
 * Usage: node scripts/serve.mjs [--port 3000] [--host 0.0.0.0] [--demo]
 */

import { spawn } from "node:child_process";
import { connect } from "node:net";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  instanceInfo,
  isTallyCraftInstance,
  previewUrlFor,
} from "../src/instance.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const entry = resolve(projectRoot, "bin", "tallycraft.js");

const RESTART_WINDOW_MS = 60_000;
const MAX_RESTARTS_PER_WINDOW = 8;
const WATCHDOG_INTERVAL_MS = 10_000;
const PROBE_TIMEOUT_MS = 1_500;
const HEALTHY_FAILURES_BEFORE_RESTART = 3;

function parseFlags(argv) {
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--demo") {
      flags.demo = true;
      continue;
    }
    if (token.startsWith("--")) {
      const next = argv[index + 1];
      flags[token.slice(2)] =
        next === undefined || next.startsWith("--") ? true : next;
      if (next !== undefined && !next.startsWith("--")) index += 1;
    }
  }
  return flags;
}

const log = (message) => console.log(`${new Date().toISOString()} ${message}`);

/** True when nothing is bound to the port. */
export function isPortFree(port, host = "127.0.0.1") {
  return new Promise((done) => {
    const socket = connect({ port, host });
    const finish = (free) => {
      socket.removeAllListeners();
      socket.destroy();
      done(free);
    };
    socket.setTimeout(700);
    socket.once("connect", () => finish(false));
    socket.once("timeout", () => finish(true));
    socket.once("error", () => finish(true));
  });
}

/** Fetch the instance identity from a port, or null when nothing answers. */
export async function probeInstance(port, host = "127.0.0.1") {
  try {
    const response = await fetch(`http://${host}:${port}/api/instance`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Decide where to listen.
 *
 * Returns one of:
 *   { kind: "reuse", port, info }  our own server already answers there
 *   { kind: "start", port }        this port is free
 *   { kind: "exhausted" }          every candidate is held by a foreign process
 */
export async function resolvePort(
  preferred,
  { probe = probeInstance, free = isPortFree, attempts = 12 } = {},
) {
  for (let offset = 0; offset < attempts; offset += 1) {
    const port = preferred + offset;
    if (await free(port)) return { kind: "start", port };
    const info = await probe(port);
    if (isTallyCraftInstance(info)) return { kind: "reuse", port, info };
  }
  return { kind: "exhausted" };
}

class Supervisor {
  constructor({ port, host, demo }) {
    this.requestedPort = port;
    this.port = port;
    this.host = host;
    this.demo = demo;
    this.child = null;
    this.restarts = [];
    this.healthyFailures = 0;
    this.stopping = false;
    this.startedAt = new Date();
    this.identity = null;
  }

  publish(extra = {}) {
    const info = {
      ...instanceInfo({
        port: this.port,
        host: this.host,
        sandboxId: process.env.E2B_SANDBOX_ID,
        startedAt: this.startedAt,
        pid: this.child?.pid ?? null,
        supervisorPid: process.pid,
        dbPath: extra.dbPath ?? this.identity?.database ?? null,
        branch: this.identity?.git?.branch ?? null,
        commit: this.identity?.git?.commit ?? null,
      }),
      restarts: this.restarts.length,
    };
    this.identity = info;
    try {
      mkdirSync(resolve(projectRoot, ".runtime"), { recursive: true });
      writeFileSync(
        resolve(projectRoot, ".runtime", "supervisor.json"),
        `${JSON.stringify(info, null, 2)}\n`,
      );
    } catch {
      // Publishing is best effort; the server itself never depends on it.
    }
    return info;
  }

  async start() {
    const decision = await resolvePort(this.requestedPort);

    if (decision.kind === "exhausted") {
      log(
        `no free port in ${this.requestedPort}..${this.requestedPort + 11}; stop the foreign listener first`,
      );
      process.exit(1);
    }
    if (decision.kind === "reuse") {
      // Idempotent: a second start must not double-bind or kill live traffic.
      const info = decision.info;
      log(
        `already running on port ${decision.port} (pid ${info.pid}, uptime ${info.uptimeSeconds}s)`,
      );
      if (info.previewUrl !== null) log(`preview: ${info.previewUrl}`);
      process.exit(0);
    }

    this.port = decision.port;
    if (this.port !== this.requestedPort) {
      log(
        `port ${this.requestedPort} is held by another process; using ${this.port}`,
      );
    }
    await this.spawnServer();
    this.startWatchdog();
  }

  async spawnServer() {
    const args = [
      "--disable-warning=ExperimentalWarning",
      entry,
      "serve",
      "--port",
      String(this.port),
      "--host",
      this.host,
      // The server exits by itself if this supervisor disappears, so an abrupt
      // kill cannot strand a process holding the port.
      "--parent-pid",
      String(process.pid),
    ];
    if (this.demo) args.push("--demo");

    log(`starting ${args.join(" ")}`);
    const child = spawn(process.execPath, args, {
      cwd: projectRoot,
      stdio: ["ignore", "pipe", "pipe"],
      // Direct node child: SIGTERM reaches the server, so no orphan can keep
      // holding the port after this supervisor exits.
      detached: false,
      env: { ...process.env, TALLYCRAFT_PARENT_PID: String(process.pid) },
    });
    this.child = child;

    child.stdout.on("data", (chunk) => process.stdout.write(chunk));
    child.stderr.on("data", (chunk) => process.stderr.write(chunk));

    child.on("exit", (code, signal) => {
      this.child = null;
      if (this.stopping) return;
      log(`server exited (code ${code}, signal ${signal ?? "none"})`);
      this.scheduleRestart();
    });

    child.on("error", (error) => {
      log(`server failed to start: ${error.message}`);
      this.scheduleRestart();
    });

    // Wait for the port to answer before declaring success.
    const ready = await this.waitForReady();
    if (ready === null) {
      log("server did not become ready within 20s");
      return;
    }
    this.publish({ dbPath: ready.database ?? null });
    log(`ready on http://${this.host}:${this.port}`);
    if (ready.previewUrl !== null) log(`preview: ${ready.previewUrl}`);
  }

  async waitForReady(timeoutMs = 20_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const info = await probeInstance(this.port);
      if (isTallyCraftInstance(info)) return info;
      await new Promise((done) => setTimeout(done, 250));
    }
    return null;
  }

  scheduleRestart() {
    this.restarts = this.restarts.filter(
      (at) => Date.now() - at < RESTART_WINDOW_MS,
    );
    this.restarts.push(Date.now());
    if (this.restarts.length > MAX_RESTARTS_PER_WINDOW) {
      log(
        `${this.restarts.length} restarts in ${RESTART_WINDOW_MS / 1000}s — giving up to avoid a crash loop`,
      );
      log("inspect the log above, then rerun: node scripts/serve.mjs");
      process.exit(1);
    }
    const delay = Math.min(500 * 2 ** (this.restarts.length - 1), 8_000);
    log(`restarting in ${delay}ms (attempt ${this.restarts.length})`);
    setTimeout(() => {
      if (!this.stopping) void this.spawnServer();
    }, delay);
  }

  startWatchdog() {
    const timer = setInterval(async () => {
      if (this.stopping || this.child === null) return;
      const info = await probeInstance(this.port);
      if (isTallyCraftInstance(info)) {
        this.healthyFailures = 0;
        return;
      }
      this.healthyFailures += 1;
      log(
        `health probe failed (${this.healthyFailures}/${HEALTHY_FAILURES_BEFORE_RESTART})`,
      );
      if (this.healthyFailures >= HEALTHY_FAILURES_BEFORE_RESTART) {
        this.healthyFailures = 0;
        log("server is unresponsive; restarting");
        this.child.kill("SIGKILL");
      }
    }, WATCHDOG_INTERVAL_MS);
    timer.unref();
  }

  async stop(signal) {
    if (this.stopping) return;
    this.stopping = true;
    log(`${signal} received; stopping`);
    if (this.child === null) {
      process.exit(0);
    }
    const child = this.child;
    const exited = new Promise((done) => child.once("exit", done));
    child.kill("SIGTERM");
    const timer = setTimeout(() => {
      log("graceful stop timed out; sending SIGKILL");
      child.kill("SIGKILL");
    }, 5_000);
    timer.unref();
    await exited;
    log("stopped cleanly");
    process.exit(0);
  }
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const port = Number(flags.port ?? process.env.PORT ?? 3000);
  const host = String(flags.host ?? process.env.HOST ?? "0.0.0.0");
  const demo = flags.demo === true || process.env.TALLYCRAFT_DEMO === "1";

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    console.error(`invalid port: ${flags.port}`);
    process.exit(2);
  }

  const supervisor = new Supervisor({ port, host, demo });
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => void supervisor.stop(signal));
  }
  await supervisor.start();

  const url = previewUrlFor(supervisor.port, process.env.E2B_SANDBOX_ID);
  log(`supervisor pid ${process.pid}`);
  if (url !== null) log(`open this preview: ${url}`);
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  await main();
}
