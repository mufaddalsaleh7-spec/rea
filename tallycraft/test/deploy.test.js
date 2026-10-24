/**
 * Deployment contract.
 *
 * The deploy files are the part of the repo nobody exercises locally, so they
 * rot silently: a Dockerfile that exposes the wrong port, a compose volume
 * that is not where TALLYCRAFT_DB points, a healthcheck aimed at a route that
 * no longer exists. These tests read the files and assert they agree with the
 * app. They cannot prove the image boots (no Docker in CI here), but they
 * catch every mismatch that made a deploy fail before.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { resolveConfig } from "../src/config.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => readFileSync(join(root, name), "utf8");

test("the image is small, non-root and hands Node the signals", () => {
  const dockerfile = read("Dockerfile");
  assert.match(dockerfile, /^FROM node:22-alpine/m);
  assert.match(dockerfile, /^USER node/m, "containers must not run as root");
  assert.match(dockerfile, /^EXPOSE 3000/m);
  assert.match(dockerfile, /^VOLUME \["\/data"\]/m);
  assert.match(dockerfile, /^HEALTHCHECK[\s\S]*scripts\/healthcheck\.mjs/m);
  // exec form: no shell, so SIGTERM reaches node.
  assert.match(
    dockerfile,
    /^CMD \["node", .*"bin\/tallycraft\.js", "serve"/m,
    "CMD must be exec-form and run the server directly",
  );
  assert.doesNotMatch(dockerfile, /^CMD npm/m, "npm as PID 1 strands signals");
  assert.match(dockerfile, /TALLYCRAFT_DB=\/data\/tallycraft\.db/);
});

test("compose mounts the volume where the database is configured", () => {
  const compose = read("docker-compose.yml");
  const dbPath = /TALLYCRAFT_DB:\s*(\S+)/.exec(compose)?.[1];
  const mount = /-\s*tallycraft-data:(\S+)/.exec(compose)?.[1];
  assert.equal(dbPath, "/data/tallycraft.db");
  assert.equal(mount, "/data");
  assert.ok(dbPath.startsWith(mount), "the database must live on the volume");

  assert.match(compose, /healthcheck:/);
  assert.match(compose, /stop_grace_period/, "the drain needs a grace period");
  assert.match(compose, /restart: unless-stopped/);
});

test("render and fly keep the database on a persistent disk", () => {
  const render = read("render.yaml");
  assert.match(render, /healthCheckPath: \/healthz/);
  assert.match(render, /mountPath: \/data/);

  const fly = read("fly.toml");
  const internal = Number(/internal_port\s*=\s*(\d+)/.exec(fly)?.[1]);
  assert.equal(internal, 3000);
  assert.match(fly, /destination = "\/data"/);
  assert.match(fly, /path = "\/healthz"/);
  assert.match(fly, /min_machines_running = 1/);
});

test("the reverse proxies forward the host and never cache the API", () => {
  const nginx = read("deploy/nginx/tallycraft.conf");
  assert.match(nginx, /proxy_pass http:\/\/127\.0\.0\.1:3000/);
  assert.match(nginx, /proxy_set_header Host \$host/);
  assert.match(nginx, /proxy_set_header X-Forwarded-Proto \$scheme/);
  assert.match(nginx, /location = \/healthz/);
  assert.match(nginx, /Cache-Control "no-store"/);

  const caddy = read("deploy/Caddyfile");
  assert.match(caddy, /reverse_proxy 127\.0\.0\.1:3000/);
});

test("the systemd unit points at the same port, host and database", () => {
  const unit = read("deploy/systemd/tallycraft.service");
  assert.match(
    unit,
    /ExecStart=.*bin\/tallycraft\.js serve --host 127\.0\.0\.1/,
  );
  assert.match(
    unit,
    /Environment=TALLYCRAFT_DB=\/opt\/tallycraft\/data\/tallycraft\.db/,
  );
  assert.match(unit, /ReadWritePaths=\/opt\/tallycraft\/data/);
  assert.match(unit, /TimeoutStopSec=25/);
  assert.match(unit, /Restart=always/);
});

test("the documented defaults are the ones the code uses", () => {
  const example = read(".env.example");
  const port = Number(/^PORT=(\d+)/m.exec(example)?.[1]);
  const config = resolveConfig({ PORT: String(port) }, "/app");
  assert.equal(config.port, 3000);
  assert.match(example, /TALLYCRAFT_DB=\/data\/tallycraft\.db/);

  const dockerfile = read("Dockerfile");
  assert.match(dockerfile, new RegExp(`PORT=${port}`));
});

test("the image does not ship the book or the build context noise", () => {
  const ignore = read(".dockerignore");
  for (const entry of ["data", "backups", ".runtime", "*.db", "test", ".env"]) {
    assert.match(
      ignore,
      new RegExp(`^${entry.replaceAll("*", "\\*")}$`, "m"),
      entry,
    );
  }
});

test("the health probe the container runs is the route the server serves", () => {
  const health = read("scripts/healthcheck.mjs");
  assert.match(health, /\/healthz/);
  assert.match(read("src/server.js"), /pathname === "\/healthz"/);
});
