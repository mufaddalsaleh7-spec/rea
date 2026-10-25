import type { Platform } from "../boot.ts";
import type { PlatformError, PlatformErrorCode } from "../core/errors.ts";
import type { Result } from "../core/result.ts";
import { ok } from "../core/result.ts";

/**
 * The platform API.
 *
 * Requests are pure functions of `(platform, request)`: no HTTP objects are
 * needed, so the whole surface is testable without opening a socket. The HTTP
 * server below is only a transport adapter.
 *
 * Every response has one of two shapes:
 *   { ok: true,  data: ... }
 *   { ok: false, error: { code, message } }
 */

export type ApiRequest = {
  readonly method: string;
  readonly path: string;
  readonly query: Readonly<Record<string, string>>;
  readonly body: unknown;
};

export type ApiResponse = {
  readonly status: number;
  readonly body: unknown;
};

const STATUS_FOR_CODE: Readonly<Record<PlatformErrorCode, number>> = {
  INVALID_ARGUMENT: 400,
  NOT_FOUND: 404,
  ALREADY_EXISTS: 409,
  CONFLICT: 409,
  PERMISSION_DENIED: 403,
  LIMIT_EXCEEDED: 413,
  UNAVAILABLE: 503,
  IO_FAILURE: 500,
};

export const failure = (error: PlatformError): ApiResponse => ({
  status: STATUS_FOR_CODE[error.code] ?? 500,
  body: {
    ok: false,
    error: { code: error.code, message: error.message, details: error.details },
  },
});

/**
 * Validation failure raised by request helpers. The class deliberately avoids
 * TypeScript parameter properties so the platform runs under Node's native
 * strip-only TypeScript loader without a build step.
 */
export class RequestError extends Error {
  readonly platformError: PlatformError;

  constructor(platformError: PlatformError) {
    super(platformError.message);
    this.platformError = platformError;
  }
}

const bodyObject = (body: unknown): Record<string, unknown> => {
  if (typeof body !== "object" || body === null || Array.isArray(body))
    throw new RequestError({
      code: "INVALID_ARGUMENT",
      message: "A JSON object body is required.",
    });
  return body as Record<string, unknown>;
};

/** Required non-empty string field; throws a `RequestError` when missing. */
const field = (body: unknown, name: string): string => {
  const value = bodyObject(body)[name];
  if (typeof value !== "string" || value.length === 0)
    throw new RequestError({
      code: "INVALID_ARGUMENT",
      message: `Field "${name}" is required.`,
    });
  return value;
};

const NOTIFICATION_LEVELS = ["info", "success", "warning", "error"] as const;

const isNotificationLevel = (
  value: unknown,
): value is (typeof NOTIFICATION_LEVELS)[number] =>
  typeof value === "string" &&
  (NOTIFICATION_LEVELS as readonly string[]).includes(value);

const optionalString = (body: unknown, name: string): string | undefined => {
  const value = bodyObject(body)[name];
  return typeof value === "string" && value.length > 0 ? value : undefined;
};

export const handleApiRequest = async (
  platform: Platform,
  request: ApiRequest,
): Promise<ApiResponse> => {
  const respond = (data: unknown, status = 200): ApiResponse => ({
    status,
    body: { ok: true, data },
  });
  const guard = async <T>(
    task: () => Promise<Result<T, PlatformError>>,
  ): Promise<ApiResponse> => {
    try {
      const result = await task();
      return result.ok ? respond(result.value) : failure(result.error);
    } catch (cause) {
      // Validation helpers throw `RequestError`; without this catch a rejected
      // guard would escape the outer try/catch and turn a 400 into a 500.
      if (cause instanceof RequestError) return failure(cause.platformError);
      throw cause;
    }
  };

  try {
    const route = `${request.method.toUpperCase()} ${request.path}`;
    switch (route) {
      case "GET /api/health":
        return respond({
          status: "ok",
          version: platform.version,
          startedAt: platform.startedAt,
          home: platform.root,
          services: platform.services,
        });

      case "GET /api/capabilities":
        return respond({
          granted: platform.permissions.granted(),
          terminalEnabled: platform.settings.current().terminalEnabled,
          allowedCommands: platform.processes.allowedCommands(),
        });

      case "GET /api/system":
        return respond({
          facts: platform.system.facts(),
          metrics: platform.system.metrics(),
          platform: {
            version: platform.version,
            startedAt: platform.startedAt,
          },
        });

      case "GET /api/system/logs":
        return respond({ entries: platform.logger.entries() });

      case "GET /api/apps":
        return respond({ apps: platform.apps.list() });

      case "GET /api/settings":
        return respond({
          settings: platform.settings.current(),
          defaults: null,
        });

      case "PATCH /api/settings":
        return guard(() => platform.settings.update(bodyObject(request.body)));

      case "POST /api/settings/reset":
        return guard(() => platform.settings.reset());

      case "GET /api/files":
        return guard(() => platform.files.list(request.query["path"] ?? "/"));

      case "POST /api/files/read":
        return guard(async () => {
          const path = field(request.body, "path");
          const content = await platform.files.readText(path);
          return content.ok ? ok({ path, content: content.value }) : content;
        });

      case "POST /api/files/write":
        return guard(async () => {
          const path = field(request.body, "path");
          const content = bodyObject(request.body)["content"];
          if (typeof content !== "string")
            throw new RequestError({
              code: "INVALID_ARGUMENT",
              message: 'Field "content" must be a string.',
            });
          return platform.files.writeText(path, content);
        });

      case "POST /api/files/mkdir":
        return guard(async () =>
          platform.files.createDirectory(field(request.body, "path")),
        );

      case "POST /api/files/rename":
        return guard(async () =>
          platform.files.rename(
            field(request.body, "from"),
            field(request.body, "to"),
          ),
        );

      case "POST /api/files/delete":
        return guard(async () => {
          const trashed = await platform.files.remove(
            field(request.body, "path"),
          );
          return trashed.ok ? ok({ trashedTo: trashed.value }) : trashed;
        });

      case "POST /api/files/purge":
        return guard(async () => {
          const purged = await platform.files.purge(
            field(request.body, "path"),
          );
          return purged.ok ? ok({ purged: true }) : purged;
        });

      case "GET /api/files/trash":
        return guard(() => platform.files.listTrash());

      case "POST /api/files/trash/empty":
        return guard(async () => {
          const removed = await platform.files.emptyTrash();
          return removed.ok ? ok({ removed: removed.value }) : removed;
        });

      case "GET /api/search":
        return guard(() => platform.launcher.search(request.query["q"] ?? ""));

      case "GET /api/notifications":
        return respond({ notifications: platform.notifications.list() });

      case "POST /api/notifications": {
        const body = bodyObject(request.body);
        const published = platform.notifications.publish({
          title: field(body, "title"),
          body: typeof body["body"] === "string" ? body["body"] : "",
          level: isNotificationLevel(body["level"]) ? body["level"] : "info",
        });
        return published.ok
          ? respond(published.value, 201)
          : failure(published.error);
      }

      case "POST /api/notifications/dismiss": {
        const dismissed = platform.notifications.dismiss(
          field(request.body, "id"),
        );
        return dismissed.ok
          ? respond({ dismissed: true })
          : failure(dismissed.error);
      }

      case "POST /api/notifications/dismiss-all":
        platform.notifications.dismissAll();
        return respond({ dismissed: true });

      case "POST /api/terminal/exec":
        return guard(async () => {
          const body = bodyObject(request.body);
          const command = field(body, "command");
          const args = Array.isArray(body["args"])
            ? body["args"].filter(
                (argument): argument is string => typeof argument === "string",
              )
            : [];
          const timeoutMs =
            typeof body["timeoutMs"] === "number"
              ? body["timeoutMs"]
              : undefined;
          const cwd = optionalString(body, "cwd");
          return platform.processes.exec({
            command,
            args,
            ...(timeoutMs === undefined ? {} : { timeoutMs }),
            ...(cwd === undefined ? {} : { cwd }),
          });
        });

      default:
        return {
          status: 404,
          body: {
            ok: false,
            error: { code: "NOT_FOUND", message: `No route for ${route}.` },
          },
        };
    }
  } catch (cause) {
    if (cause instanceof RequestError) return failure(cause.platformError);
    return failure({
      code: "IO_FAILURE",
      message:
        cause instanceof Error ? cause.message : "Unexpected platform failure.",
    });
  }
};
