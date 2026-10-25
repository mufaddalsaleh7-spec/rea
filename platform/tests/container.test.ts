import { describe, expect, it } from "vitest";

import { createServiceContainer } from "../src/core/container.ts";
import { err, ok } from "../src/core/result.ts";

describe("service container", () => {
  it("starts services in dependency order and stops them in reverse", async () => {
    const container = createServiceContainer();
    const log: string[] = [];
    const service = (name: string, dependsOn: string[] = []) => ({
      name,
      dependsOn,
      start: async () => {
        log.push(`start:${name}`);
        return ok(undefined);
      },
      stop: async () => {
        log.push(`stop:${name}`);
      },
    });
    expect(container.register(service("transport")).ok).toBe(true);
    expect(container.register(service("services", ["transport"])).ok).toBe(
      true,
    );
    expect(container.register(service("settings", ["transport"])).ok).toBe(
      true,
    );
    expect(container.register(service("capabilities", ["settings"])).ok).toBe(
      true,
    );

    const started = await container.start();
    expect(started.ok).toBe(true);
    // Levels, not a single chain: transport starts first, then anything whose
    // dependencies are already running. Only the ordering *constraints* matter.
    expect(log[0]).toBe("start:transport");
    expect(log.indexOf("start:settings")).toBeLessThan(
      log.indexOf("start:capabilities"),
    );
    expect(log.indexOf("start:transport")).toBeLessThan(
      log.indexOf("start:services"),
    );
    expect(log).toHaveLength(4);

    await container.stop();
    expect(log.slice(4)).toEqual(
      log.slice(0, 4)
        .reverse()
        .map((entry) => entry.replace("start:", "stop:")),
    );
    expect(container.order()).toEqual([]);
  });

  it("rejects duplicate registrations and unknown dependencies", () => {
    const container = createServiceContainer();
    const base = { name: "a", dependsOn: [], start: async () => ok(undefined) };
    expect(container.register(base).ok).toBe(true);
    const duplicate = container.register(base);
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) expect(duplicate.error.code).toBe("CONFLICT");

    const missing = container.register({
      ...base,
      name: "b",
      dependsOn: ["nope"],
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error.code).toBe("INVALID_ARGUMENT");
  });

  it("rejects dependency cycles", () => {
    const container = createServiceContainer();
    const start = async () => ok(undefined);
    expect(container.register({ name: "a", dependsOn: [], start }).ok).toBe(
      true,
    );
    expect(container.register({ name: "b", dependsOn: ["a"], start }).ok).toBe(
      true,
    );
    const cycle = container.register({ name: "c", dependsOn: ["c"], start });
    expect(cycle.ok).toBe(false);
    if (!cycle.ok) expect(cycle.error.code).toBe("INVALID_ARGUMENT");
  });

  it("rolls back already-started services when one fails", async () => {
    const container = createServiceContainer();
    const stopped: string[] = [];
    container.register({
      name: "ok-service",
      dependsOn: [],
      start: async () => ok(undefined),
      stop: async () => {
        stopped.push("ok-service");
      },
    });
    container.register({
      name: "broken",
      dependsOn: ["ok-service"],
      start: async () => err({ code: "UNAVAILABLE", message: "boom" }),
    });
    const result = await container.start();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("UNAVAILABLE");
      expect(result.error.details?.["failed"]).toEqual(["broken"]);
    }
    expect(stopped).toEqual(["ok-service"]);
    expect(container.order()).toEqual([]);
  });
});
