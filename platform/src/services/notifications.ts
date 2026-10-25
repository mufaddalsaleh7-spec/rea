import { randomUUID } from "node:crypto";

import type { PlatformError } from "../core/errors.ts";
import { platformError } from "../core/errors.ts";
import type { EventBus, NotificationRecord } from "../core/events.ts";
import type { Logger } from "../core/logging.ts";
import type { PermissionBroker } from "../core/permissions.ts";
import type { Result } from "../core/result.ts";
import { err, ok } from "../core/result.ts";

/**
 * Notification centre.
 *
 * Services publish notifications through this module; the shell subscribes over
 * Server-Sent Events. Records are held in a bounded ring so a noisy producer
 * cannot grow memory, and dismissal is explicit state rather than a UI trick.
 */

export type NotificationCenter = {
  readonly publish: (input: {
    readonly title: string;
    readonly body: string;
    readonly level?: NotificationRecord["level"];
  }) => Result<NotificationRecord, PlatformError>;
  readonly list: () => readonly NotificationRecord[];
  readonly dismiss: (id: string) => Result<void, PlatformError>;
  readonly dismissAll: () => void;
  readonly subscribe: (
    listener: (record: NotificationRecord) => void,
  ) => () => void;
};

export type NotificationCenterOptions = {
  readonly bus: EventBus;
  readonly permissions: PermissionBroker;
  readonly logger?: Logger;
  readonly clock?: () => Date;
  readonly limit?: number;
};

export const createNotificationCenter = (
  options: NotificationCenterOptions,
): NotificationCenter => {
  const clock = options.clock ?? (() => new Date());
  const limit = options.limit ?? 50;
  const records: NotificationRecord[] = [];
  const listeners = new Set<(record: NotificationRecord) => void>();

  return {
    publish: ({ title, body, level }) => {
      const allowed = options.permissions.check("notifications:publish");
      if (!allowed.ok) return allowed;
      if (typeof title !== "string" || title.trim().length === 0)
        return err(
          platformError("INVALID_ARGUMENT", "A notification needs a title."),
        );
      const record: NotificationRecord = {
        id: randomUUID(),
        title: title.trim().slice(0, 120),
        body: body.trim().slice(0, 400),
        level: level ?? "info",
        createdAt: clock().toISOString(),
      };
      records.unshift(record);
      if (records.length > limit) records.length = limit;
      for (const listener of [...listeners]) listener(record);
      options.bus.emit("notifications.published", record);
      options.logger?.info("notification published", {
        title: record.title,
        level: record.level,
      });
      return ok(record);
    },

    list: () => [...records],

    dismiss: (id) => {
      const index = records.findIndex((record) => record.id === id);
      if (index < 0)
        return err(
          platformError(
            "NOT_FOUND",
            "That notification is no longer available.",
          ),
        );
      records.splice(index, 1);
      options.bus.emit("notifications.dismissed", { id });
      return ok(undefined);
    },

    dismissAll: () => {
      for (const record of records.splice(0, records.length)) {
        options.bus.emit("notifications.dismissed", { id: record.id });
      }
    },

    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};
