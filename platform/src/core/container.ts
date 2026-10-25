import type { PlatformError } from "./errors.ts";
import { platformError } from "./errors.ts";
import type { Result } from "./result.ts";
import { err, ok } from "./result.ts";

/**
 * Minimal dependency-ordered service container.
 *
 * ReaOS boots services in dependency order and shuts them down in reverse, so a
 * failing start leaves nothing half-initialised. Dependency cycles and duplicate
 * registrations are rejected at registration time rather than at boot.
 */

export type Service = {
  readonly name: string;
  /** Names of services that must be running before this one starts. */
  readonly dependsOn: readonly string[];
  readonly start: () => Promise<Result<void, PlatformError>>;
  /** Must tolerate being called when `start` only partially completed. */
  readonly stop?: () => Promise<void>;
};

export type ServiceContainer = {
  readonly register: (service: Service) => Result<void, PlatformError>;
  readonly start: () => Promise<Result<readonly string[], PlatformError>>;
  readonly stop: () => Promise<void>;
  readonly isRunning: (name: string) => boolean;
  readonly order: () => readonly string[];
};

export const createServiceContainer = (): ServiceContainer => {
  const services = new Map<string, Service>();
  const started: string[] = [];

  const detectCycle = (): readonly string[] | undefined => {
    const visiting = new Set<string>();
    const done = new Set<string>();
    const path: string[] = [];
    const visit = (name: string): readonly string[] | undefined => {
      if (done.has(name)) return undefined;
      if (visiting.has(name)) return [...path.slice(path.indexOf(name)), name];
      visiting.add(name);
      path.push(name);
      for (const dependency of services.get(name)?.dependsOn ?? []) {
        if (!services.has(dependency)) continue;
        const cycle = visit(dependency);
        if (cycle !== undefined) return cycle;
      }
      path.pop();
      visiting.delete(name);
      done.add(name);
      return undefined;
    };
    for (const name of services.keys()) {
      const cycle = visit(name);
      if (cycle !== undefined) return cycle;
    }
    return undefined;
  };

  return {
    register: (service) => {
      if (services.has(service.name))
        return err(
          platformError(
            "CONFLICT",
            `Service "${service.name}" is already registered.`,
          ),
        );
      const missing = service.dependsOn.filter((name) => !services.has(name));
      if (missing.length > 0)
        return err(
          platformError(
            "INVALID_ARGUMENT",
            `Service "${service.name}" depends on unregistered service(s): ${missing.join(", ")}.`,
          ),
        );
      services.set(service.name, service);
      const cycle = detectCycle();
      if (cycle !== undefined) {
        services.delete(service.name);
        return err(
          platformError(
            "INVALID_ARGUMENT",
            `Dependency cycle: ${cycle.join(" -> ")}.`,
          ),
        );
      }
      return ok(undefined);
    },

    start: async () => {
      const pending = new Set(services.keys());
      const failed: string[] = [];
      while (pending.size > 0) {
        const ready = [...pending].filter((name) =>
          (services.get(name)?.dependsOn ?? []).every(
            (dependency) =>
              started.includes(dependency) || !services.has(dependency),
          ),
        );
        if (ready.length === 0)
          return err(
            platformError(
              "CONFLICT",
              `Cannot resolve start order for: ${[...pending].join(", ")}.`,
            ),
          );
        for (const name of ready) {
          pending.delete(name);
          const service = services.get(name);
          if (service === undefined) continue;
          const result = await service.start();
          if (!result.ok) {
            failed.push(name);
            // Roll back everything that already started, newest first.
            for (const running of [...started].reverse()) {
              await services.get(running)?.stop?.();
            }
            started.length = 0;
            return err(
              platformError(
                "UNAVAILABLE",
                `Service "${name}" failed to start.`,
                {
                  cause: result.error,
                  failed,
                },
              ),
            );
          }
          started.push(name);
        }
      }
      return ok([...started]);
    },

    stop: async () => {
      for (const name of [...started].reverse()) {
        await services.get(name)?.stop?.();
      }
      started.length = 0;
    },

    isRunning: (name) => started.includes(name),
    order: () => [...started],
  };
};
