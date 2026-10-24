import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import {
  instanceInfo,
  isTallyCraftInstance,
  previewUrlFor,
  SERVICE_NAME,
} from "../src/instance.js";
import { isPortFree, probeInstance, resolvePort } from "../scripts/serve.mjs";

/** Stand up a throwaway HTTP server and return its port plus a closer. */
async function fakeServer(handler) {
  const server = createServer(handler);
  await new Promise((ready) => server.listen(0, "127.0.0.1", ready));
  return {
    port: server.address().port,
    close: () => new Promise((done) => server.close(done)),
  };
}

test("preview URL is derived from the sandbox id, never guessed", () => {
  assert.equal(previewUrlFor(3000, "abc123"), "https://3000-abc123.e2b.app");
  assert.equal(previewUrlFor(3000, undefined), null);
  assert.equal(previewUrlFor(3000, "   "), null);
  assert.equal(previewUrlFor(0, "abc123"), null);
  assert.equal(previewUrlFor(Number.NaN, "abc123"), null);
});

test("instance identity carries pid, port, uptime and git", () => {
  const started = new Date(Date.now() - 5_000);
  const info = instanceInfo({
    port: 3000,
    sandboxId: "abc123",
    startedAt: started,
    pid: 4242,
    dbPath: "/tmp/x.db",
    commit: "674fde0",
    branch: "arena/12415f30-rea",
  });
  assert.equal(info.service, SERVICE_NAME);
  assert.equal(info.status, "ok");
  assert.equal(info.pid, 4242);
  assert.equal(info.port, 3000);
  assert.equal(info.localUrl, "http://127.0.0.1:3000");
  assert.equal(info.previewUrl, "https://3000-abc123.e2b.app");
  assert.equal(info.sandboxId, "abc123");
  assert.equal(info.database, "/tmp/x.db");
  assert.equal(info.git.commit, "674fde0");
  assert.ok(
    info.uptimeSeconds >= 4,
    "uptime should be measured from startedAt",
  );
});

test("instance probe identifies TallyCraft and rejects strangers", () => {
  assert.equal(
    isTallyCraftInstance({ service: SERVICE_NAME, status: "ok" }),
    true,
  );
  assert.equal(isTallyCraftInstance({ service: "nginx", status: "ok" }), false);
  assert.equal(
    isTallyCraftInstance({ service: SERVICE_NAME, status: "down" }),
    false,
  );
  assert.equal(isTallyCraftInstance(null), false);
  assert.equal(isTallyCraftInstance("ok"), false);
});

test("port resolver reuses our own listener", async () => {
  const payload = JSON.stringify({
    service: SERVICE_NAME,
    status: "ok",
    pid: 7,
    port: 0,
  });
  const fake = await fakeServer((request, response) => {
    if (request.url === "/api/instance") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(payload);
      return;
    }
    response.writeHead(404).end();
  });
  const decision = await resolvePort(fake.port, { attempts: 3 });
  assert.equal(decision.kind, "reuse");
  assert.equal(decision.port, fake.port);
  assert.equal(decision.info.pid, 7);
  await fake.close();
});

test("port resolver skips a foreign listener instead of binding over it", async () => {
  const foreign = await fakeServer((request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end("<html>not tallycraft</html>");
  });
  const decision = await resolvePort(foreign.port, { attempts: 4 });
  assert.equal(decision.kind, "start");
  assert.ok(decision.port > foreign.port, "must move past the occupied port");
  assert.notEqual(decision.port, foreign.port);
  await foreign.close();
});

test("port resolver gives up rather than looping forever", async () => {
  const decision = await resolvePort(3000, { attempts: 0 });
  assert.equal(decision.kind, "exhausted");
});

test("a free port is detected and an occupied one is not", async () => {
  const fake = await fakeServer((request, response) =>
    response.writeHead(200).end("x"),
  );
  assert.equal(await isPortFree(fake.port), false);
  await fake.close();
  assert.equal(await isPortFree(fake.port), true);
});

test("probing a dead port answers null quickly", async () => {
  const fake = await fakeServer((request, response) =>
    response.writeHead(200).end("x"),
  );
  const port = fake.port;
  await fake.close();
  const info = await probeInstance(port);
  assert.equal(info, null);
});
