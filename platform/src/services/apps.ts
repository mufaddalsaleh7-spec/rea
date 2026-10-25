import type { Capability } from "../core/permissions.ts";

/**
 * Built-in application catalog.
 *
 * An application manifest describes what the desktop shell can launch and which
 * capabilities that application receives. The catalog is the single owner of
 * app identity: the dock, the launcher, the window manager and the permission
 * broker all read it instead of hard-coding names.
 */

export type AppKind = "native" | "host";

export type AppManifest = {
  readonly id: string;
  readonly name: string;
  readonly summary: string;
  /** Two-letter glyph rendered by the dock (no proprietary icon artwork). */
  readonly glyph: string;
  readonly kind: AppKind;
  readonly capabilities: readonly Capability[];
  readonly defaultWindow: { readonly width: number; readonly height: number };
  /** Shell module name that renders inside a window. */
  readonly module: string;
};

export const BUILT_IN_APPS: readonly AppManifest[] = [
  {
    id: "files",
    name: "Files",
    summary: "Browse, search and organise your documents",
    glyph: "Fi",
    kind: "native",
    capabilities: ["fs:read", "fs:write"],
    defaultWindow: { width: 900, height: 580 },
    module: "files",
  },
  {
    id: "editor",
    name: "TextEdit",
    summary: "Write and edit plain text documents",
    glyph: "Tx",
    kind: "native",
    capabilities: ["fs:read", "fs:write"],
    defaultWindow: { width: 760, height: 540 },
    module: "editor",
  },
  {
    id: "terminal",
    name: "Terminal",
    summary: "Run approved commands inside the platform sandbox",
    glyph: ">_",
    kind: "native",
    capabilities: ["fs:read", "process:spawn"],
    defaultWindow: { width: 760, height: 460 },
    module: "terminal",
  },
  {
    id: "monitor",
    name: "Activity",
    summary: "Live CPU, memory and load for the host",
    glyph: "Ac",
    kind: "native",
    capabilities: ["system:info"],
    defaultWindow: { width: 720, height: 500 },
    module: "monitor",
  },
  {
    id: "settings",
    name: "Settings",
    summary: "Appearance, privacy and system preferences",
    glyph: "⚙",
    kind: "native",
    capabilities: ["settings:write", "system:info", "notifications:publish"],
    defaultWindow: { width: 780, height: 560 },
    module: "settings",
  },
  {
    id: "console",
    name: "Console",
    summary: "System log emitted by platform services",
    glyph: "⋮≡",
    kind: "native",
    capabilities: ["system:info"],
    defaultWindow: { width: 820, height: 480 },
    module: "console",
  },
];

export type AppsService = {
  readonly list: () => readonly AppManifest[];
  readonly get: (id: string) => AppManifest | undefined;
};

export const createAppsService = (
  apps: readonly AppManifest[] = BUILT_IN_APPS,
): AppsService => {
  const byId = new Map(apps.map((app) => [app.id, app]));
  return {
    list: () => apps,
    get: (id) => byId.get(id),
  };
};
