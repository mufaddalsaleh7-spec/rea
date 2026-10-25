import type { PlatformError } from "../core/errors.ts";
import type { Result } from "../core/result.ts";
import { ok } from "../core/result.ts";
import type { AppManifest } from "./apps.ts";
import type { AppsService } from "./apps.ts";
import type { FilesService } from "./files.ts";

/**
 * Unified search for the launcher (Spotlight-style surface).
 *
 * Applications and files are searched separately — applications from the static
 * catalog, files from the real filesystem — then merged into one ranked list.
 * Application results always rank above equally-scored file results because a
 * launch is the more common intent.
 */

export type LaunchResult =
  | {
      readonly kind: "app";
      readonly id: string;
      readonly title: string;
      readonly subtitle: string;
      readonly glyph: string;
      readonly score: number;
      readonly app: AppManifest;
    }
  | {
      readonly kind: "file";
      readonly id: string;
      readonly title: string;
      readonly subtitle: string;
      readonly glyph: string;
      readonly score: number;
      readonly path: string;
    };

export type LauncherService = {
  readonly search: (
    query: string,
    limit?: number,
  ) => Promise<Result<readonly LaunchResult[], PlatformError>>;
};

export type LauncherServiceOptions = {
  readonly apps: AppsService;
  readonly files: FilesService;
  readonly fileLimit?: number;
};

export const createLauncherService = (
  options: LauncherServiceOptions,
): LauncherService => {
  const fileLimit = options.fileLimit ?? 12;

  return {
    search: async (query, limit = 20) => {
      const trimmed = query.trim();
      if (trimmed.length === 0) return ok([]);
      const needle = trimmed.toLowerCase();

      const appHits: LaunchResult[] = options.apps
        .list()
        .map((app) => ({ app, score: appScore(app, needle) }))
        .filter((hit) => hit.score > 0)
        .map((hit) => ({
          kind: "app" as const,
          id: `app:${hit.app.id}`,
          title: hit.app.name,
          subtitle: hit.app.summary,
          glyph: hit.app.glyph,
          // +25 keeps apps ahead of files with comparable text matches.
          score: hit.score + 25,
          app: hit.app,
        }));

      const fileSearch = await options.files.search(trimmed, fileLimit);
      if (!fileSearch.ok) return fileSearch;
      const fileHits: LaunchResult[] = fileSearch.value.map((entry) => ({
        kind: "file",
        id: `file:${entry.path}`,
        title: entry.name,
        subtitle: entry.parent,
        glyph: entry.kind === "directory" ? "▸" : "≡",
        score: entry.score,
        path: entry.path,
      }));

      const merged = [...appHits, ...fileHits].sort(
        (a, b) => b.score - a.score || compareResultTitles(a, b),
      );
      return ok(merged.slice(0, limit));
    },
  };
};

const appScore = (app: AppManifest, needle: string): number => {
  const name = app.name.toLowerCase();
  if (name === needle) return 100;
  if (name.startsWith(needle)) return 80;
  if (name.includes(needle)) return 55;
  if (app.summary.toLowerCase().includes(needle)) return 25;
  return 0;
};

const compareResultTitles = (a: LaunchResult, b: LaunchResult): number =>
  a.title < b.title ? -1 : a.title > b.title ? 1 : 0;
