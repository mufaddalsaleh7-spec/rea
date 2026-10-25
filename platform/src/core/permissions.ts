import type { PlatformError } from "./errors.ts";
import { platformError } from "./errors.ts";
import type { Result } from "./result.ts";
import { err, ok } from "./result.ts";

/**
 * Capability-based permissions.
 *
 * ReaOS applications are granted capabilities at launch time, never ambient
 * authority. Every privileged operation (reading files, writing files, spawning
 * a process, changing settings, publishing notifications) asks the broker for
 * the matching capability, and the broker denies anything that was not
 * explicitly granted.
 */

export const CAPABILITIES = [
  "fs:read",
  "fs:write",
  "process:spawn",
  "settings:write",
  "notifications:publish",
  "system:info",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

export type PermissionBroker = {
  readonly granted: () => readonly Capability[];
  readonly has: (capability: Capability) => boolean;
  /** Grant/revoke without throwing; unknown capabilities are rejected. */
  readonly setGranted: (
    capabilities: readonly Capability[],
  ) => readonly Capability[];
  readonly grant: (capability: Capability) => void;
  readonly revoke: (capability: Capability) => void;
  /** Deny-by-default check used by services. */
  readonly check: (capability: Capability) => Result<void, PlatformError>;
  readonly subscribe: (
    listener: (granted: readonly Capability[]) => void,
  ) => () => void;
};

export const isCapability = (value: unknown): value is Capability =>
  typeof value === "string" &&
  (CAPABILITIES as readonly string[]).includes(value);

export const createPermissionBroker = (
  initial: readonly Capability[] = [],
): PermissionBroker => {
  const granted = new Set<Capability>(initial.filter(isCapability));
  const listeners = new Set<(granted: readonly Capability[]) => void>();

  const snapshot = (): readonly Capability[] =>
    CAPABILITIES.filter((capability) => granted.has(capability));

  const notify = (): void => {
    const current = snapshot();
    for (const listener of [...listeners]) listener(current);
  };

  return {
    granted: snapshot,
    has: (capability) => granted.has(capability),
    setGranted: (capabilities) => {
      granted.clear();
      for (const capability of capabilities)
        if (isCapability(capability)) granted.add(capability);
      notify();
      return snapshot();
    },
    grant: (capability) => {
      if (!isCapability(capability) || granted.has(capability)) return;
      granted.add(capability);
      notify();
    },
    revoke: (capability) => {
      if (!granted.delete(capability)) return;
      notify();
    },
    check: (capability) =>
      granted.has(capability)
        ? ok(undefined)
        : err(
            platformError(
              "PERMISSION_DENIED",
              `This action requires the "${capability}" capability.`,
              { capability },
            ),
          ),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};
