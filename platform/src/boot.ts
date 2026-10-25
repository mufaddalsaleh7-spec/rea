import { homedir } from "node:os";
import { join, resolve } from "node:path";

import type { PlatformError } from "./core/errors.ts";
import { platformError } from "./core/errors.ts";
import type { EventBus } from "./core/events.ts";
import { createEventBus } from "./core/events.ts";
import type { Logger } from "./core/logging.ts";
import { createLogger } from "./core/logging.ts";
import type { Capability, PermissionBroker } from "./core/permissions.ts";
import { createPermissionBroker } from "./core/permissions.ts";
import type { Result } from "./core/result.ts";
import { err, ok } from "./core/result.ts";
import { createServiceContainer } from "./core/container.ts";
import type { VirtualFileSystem } from "./kernel/vfs.ts";
import { createVirtualFileSystem } from "./kernel/vfs.ts";
import type { ProcessHost } from "./kernel/processHost.ts";
import { createProcessHost } from "./kernel/processHost.ts";
import type { SystemInfoProbe } from "./kernel/systemInfo.ts";
import { createSystemInfoProbe } from "./kernel/systemInfo.ts";
import type { AppsService } from "./services/apps.ts";
import { createAppsService } from "./services/apps.ts";
import type { FilesService } from "./services/files.ts";
import { createFilesService } from "./services/files.ts";
import type { LauncherService } from "./services/launcher.ts";
import { createLauncherService } from "./services/launcher.ts";
import type { NotificationCenter } from "./services/notifications.ts";
import { createNotificationCenter } from "./services/notifications.ts";
import type { SettingsService } from "./services/settings.ts";
import { createSettingsService } from "./services/settings.ts";

/**
 * Platform composition root.
 *
 * Boot order is explicit and dependency ordered: storage namespace, settings,
 * capabilities, then the services that depend on them. A failure at any stage
 * stops the boot and reports the failing stage; nothing is left half-started.
 */

export const PLATFORM_VERSION = "0.1.0";

const BASE_CAPABILITIES: readonly Capability[] = [
  "fs:read",
  "fs:write",
  "settings:write",
  "notifications:publish",
  "system:info",
];

export const DEFAULT_ALLOWED_COMMANDS: readonly string[] = [
  "cat",
  "date",
  "df",
  "du",
  "echo",
  "env",
  "find",
  "grep",
  "head",
  "hostname",
  "ls",
  "node",
  "pwd",
  "sort",
  "stat",
  "tail",
  "uname",
  "uptime",
  "wc",
  "whoami",
];

export type Platform = {
  readonly version: string;
  readonly startedAt: string;
  readonly root: string;
  readonly events: EventBus;
  readonly logger: Logger;
  readonly vfs: VirtualFileSystem;
  readonly settings: SettingsService;
  readonly permissions: PermissionBroker;
  readonly files: FilesService;
  readonly apps: AppsService;
  readonly launcher: LauncherService;
  readonly notifications: NotificationCenter;
  readonly system: SystemInfoProbe;
  readonly processes: ProcessHost;
  readonly services: readonly string[];
  readonly shutdown: () => Promise<void>;
};

export type BootOptions = {
  /** Host directory backing the platform namespace. */
  readonly root?: string;
  readonly clock?: () => Date;
  readonly logger?: Logger;
  readonly allowedCommands?: readonly string[];
  readonly seedHome?: boolean;
};

export const defaultPlatformRoot = (): string =>
  resolve(process.env["REAOS_HOME"] ?? join(homedir(), ".reaos-home"));

export const bootPlatform = async (
  options: BootOptions = {},
): Promise<Result<Platform, PlatformError>> => {
  const root = resolve(options.root ?? defaultPlatformRoot());
  const clock = options.clock ?? (() => new Date());
  const logger = options.logger ?? createLogger({ scope: "reaos", clock });
  const events = createEventBus({ clock });
  events.onAny((event) =>
    logger.debug(`event ${event.topic}`, { payload: event.payload }),
  );

  const startedAt = clock().toISOString();
  const vfs = createVirtualFileSystem({ root });
  const container = createServiceContainer();
  const state: {
    settings?: SettingsService;
    permissions?: PermissionBroker;
    files?: FilesService;
    apps?: AppsService;
    launcher?: LauncherService;
    notifications?: NotificationCenter;
    system?: SystemInfoProbe;
    processes?: ProcessHost;
  } = {};

  const stage = (
    name: string,
    dependsOn: readonly string[],
    start: () => Promise<Result<void, PlatformError>>,
  ): void => {
    const registered = container.register({ name, dependsOn, start });
    if (!registered.ok) throw new Error(registered.error.message);
  };

  stage("filesystem", [], async () => {
    const layout = await vfs.ensureLayout();
    if (!layout.ok) return layout;
    logger.info("storage namespace ready", { root });
    return ok(undefined);
  });

  stage("settings", ["filesystem"], async () => {
    const settings = createSettingsService({
      filePath: join(root, "System", "settings.json"),
      bus: events,
      logger: logger.child("settings"),
    });
    const loaded = await settings.load();
    if (!loaded.ok) return loaded;
    state.settings = settings;
    return ok(undefined);
  });

  stage("permissions", ["settings"], async () => {
    const settings = state.settings;
    if (settings === undefined)
      return err(
        platformError("UNAVAILABLE", "Settings are unavailable during boot."),
      );
    const derive = (): readonly Capability[] =>
      settings.current().terminalEnabled
        ? [...BASE_CAPABILITIES, "process:spawn"]
        : BASE_CAPABILITIES;
    const permissions = createPermissionBroker(derive());
    permissions.subscribe((granted) =>
      events.emit("session.permissionsChanged", { granted }),
    );
    events.on("settings.changed", () => {
      permissions.setGranted(derive());
    });
    state.permissions = permissions;
    return ok(undefined);
  });

  stage("services", ["permissions"], async () => {
    const { settings, permissions } = state;
    if (settings === undefined || permissions === undefined)
      return err(
        platformError(
          "UNAVAILABLE",
          "Kernel services are unavailable during boot.",
        ),
      );

    const files = createFilesService({
      vfs,
      permissions,
      bus: events,
      clock,
    });
    const apps = createAppsService();
    const notifications = createNotificationCenter({
      bus: events,
      permissions,
      clock,
      logger: logger.child("notifications"),
    });
    const system = createSystemInfoProbe({ version: PLATFORM_VERSION, clock });
    const processes = createProcessHost({
      allowedCommands:
        options.allowedCommands ??
        allowedCommandsFromEnvironment() ??
        DEFAULT_ALLOWED_COMMANDS,
      homeCwd: join(root, "Documents"),
      resolveCwd: vfs.resolve,
      authorize: () => permissions.check("process:spawn"),
      clock: () => clock().getTime(),
      onStarted: ({ id, command }) =>
        events.emit("process.started", { id, command }),
      onFinished: (result) =>
        events.emit("process.finished", {
          id: result.id,
          command: result.command,
          exitCode: result.exitCode,
          durationMs: result.durationMs,
        }),
    });

    state.files = files;
    state.apps = apps;
    state.launcher = createLauncherService({ apps, files });
    state.notifications = notifications;
    state.system = system;
    state.processes = processes;

    if (options.seedHome !== false) await seedHomeDirectory(vfs, clock);
    return ok(undefined);
  });

  const started = await container.start();
  if (!started.ok) {
    await container.stop();
    logger.error("platform boot failed", { cause: started.error });
    return started;
  }

  const {
    settings,
    permissions,
    files,
    apps,
    launcher,
    notifications,
    system,
    processes,
  } = state;
  if (
    settings === undefined ||
    permissions === undefined ||
    files === undefined ||
    apps === undefined ||
    launcher === undefined ||
    notifications === undefined ||
    system === undefined ||
    processes === undefined
  ) {
    await container.stop();
    return err(
      platformError(
        "UNAVAILABLE",
        "Platform services were not fully composed.",
      ),
    );
  }

  events.emit("system.ready", { startedAt, version: PLATFORM_VERSION });
  if (settings.current().notificationsEnabled) {
    permissions.grant("notifications:publish");
    notifications.publish({
      title: "ReaOS is running",
      body: `Signed in as ${settings.current().displayName}. Open the launcher with Ctrl+Space.`,
      level: "success",
    });
  }
  logger.info("platform ready", {
    version: PLATFORM_VERSION,
    services: container.order(),
  });

  return ok({
    version: PLATFORM_VERSION,
    startedAt,
    root,
    events,
    logger,
    vfs,
    settings,
    permissions,
    files,
    apps,
    launcher,
    notifications,
    system,
    processes,
    services: container.order(),
    shutdown: async () => {
      await processes.shutdown();
      await container.stop();
      logger.info("platform stopped");
    },
  });
};

const allowedCommandsFromEnvironment = (): readonly string[] | undefined => {
  const raw = process.env["REAOS_ALLOWED_COMMANDS"];
  if (raw === undefined) return undefined;
  const parsed = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return parsed.length > 0 ? parsed : undefined;
};

/**
 * Seeds a readable home directory the first time the platform boots. Seeding is
 * skipped when the documents exist so user edits are never overwritten.
 */
const seedHomeDirectory = async (
  vfs: VirtualFileSystem,
  clock: () => Date,
): Promise<void> => {
  const welcome = "/Documents/Welcome.md";
  const existing = await vfs.stat(welcome);
  if (existing.ok) return;
  const stamp = clock().toISOString();
  await vfs.writeText(
    welcome,
    [
      "# Welcome to ReaOS",
      "",
      "ReaOS is an independent desktop platform built on the REA repository.",
      "Everything you see in the shell is backed by the services in this",
      "process: files, settings, notifications and the activity monitor all",
      "read real state.",
      "",
      "Try this:",
      "",
      "1. Open the launcher with Ctrl+Space and search for a file you created.",
      "2. Open Settings > Privacy to enable the Terminal, then run `ls`.",
      "3. Drag a window by its title bar and resize it from the lower-right corner.",
      "",
      `Created ${stamp}`,
      "",
    ].join("\n"),
  );
  await vfs.writeText("/Documents/Notes.txt", "Scratch notes\n");
};
