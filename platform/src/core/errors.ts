/**
 * The platform error vocabulary. Every service failure carries one of these
 * codes so the desktop shell can present a stable message and the HTTP layer
 * can map the failure to a status code without guessing.
 */
export const PLATFORM_ERROR_CODES = [
  "INVALID_ARGUMENT",
  "NOT_FOUND",
  "ALREADY_EXISTS",
  "PERMISSION_DENIED",
  "LIMIT_EXCEEDED",
  "UNAVAILABLE",
  "CONFLICT",
  "IO_FAILURE",
] as const;

export type PlatformErrorCode = (typeof PLATFORM_ERROR_CODES)[number];

export type PlatformError = {
  readonly code: PlatformErrorCode;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
};

export const platformError = (
  code: PlatformErrorCode,
  message: string,
  details?: Readonly<Record<string, unknown>>,
): PlatformError =>
  details === undefined ? { code, message } : { code, message, details };

const NODE_ERROR_CODES: Readonly<Record<string, PlatformErrorCode>> = {
  ENOENT: "NOT_FOUND",
  EEXIST: "ALREADY_EXISTS",
  ENOTDIR: "INVALID_ARGUMENT",
  EISDIR: "INVALID_ARGUMENT",
  EACCES: "PERMISSION_DENIED",
  EPERM: "PERMISSION_DENIED",
  ENOSPC: "LIMIT_EXCEEDED",
  ENAMETOOLONG: "LIMIT_EXCEEDED",
};

const nodeErrorCode = (cause: unknown): string | undefined => {
  if (typeof cause !== "object" || cause === null) return undefined;
  const record = cause as { code?: unknown };
  return typeof record.code === "string" ? record.code : undefined;
};

/**
 * Maps an unexpected thrown value (typically a Node.js `ErrnoException`) onto
 * the platform vocabulary. The original code is retained in `details` so the
 * diagnostic chain is not lost.
 */
export const fromUnknownError = (
  cause: unknown,
  message: string,
): PlatformError => {
  const code = nodeErrorCode(cause);
  const mapped = code === undefined ? undefined : NODE_ERROR_CODES[code];
  const detail =
    cause instanceof Error
      ? cause.message
      : typeof cause === "string"
        ? cause
        : String(cause);
  const details: Record<string, unknown> = { cause: detail };
  if (code !== undefined) details["code"] = code;
  return { code: mapped ?? "IO_FAILURE", message, details };
};

export const describeError = (error: PlatformError): string =>
  error.code === "PERMISSION_DENIED"
    ? `${error.message} (permission denied)`
    : `${error.message} [${error.code}]`;

/** Narrowing guard for values crossing the HTTP boundary. */
export const isPlatformError = (value: unknown): value is PlatformError =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { code?: unknown }).code === "string" &&
  typeof (value as { message?: unknown }).message === "string";
