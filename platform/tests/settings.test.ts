import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createEventBus } from "../src/core/events.ts";
import { createSettingsService } from "../src/services/settings.ts";
import type { SettingsService } from "../src/services/settings.ts";
import { DEFAULT_SETTINGS } from "../src/services/settings.ts";

let root: string;
let filePath: string;
let bus: ReturnType<typeof createEventBus>;
let settings: SettingsService;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "reaos-settings-"));
  filePath = join(root, "System", "settings.json");
  bus = createEventBus();
  settings = createSettingsService({ filePath, bus });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("settings service", () => {
  it("seeds defaults on first load and persists them", async () => {
    const loaded = await settings.load();
    expect(loaded.ok).toBe(true);
    expect(settings.current()).toEqual(DEFAULT_SETTINGS);
    const raw = JSON.parse(await readFile(filePath, "utf8")) as Record<
      string,
      unknown
    >;
    expect(raw["theme"]).toBe("dark");
  });

  it("validates each field and rejects unknown keys", async () => {
    await settings.load();
    const badTheme = await settings.update({ theme: "neon" });
    expect(badTheme.ok).toBe(false);
    if (!badTheme.ok) expect(badTheme.error.code).toBe("INVALID_ARGUMENT");

    const badDock = await settings.update({ dockSize: 400 });
    expect(badDock.ok).toBe(false);

    const unknown = await settings.update({ rocketMode: true });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok)
      expect(unknown.error.details?.["unknownKeys"]).toEqual(["rocketMode"]);

    expect(settings.current()).toEqual(DEFAULT_SETTINGS);
  });

  it("persists a valid patch, emits one change event and survives reload", async () => {
    await settings.load();
    const listener = vi.fn();
    bus.on("settings.changed", listener);
    const updated = await settings.update({
      theme: "light",
      accent: "ember",
      dockSize: 61,
    });
    expect(updated.ok).toBe(true);
    if (updated.ok) {
      expect(updated.value.theme).toBe("light");
      expect(updated.value.dockSize).toBe(61);
    }
    expect(listener).toHaveBeenCalledTimes(1);

    const reloaded = createSettingsService({ filePath, bus });
    await reloaded.load();
    expect(reloaded.current().accent).toBe("ember");
    expect(reloaded.current().dockSize).toBe(61);
  });

  it("ignores unknown keys already stored in the file (forward compatibility)", async () => {
    await settings.load();
    await settings.update({ displayName: "Ada" });
    const raw = JSON.parse(await readFile(filePath, "utf8")) as Record<
      string,
      unknown
    >;
    raw["futureSetting"] = 42;
    await writeFile(filePath, JSON.stringify(raw), "utf8");

    const reloaded = createSettingsService({ filePath, bus });
    const loaded = await reloaded.load();
    expect(loaded.ok).toBe(true);
    expect(reloaded.current().displayName).toBe("Ada");
  });

  it("falls back to defaults when the stored file is corrupt, without deleting it", async () => {
    await settings.load();
    await writeFile(filePath, "{ not json", "utf8");
    const reloaded = createSettingsService({ filePath, bus });
    const loaded = await reloaded.load();
    expect(loaded.ok).toBe(false);
    expect(reloaded.current()).toEqual(DEFAULT_SETTINGS);
    expect(await readFile(filePath, "utf8")).toBe("{ not json");
  });

  it("resets to defaults on request", async () => {
    await settings.load();
    await settings.update({ theme: "light" });
    const reset = await settings.reset();
    expect(reset.ok).toBe(true);
    expect(settings.current()).toEqual(DEFAULT_SETTINGS);
  });
});
