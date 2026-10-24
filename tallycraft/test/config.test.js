import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve } from "node:path";
import { ConfigError, resolveConfig } from "../src/config.js";

test("defaults suit a local run", () => {
  const config = resolveConfig({}, "/srv/tallycraft");
  assert.equal(config.port, 3000);
  assert.equal(config.host, "0.0.0.0");
  assert.equal(config.dbPath, resolve("/srv/tallycraft", "data/tallycraft.db"));
  assert.equal(config.demo, false);
  assert.deepEqual(config.aliases, []);
  assert.equal(config.publicUrl, null);
  assert.equal(config.environment, "development");
});

test("environment drives every knob", () => {
  const config = resolveConfig(
    {
      PORT: "8080",
      HOST: "127.0.0.1",
      TALLYCRAFT_DB: "/data/books.db",
      TALLYCRAFT_DEMO: "1",
      TALLYCRAFT_ALIASES: "8080, 5173 ,4000",
      PUBLIC_URL: "https://books.example.com/",
      NODE_ENV: "production",
      TALLYCRAFT_RELEASE: "v1.2.3",
    },
    "/app",
  );
  assert.equal(config.port, 8080);
  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.dbPath, "/data/books.db");
  assert.equal(config.demo, true);
  assert.deepEqual(config.aliases, [8080, 5173, 4000]);
  assert.equal(config.publicUrl, "https://books.example.com");
  assert.equal(config.environment, "production");
  assert.equal(config.release, "v1.2.3");
});

test("a compose-style port mapping is understood", () => {
  assert.equal(resolveConfig({ PORT: "3000:3000" }).port, 3000);
});

test("bad values fail at boot with the variable named", () => {
  assert.throws(
    () => resolveConfig({ PORT: "eighty" }),
    (error) =>
      error instanceof ConfigError &&
      error.variable === "PORT" &&
      /expected a port/.test(error.message),
  );
  assert.throws(() => resolveConfig({ PORT: "70000" }), ConfigError);
  assert.throws(() => resolveConfig({ TALLYCRAFT_DEMO: "maybe" }), ConfigError);
  assert.throws(
    () => resolveConfig({ TALLYCRAFT_ALIASES: "8080,abc" }),
    ConfigError,
  );
  assert.throws(
    () => resolveConfig({ PUBLIC_URL: "books.example.com" }),
    (error) =>
      error instanceof ConfigError && /absolute http/.test(error.message),
  );
  assert.throws(
    () => resolveConfig({ PUBLIC_URL: "ftp://books.example.com" }),
    ConfigError,
  );
});

test("booleans accept the usual spellings", () => {
  for (const value of ["1", "true", "YES", "on"]) {
    assert.equal(resolveConfig({ TALLYCRAFT_DEMO: value }).demo, true, value);
  }
  for (const value of ["0", "false", "no", "off", ""]) {
    assert.equal(resolveConfig({ TALLYCRAFT_DEMO: value }).demo, false, value);
  }
});

test("aliases are de-duplicated and keep their order", () => {
  const config = resolveConfig({ TALLYCRAFT_ALIASES: "5173,8080,5173,4000" });
  assert.deepEqual(config.aliases, [5173, 8080, 4000]);
});

test("a relative database path resolves against the project root", () => {
  assert.equal(
    resolveConfig({ TALLYCRAFT_DB: "volumes/books.db" }, "/opt/app").dbPath,
    resolve("/opt/app", "volumes/books.db"),
  );
});
