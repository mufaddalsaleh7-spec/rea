import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ok } from "../src/core/result.ts";
import { createProcessHost } from "../src/kernel/processHost.ts";
import type { ProcessHost } from "../src/kernel/processHost.ts";

let root: string;
let host: ProcessHost;
const finished: string[] = [];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "reaos-process-"));
  await mkdir(join(root, "Documents"), { recursive: true });
  finished.length = 0;
  host = createProcessHost({
    allowedCommands: ["node"],
    homeCwd: root,
    resolveCwd: async (path) => ok(join(root, path.replace(/^\//u, ""))),
    defaultTimeoutMs: 4000,
    maxOutputBytes: 256,
    onFinished: (result) => finished.push(result.command),
  });
});

afterEach(async () => {
  await host.shutdown();
  await rm(root, { recursive: true, force: true });
});

describe("process host", () => {
  it("refuses commands that are not on the allowlist", async () => {
    const attempt = await host.exec({ command: "sh", args: ["-c", "echo hi"] });
    expect(attempt.ok).toBe(false);
    if (!attempt.ok) expect(attempt.error.code).toBe("PERMISSION_DENIED");
    expect(host.running()).toBe(0);
  });

  it("runs an allowed command without a shell and captures output", async () => {
    const result = await host.exec({
      command: "node",
      args: ["-e", "process.stdout.write('platform-ok')"],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.exitCode).toBe(0);
    expect(result.value.stdout).toBe("platform-ok");
    expect(result.value.timedOut).toBe(false);
    expect(finished).toEqual(["node"]);
  });

  it("does not expand shell syntax in arguments", async () => {
    const result = await host.exec({
      command: "node",
      args: [
        "-e",
        "process.stdout.write(process.argv.slice(1).join(' '))",
        "$(whoami)",
        "; rm -rf /",
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.stdout).toBe("$(whoami) ; rm -rf /");
  });

  it("kills a command that exceeds its timeout", async () => {
    const result = await host.exec({
      command: "node",
      args: ["-e", "setTimeout(() => {}, 30000)"],
      timeoutMs: 150,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.timedOut).toBe(true);
    expect(result.value.exitCode).toBeNull();
    expect(result.value.signal).toBe("SIGKILL");
  });

  it("caps captured output and marks the result as truncated", async () => {
    const result = await host.exec({
      command: "node",
      args: ["-e", "process.stdout.write('x'.repeat(5000))"],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.stdout.length).toBe(256);
    expect(result.value.truncated).toBe(true);
  });

  it("reports a non-zero exit without failing the call", async () => {
    const result = await host.exec({
      command: "node",
      args: ["-e", "process.exit(3)"],
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.exitCode).toBe(3);
  });

  it("rejects invalid arguments and runs commands in the requested directory", async () => {
    const invalid = await host.exec({ command: "node", args: ["bad\0arg"] });
    expect(invalid.ok).toBe(false);

    const cwd = await host.exec({
      command: "node",
      args: ["-e", "process.stdout.write(process.cwd())"],
      cwd: "/Documents",
    });
    expect(cwd.ok).toBe(true);
    if (cwd.ok) expect(cwd.value.stdout.startsWith(root)).toBe(true);
  });

  it("removes finished commands from the running set", async () => {
    await host.exec({ command: "node", args: ["-e", "0"] });
    expect(host.running()).toBe(0);
    expect(host.allowedCommands()).toEqual(["node"]);
  });
});
