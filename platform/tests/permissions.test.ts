import { describe, expect, it, vi } from "vitest";

import { createPermissionBroker } from "../src/core/permissions.ts";

describe("permission broker", () => {
  it("denies capabilities that were not granted", () => {
    const broker = createPermissionBroker(["fs:read"]);
    expect(broker.has("fs:read")).toBe(true);
    expect(broker.has("process:spawn")).toBe(false);
    const denied = broker.check("process:spawn");
    expect(denied.ok).toBe(false);
    if (!denied.ok) {
      expect(denied.error.code).toBe("PERMISSION_DENIED");
      expect(denied.error.details).toEqual({ capability: "process:spawn" });
    }
  });

  it("grants and revokes capabilities, notifying subscribers once per change", () => {
    const broker = createPermissionBroker([]);
    const listener = vi.fn();
    broker.subscribe(listener);
    broker.grant("fs:write");
    broker.grant("fs:write");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(broker.granted()).toEqual(["fs:write"]);
    broker.revoke("fs:write");
    expect(listener).toHaveBeenCalledTimes(2);
    expect(broker.granted()).toEqual([]);
  });

  it("ignores unknown capabilities", () => {
    const broker = createPermissionBroker([]);
    broker.grant("root:everything" as never);
    expect(broker.granted()).toEqual([]);
    expect(broker.setGranted(["fs:read", "bogus" as never])).toEqual([
      "fs:read",
    ]);
  });

  it("returns the granted list in canonical order", () => {
    const broker = createPermissionBroker(["system:info", "fs:read"]);
    expect(broker.granted()).toEqual(["fs:read", "system:info"]);
  });
});
