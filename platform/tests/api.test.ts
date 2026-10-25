import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { bootPlatform } from "../src/boot.ts";
import type { Platform } from "../src/boot.ts";
import { handleApiRequest } from "../src/server/api.ts";
import type { ApiResponse } from "../src/server/api.ts";
import { createPlatformServer } from "../src/server/server.ts";
import type { PlatformServer } from "../src/server/server.ts";

let root: string;
let platform: Platform;

const api = async (
  method: string,
  path: string,
  body?: unknown,
  query: Record<string, string> = {},
): Promise<ApiResponse> =>
  handleApiRequest(platform, { method, path, query, body });

const data = (response: ApiResponse): Record<string, unknown> => {
  const payload = response.body as {
    ok: boolean;
    data: Record<string, unknown>;
  };
  expect(payload.ok).toBe(true);
  return payload.data;
};

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "reaos-api-"));
  const booted = await bootPlatform({
    root,
    seedHome: true,
    allowedCommands: ["node"],
  });
  if (!booted.ok) throw new Error(`boot failed: ${booted.error.message}`);
  platform = booted.value;
});

afterEach(async () => {
  await platform.shutdown();
  await rm(root, { recursive: true, force: true });
});

describe("platform API", () => {
  it("reports health and the composed service list", async () => {
    const health = await api("GET", "/api/health");
    expect(health.status).toBe(200);
    const payload = data(health);
    expect(payload["status"]).toBe("ok");
    expect(payload["services"]).toEqual([
      "filesystem",
      "settings",
      "permissions",
      "services",
    ]);
  });

  it("serves real host metrics", async () => {
    const info = data(await api("GET", "/api/system"));
    const facts = info["facts"] as Record<string, unknown>;
    expect(typeof facts["hostname"]).toBe("string");
    expect(Number(facts["cpuCount"])).toBeGreaterThan(0);
    const first = info["metrics"] as Record<string, unknown>;
    expect(first["cpuUsagePercent"]).toBeNull();
    const second = data(await api("GET", "/api/system"))["metrics"] as Record<
      string,
      number | null
    >;
    expect(second["cpuUsagePercent"]).toBeGreaterThanOrEqual(0);
    expect(second["cpuUsagePercent"]).toBeLessThanOrEqual(100);
  });

  it("lists applications from the catalog", async () => {
    const apps = data(await api("GET", "/api/apps"))["apps"] as {
      id: string;
    }[];
    expect(apps.map((app) => app.id)).toContain("files");
    expect(apps.map((app) => app.id)).toContain("settings");
  });

  it("writes, reads, lists, renames and trashes real files", async () => {
    const created = await api("POST", "/api/files/mkdir", {
      path: "/Documents/projects",
    });
    expect(created.status).toBe(200);

    const write = await api("POST", "/api/files/write", {
      path: "/Documents/projects/plan.txt",
      content: "ship the platform",
    });
    expect(write.status).toBe(200);

    const read = data(
      await api("POST", "/api/files/read", {
        path: "/Documents/projects/plan.txt",
      }),
    );
    expect(read["content"]).toBe("ship the platform");

    const listing = data(
      await api("GET", "/api/files", undefined, {
        path: "/Documents/projects",
      }),
    );
    expect(
      (listing["entries"] as { name: string }[]).map((entry) => entry.name),
    ).toEqual(["plan.txt"]);

    const renamed = await api("POST", "/api/files/rename", {
      from: "/Documents/projects/plan.txt",
      to: "/Documents/projects/roadmap.txt",
    });
    expect(renamed.status).toBe(200);

    const trashed = data(
      await api("POST", "/api/files/delete", {
        path: "/Documents/projects/roadmap.txt",
      }),
    );
    expect(String(trashed["trashedTo"])).toMatch(/^\/\.Trash\//u);

    const trash = data(await api("GET", "/api/files/trash"));
    expect((trash["entries"] as unknown[]).length).toBe(1);
  });

  it("rejects path traversal and read-only system writes with the right status", async () => {
    const traversal = await api("POST", "/api/files/read", {
      path: "/../../etc/passwd",
    });
    expect(traversal.status).toBe(400);
    const systemWrite = await api("POST", "/api/files/write", {
      path: "/System/settings.json",
      content: "{}",
    });
    expect(systemWrite.status).toBe(403);
  });

  it("validates settings changes and reflects them in capabilities", async () => {
    const invalid = await api("PATCH", "/api/settings", { theme: "neon" });
    expect(invalid.status).toBe(400);

    const enabled = await api("PATCH", "/api/settings", {
      terminalEnabled: true,
      theme: "light",
    });
    expect(enabled.status).toBe(200);
    const capabilities = data(await api("GET", "/api/capabilities"));
    expect(capabilities["granted"]).toContain("process:spawn");

    const disabled = await api("PATCH", "/api/settings", {
      terminalEnabled: false,
    });
    expect(disabled.status).toBe(200);
    expect(
      data(await api("GET", "/api/capabilities"))["granted"],
    ).not.toContain("process:spawn");
  });

  it("denies command execution until the terminal capability is granted", async () => {
    const denied = await api("POST", "/api/terminal/exec", {
      command: "node",
      args: ["-e", "0"],
    });
    expect(denied.status).toBe(403);

    await api("PATCH", "/api/settings", { terminalEnabled: true });
    const allowed = await api("POST", "/api/terminal/exec", {
      command: "node",
      args: ["-e", "process.stdout.write('ready')"],
    });
    expect(allowed.status).toBe(200);
    expect(data(allowed)["stdout"]).toBe("ready");

    const unlisted = await api("POST", "/api/terminal/exec", { command: "sh" });
    expect(unlisted.status).toBe(403);
  });

  it("searches applications and files through the launcher", async () => {
    await api("POST", "/api/files/write", {
      path: "/Documents/budget.txt",
      content: "1",
    });
    const results = data(
      await api("GET", "/api/search", undefined, { q: "bud" }),
    ) as unknown as {
      kind: string;
      title: string;
    }[];
    expect(
      results.some((hit) => hit.kind === "file" && hit.title === "budget.txt"),
    ).toBe(true);

    const appResults = data(
      await api("GET", "/api/search", undefined, { q: "set" }),
    ) as unknown as {
      kind: string;
      title: string;
    }[];
    expect(appResults[0]?.title).toBe("Settings");
  });

  it("publishes and dismisses notifications", async () => {
    const list = data(await api("GET", "/api/notifications"))[
      "notifications"
    ] as unknown as {
      id: string;
      title: string;
    }[];
    expect(list.length).toBeGreaterThan(0);
    const first = list[0];
    expect(first).toBeDefined();
    const dismissed = await api("POST", "/api/notifications/dismiss", {
      id: first?.id,
    });
    expect(dismissed.status).toBe(200);
    const after = data(await api("GET", "/api/notifications"))[
      "notifications"
    ] as unknown as {
      id: string;
    }[];
    expect(after.some((record) => record.id === first?.id)).toBe(false);
  });

  it("returns 404 for unknown routes and 400 for malformed bodies", async () => {
    expect((await api("GET", "/api/nope")).status).toBe(404);
    expect(
      (await api("POST", "/api/files/write", { content: "x" })).status,
    ).toBe(400);
    expect(
      (await api("POST", "/api/files/write", "not an object")).status,
    ).toBe(400);
  });

  it("publishes notifications through the platform service", async () => {
    const published = await api("POST", "/api/notifications", {
      title: "Build finished",
      body: "Everything passed",
      level: "success",
    });
    expect(published.status).toBe(201);
    const records = data(await api("GET", "/api/notifications"))[
      "notifications"
    ] as unknown as {
      title: string;
      level: string;
    }[];
    expect(records[0]?.title).toBe("Build finished");
    expect(records[0]?.level).toBe("success");

    const invalid = await api("POST", "/api/notifications", {
      body: "no title",
    });
    expect(invalid.status).toBe(400);
  });

  it("permanently deletes only entries that are already in the trash", async () => {
    await api("POST", "/api/files/write", {
      path: "/Documents/old.txt",
      content: "x",
    });
    const refused = await api("POST", "/api/files/purge", {
      path: "/Documents/old.txt",
    });
    expect(refused.status).toBe(403);

    const trashed = data(
      await api("POST", "/api/files/delete", { path: "/Documents/old.txt" }),
    );
    const purged = await api("POST", "/api/files/purge", {
      path: trashed["trashedTo"],
    });
    expect(purged.status).toBe(200);
    const trash = data(await api("GET", "/api/files/trash"))[
      "entries"
    ] as unknown[];
    expect(trash).toHaveLength(0);
  });

  it("reports the platform home directory in its health payload", async () => {
    const payload = data(await api("GET", "/api/health"));
    expect(payload["home"]).toBe(root);
  });

  it("exposes the system log", async () => {
    const logs = data(await api("GET", "/api/system/logs"))["entries"] as {
      scope: string;
      message: string;
    }[];
    expect(
      logs.some((entry) => entry.message === "storage namespace ready"),
    ).toBe(true);
  });
});

describe("HTTP transport", () => {
  let server: PlatformServer | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it("serves the API over HTTP and streams events over SSE", async () => {
    server = createPlatformServer({ platform, logger: platform.logger });
    const { url } = await server.listen({ port: 0, host: "127.0.0.1" });

    const response = await fetch(`${url}/api/health`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      ok: boolean;
      data: { status: string };
    };
    expect(body.data.status).toBe("ok");

    const controller = new AbortController();
    const events = await fetch(`${url}/api/events`, {
      signal: controller.signal,
    });
    expect(events.headers.get("content-type")).toContain("text/event-stream");
    const reader = events.body?.getReader();
    expect(reader).toBeDefined();
    platform.notifications.publish({ title: "streaming", body: "hello" });
    // The first chunk is the stream preamble; keep reading until the event we
    // published arrives (and give up after a bounded number of reads).
    let text = "";
    for (
      let attempt = 0;
      attempt < 10 && !text.includes("notifications.published");
      attempt += 1
    ) {
      const chunk = await reader?.read();
      text += new TextDecoder().decode(chunk?.value);
    }
    expect(text).toContain("event: notifications.published");
    controller.abort();
  });

  it("rejects oversized request bodies", async () => {
    server = createPlatformServer({
      platform,
      logger: platform.logger,
      maxBodyBytes: 64,
    });
    const { url } = await server.listen({ port: 0, host: "127.0.0.1" });
    const response = await fetch(`${url}/api/files/write`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        path: "/Documents/x.txt",
        content: "y".repeat(500),
      }),
    });
    expect(response.status).toBe(413);
  });
});
