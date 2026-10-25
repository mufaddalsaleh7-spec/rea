import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { EventBus } from "../core/events.ts";
import type { PlatformError } from "../core/errors.ts";
import { fromUnknownError, platformError } from "../core/errors.ts";
import type { Logger } from "../core/logging.ts";
import type { Result } from "../core/result.ts";
import { err, ok } from "../core/result.ts";

/**
 * System settings.
 *
 * Settings are validated field by field, persisted atomically, and published as
 * a `settings.changed` event so the desktop shell and the permission broker can
 * react (for example, disabling the terminal revokes `process:spawn`).
 */

export const THEMES = ["light", "dark", "auto"] as const;
export const ACCENTS = [
  "aurora",
  "ember",
  "tide",
  "violet",
  "graphite",
] as const;
export const WALLPAPERS = ["dawn", "dusk", "forest", "slate", "paper"] as const;

export type ThemeMode = (typeof THEMES)[number];
export type AccentName = (typeof ACCENTS)[number];
export type WallpaperName = (typeof WALLPAPERS)[number];

export type Settings = {
  readonly displayName: string;
  readonly theme: ThemeMode;
  readonly accent: AccentName;
  readonly wallpaper: WallpaperName;
  readonly dockSize: number;
  readonly reduceMotion: boolean;
  readonly showSeconds: boolean;
  readonly terminalEnabled: boolean;
  readonly notificationsEnabled: boolean;
};

export const DEFAULT_SETTINGS: Settings = {
  displayName: "REA User",
  theme: "dark",
  accent: "aurora",
  wallpaper: "dawn",
  dockSize: 56,
  reduceMotion: false,
  showSeconds: false,
  terminalEnabled: false,
  notificationsEnabled: true,
};

export type SettingsService = {
  readonly load: () => Promise<Result<void, PlatformError>>;
  readonly current: () => Settings;
  readonly update: (
    patch: Readonly<Record<string, unknown>>,
  ) => Promise<Result<Settings, PlatformError>>;
  readonly reset: () => Promise<Result<Settings, PlatformError>>;
  readonly filePath: string;
};

export type SettingsServiceOptions = {
  readonly filePath: string;
  readonly bus: EventBus;
  readonly logger?: Logger;
};

const SETTING_KEYS = Object.keys(
  DEFAULT_SETTINGS,
) as readonly (keyof Settings)[];

const isOneOf = <T extends string>(
  values: readonly T[],
  value: unknown,
): value is T =>
  typeof value === "string" && (values as readonly string[]).includes(value);

const validateField = (
  key: keyof Settings,
  value: unknown,
): Result<Settings[keyof Settings], PlatformError> => {
  const invalid = (expectation: string): Result<never, PlatformError> =>
    err(
      platformError("INVALID_ARGUMENT", `"${key}" must be ${expectation}.`, {
        setting: key,
      }),
    );
  switch (key) {
    case "displayName":
      return typeof value === "string" &&
        value.trim().length > 0 &&
        value.length <= 40
        ? ok(value.trim())
        : invalid("a name between 1 and 40 characters");
    case "theme":
      return isOneOf(THEMES, value)
        ? ok(value)
        : invalid(`one of ${THEMES.join(", ")}`);
    case "accent":
      return isOneOf(ACCENTS, value)
        ? ok(value)
        : invalid(`one of ${ACCENTS.join(", ")}`);
    case "wallpaper":
      return isOneOf(WALLPAPERS, value)
        ? ok(value)
        : invalid(`one of ${WALLPAPERS.join(", ")}`);
    case "dockSize":
      return typeof value === "number" &&
        Number.isFinite(value) &&
        value >= 40 &&
        value <= 96
        ? ok(Math.round(value))
        : invalid("a number between 40 and 96");
    case "reduceMotion":
    case "showSeconds":
    case "terminalEnabled":
    case "notificationsEnabled":
      return typeof value === "boolean" ? ok(value) : invalid("true or false");
    default:
      return invalid("a known setting");
  }
};

export const createSettingsService = (
  options: SettingsServiceOptions,
): SettingsService => {
  let current: Settings = DEFAULT_SETTINGS;
  const filePath = options.filePath;

  const persist = async (
    settings: Settings,
  ): Promise<Result<void, PlatformError>> => {
    try {
      await mkdir(dirname(filePath), { recursive: true });
      const temporary = `${filePath}.${process.pid}.tmp`;
      await writeFile(
        temporary,
        `${JSON.stringify(settings, null, 2)}\n`,
        "utf8",
      );
      await rename(temporary, filePath);
      return ok(undefined);
    } catch (cause) {
      return err(
        fromUnknownError(cause, "System settings could not be saved."),
      );
    }
  };

  const apply = async (
    next: Settings,
  ): Promise<Result<Settings, PlatformError>> => {
    const previous = current;
    const saved = await persist(next);
    if (!saved.ok) return saved;
    current = next;
    options.bus.emit("settings.changed", { previous, next });
    options.logger?.info("settings updated", {
      keys: changedKeys(previous, next),
    });
    return ok(next);
  };

  const parse = (raw: string): Result<Settings, PlatformError> => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (cause) {
      return err(
        fromUnknownError(cause, "System settings are not valid JSON."),
      );
    }
    if (typeof parsed !== "object" || parsed === null)
      return err(
        platformError("INVALID_ARGUMENT", "System settings must be an object."),
      );
    // Settings are forward/backward compatible: unknown keys are ignored and
    // missing keys fall back to defaults, so an older file still boots.
    const candidate: Record<string, unknown> = {};
    for (const key of SETTING_KEYS) {
      const value = (parsed as Record<string, unknown>)[key];
      if (value === undefined) {
        candidate[key] = DEFAULT_SETTINGS[key];
        continue;
      }
      const validated = validateField(key, value);
      if (!validated.ok) return validated;
      candidate[key] = validated.value;
    }
    return ok(candidate as unknown as Settings);
  };

  return {
    filePath,
    current: () => current,
    load: async () => {
      try {
        const raw = await readFile(filePath, "utf8");
        const parsed = parse(raw);
        if (!parsed.ok) {
          // A corrupt settings file must not block boot: fall back to defaults
          // and report the problem instead of silently discarding it.
          options.logger?.error(
            "settings could not be parsed; using defaults",
            {
              reason: parsed.error.message,
            },
          );
          current = DEFAULT_SETTINGS;
          return parsed;
        }
        current = parsed.value;
        return ok(undefined);
      } catch (cause) {
        const code = (cause as { code?: string }).code;
        if (code === "ENOENT") {
          const seeded = await apply(DEFAULT_SETTINGS);
          return seeded.ok ? ok(undefined) : seeded;
        }
        return err(
          fromUnknownError(cause, "System settings could not be loaded."),
        );
      }
    },
    update: async (patch) => {
      const unknownKeys = Object.keys(patch).filter(
        (key) => !SETTING_KEYS.includes(key as keyof Settings),
      );
      if (unknownKeys.length > 0)
        return err(
          platformError(
            "INVALID_ARGUMENT",
            `Unknown setting(s): ${unknownKeys.join(", ")}.`,
            {
              unknownKeys,
            },
          ),
        );
      const candidate: Record<string, unknown> = { ...current };
      for (const [key, value] of Object.entries(patch)) {
        const validated = validateField(key as keyof Settings, value);
        if (!validated.ok) return validated;
        candidate[key] = validated.value;
      }
      return apply(candidate as unknown as Settings);
    },
    reset: async () => apply(DEFAULT_SETTINGS),
  };
};

const changedKeys = (previous: Settings, next: Settings): readonly string[] =>
  SETTING_KEYS.filter((key) => previous[key] !== next[key]);
