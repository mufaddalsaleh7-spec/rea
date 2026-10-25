import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createEventBus } from "../src/core/events.ts";
import { createPermissionBroker } from "../src/core/permissions.ts";
import type { PermissionBroker } from "../src/core/permissions.ts";
import { createVirtualFileSystem } from "../src/kernel/vfs.ts";
import type { VirtualFileSystem } from "../src/kernel/vfs.ts";
import { createFilesService } from "../src/services/files.ts";
import type { FilesService } from "../src/services/files.ts";

let root: string;
let vfs: VirtualFileSystem;
let permissions: PermissionBroker;
let files: FilesService;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "reaos-files-"));
  vfs = createVirtualFileSystem({ root });
  await vfs.ensureLayout();
  permissions = createPermissionBroker(["fs:read", "fs:write"]);
  files = createFilesService({
    vfs,
    permissions,
    bus: createEventBus(),
    clock: () => new Date("2026-01-02T03:04:05.000Z"),
  });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("files service", () => {
  it("requires capabilities for reads and writes", async () => {
    const locked = createFilesService({
      vfs,
      permissions: createPermissionBroker([]),
      bus: createEventBus(),
    });
    const read = await locked.list("/");
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.error.code).toBe("PERMISSION_DENIED");
    const write = await locked.writeText("/Documents/nope.txt", "x");
    expect(write.ok).toBe(false);
  });

  it("protects the system area from writes but allows reads", async () => {
    const write = await files.writeText("/System/hack.txt", "x");
    expect(write.ok).toBe(false);
    if (!write.ok) expect(write.error.code).toBe("PERMISSION_DENIED");
    const read = await files.list("/System");
    expect(read.ok).toBe(true);
  });

  it("moves deleted entries to the trash and can empty it", async () => {
    await files.writeText("/Documents/report.txt", "quarterly numbers");
    const trashed = await files.remove("/Documents/report.txt");
    expect(trashed.ok).toBe(true);
    if (!trashed.ok) return;
    expect(trashed.value.startsWith("/.Trash/")).toBe(true);

    const trash = await files.listTrash();
    expect(trash.ok).toBe(true);
    if (trash.ok) expect(trash.value.entries).toHaveLength(1);

    const moved = await files.readText(trashed.value);
    expect(moved.ok && moved.value).toBe("quarterly numbers");

    const emptied = await files.emptyTrash();
    expect(emptied.ok).toBe(true);
    if (emptied.ok) expect(emptied.value).toBe(1);
    const empty = await files.listTrash();
    expect(empty.ok && empty.value.entries).toHaveLength(0);
  });

  it("re-creates unique trash names for repeated deletes", async () => {
    await files.writeText("/Documents/same.txt", "one");
    const first = await files.remove("/Documents/same.txt");
    await files.writeText("/Documents/same.txt", "two");
    const second = await files.remove("/Documents/same.txt");
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.value).not.toBe(second.value);
    const entries = await files.listTrash();
    expect(entries.ok && entries.value.entries).toHaveLength(2);
  });

  it("refuses to trash the root and the trash directory itself", async () => {
    const rootRemove = await files.remove("/");
    expect(rootRemove.ok).toBe(false);
    const trashRemove = await files.remove("/.Trash");
    expect(trashRemove.ok).toBe(false);
  });

  it("renames within the namespace and refuses system-area renames", async () => {
    await files.writeText("/Documents/a.txt", "a");
    const renamed = await files.rename("/Documents/a.txt", "/Documents/b.txt");
    expect(renamed.ok).toBe(true);
    const blocked = await files.rename("/Documents/b.txt", "/System/b.txt");
    expect(blocked.ok).toBe(false);
  });

  it("finds files by name and excludes the trash", async () => {
    await files.createDirectory("/Documents/reports");
    await files.writeText("/Documents/reports/summary.txt", "x");
    await files.writeText("/Documents/trash-me.txt", "x");
    await files.remove("/Documents/trash-me.txt");

    const hits = await files.search("summary");
    expect(hits.ok).toBe(true);
    if (!hits.ok) return;
    expect(hits.value.map((hit) => hit.path)).toEqual([
      "/Documents/reports/summary.txt",
    ]);

    const trashHits = await files.search("trash-me");
    expect(trashHits.ok && trashHits.value).toHaveLength(0);
  });

  it("returns an empty result for a blank query", async () => {
    const hits = await files.search("   ");
    expect(hits.ok && hits.value).toHaveLength(0);
  });
});
