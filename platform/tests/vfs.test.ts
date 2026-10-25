import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createVirtualFileSystem } from "../src/kernel/vfs.ts";
import type { VirtualFileSystem } from "../src/kernel/vfs.ts";

let root: string;
let vfs: VirtualFileSystem;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "reaos-vfs-"));
  vfs = createVirtualFileSystem({ root });
  const prepared = await vfs.ensureLayout();
  expect(prepared.ok).toBe(true);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("virtual filesystem namespace", () => {
  it("creates the standard home layout on first boot", async () => {
    const listing = await vfs.list("/");
    expect(listing.ok).toBe(true);
    if (!listing.ok) return;
    const names = listing.value.entries.map((entry) => entry.name).sort();
    expect(names).toEqual([
      ".Trash",
      "Desktop",
      "Documents",
      "Downloads",
      "Pictures",
      "System",
    ]);
    expect(
      listing.value.entries.every((entry) => entry.kind === "directory"),
    ).toBe(true);
  });

  it("rejects parent-directory traversal", async () => {
    const result = await vfs.readText("/Documents/../../etc/passwd");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("INVALID_ARGUMENT");
  });

  it("treats absolute paths as virtual paths inside the platform root", async () => {
    // "/etc/passwd" must mean "<root>/etc/passwd", never the host file.
    const resolved = await vfs.resolve("/etc/passwd");
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.value).toBe(join(root, "etc", "passwd"));
      expect(resolved.value.startsWith(root)).toBe(true);
    }
    const hostRead = await vfs.readText("/../../../etc/passwd");
    expect(hostRead.ok).toBe(false);
  });

  it("does not follow a symlink that escapes the root", async () => {
    const outside = await mkdtemp(join(tmpdir(), "reaos-outside-"));
    try {
      await writeFile(join(outside, "secret.txt"), "top secret", "utf8");
      await symlink(outside, join(root, "Documents", "link"), "dir");
      const read = await vfs.readText("/Documents/link/secret.txt");
      expect(read.ok).toBe(false);
      if (!read.ok) expect(read.error.code).toBe("PERMISSION_DENIED");
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("writes and reads text atomically without leaving temp files", async () => {
    const written = await vfs.writeText(
      "/Documents/note.txt",
      "hello platform",
    );
    expect(written.ok).toBe(true);
    const read = await vfs.readText("/Documents/note.txt");
    expect(read.ok && read.value).toBe("hello platform");

    const second = await vfs.writeText("/Documents/note.txt", "replaced");
    expect(second.ok).toBe(true);
    const listing = await vfs.list("/Documents");
    expect(listing.ok).toBe(true);
    if (!listing.ok) return;
    expect(listing.value.entries.map((entry) => entry.name)).toEqual([
      "note.txt",
    ]);
  });

  it("refuses to overwrite when overwrite is disabled", async () => {
    await vfs.writeText("/Documents/keep.txt", "first");
    const second = await vfs.writeText("/Documents/keep.txt", "second", {
      overwrite: false,
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.code).toBe("ALREADY_EXISTS");
  });

  it("reports NOT_FOUND for missing entries and refuses root deletion", async () => {
    const missing = await vfs.stat("/Documents/missing.txt");
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error.code).toBe("NOT_FOUND");

    const removeRoot = await vfs.remove("/", { recursive: true });
    expect(removeRoot.ok).toBe(false);
  });

  it("bounds read size and listing size", async () => {
    const small = createVirtualFileSystem({ root, maxReadBytes: 8 });
    await vfs.writeText("/Documents/big.txt", "0123456789");
    const read = await small.readText("/Documents/big.txt");
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.error.code).toBe("LIMIT_EXCEEDED");

    for (const name of ["a.txt", "b.txt", "c.txt"])
      await vfs.writeText(`/Documents/${name}`, "x");
    const bounded = createVirtualFileSystem({ root, maxListEntries: 2 });
    const listing = await bounded.list("/Documents");
    expect(listing.ok).toBe(true);
    if (!listing.ok) return;
    expect(listing.value.entries).toHaveLength(2);
    expect(listing.value.truncated).toBe(true);
  });

  it("sorts directories before files using locale-independent order", async () => {
    await vfs.writeText("/Documents/aaa.txt", "x");
    await vfs.mkdir("/Documents/zzz-folder");
    const listing = await vfs.list("/Documents");
    expect(listing.ok).toBe(true);
    if (!listing.ok) return;
    expect(listing.value.entries[0]?.name).toBe("zzz-folder");
  });

  it("moves entries and recreates nested directories", async () => {
    await vfs.writeText("/Documents/draft.txt", "draft");
    const moved = await vfs.move("/Documents/draft.txt", "/Desktop/draft.txt");
    expect(moved.ok).toBe(true);
    const read = await vfs.readText("/Desktop/draft.txt");
    expect(read.ok && read.value).toBe("draft");

    const nested = await vfs.mkdir("/Documents/projects/2026", {
      recursive: true,
    });
    expect(nested.ok).toBe(true);
    const listing = await vfs.list("/Documents/projects");
    expect(
      listing.ok && listing.value.entries.map((entry) => entry.name),
    ).toEqual(["2026"]);
  });

  it("never overwrites an existing destination when moving", async () => {
    await vfs.writeText("/Documents/a.txt", "a");
    await vfs.writeText("/Documents/b.txt", "b");
    const conflict = await vfs.move("/Documents/a.txt", "/Documents/b.txt");
    expect(conflict.ok).toBe(false);
    if (!conflict.ok) expect(conflict.error.code).toBe("ALREADY_EXISTS");
    const kept = await vfs.readText("/Documents/b.txt");
    expect(kept.ok && kept.value).toBe("b");

    const same = await vfs.move("/Documents/a.txt", "/Documents/a.txt");
    expect(same.ok).toBe(false);
  });

  it("reports invalid argument for malformed paths", async () => {
    const result = await vfs.stat("bad\0path");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_ARGUMENT");
  });

  it("rejects paths longer than the configured limit", async () => {
    const tiny = createVirtualFileSystem({ root, maxPathLength: 16 });
    const result = await tiny.stat(`/${"a".repeat(64)}`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("LIMIT_EXCEEDED");
  });
});
