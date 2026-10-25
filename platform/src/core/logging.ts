/**
 * Structured logging with a bounded in-memory ring.
 *
 * ReaOS runs as a single host process, so the logger is also the system log the
 * "Console" diagnostics surface reads. Entries are immutable records; nothing
 * is written to disk unless a sink is supplied, which keeps tests hermetic.
 */

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export type LogEntry = {
  readonly at: string;
  readonly level: LogLevel;
  readonly scope: string;
  readonly message: string;
  readonly data?: Readonly<Record<string, unknown>>;
};

export type LogSink = (entry: LogEntry) => void;

export type Logger = {
  readonly debug: (
    message: string,
    data?: Readonly<Record<string, unknown>>,
  ) => void;
  readonly info: (
    message: string,
    data?: Readonly<Record<string, unknown>>,
  ) => void;
  readonly warn: (
    message: string,
    data?: Readonly<Record<string, unknown>>,
  ) => void;
  readonly error: (
    message: string,
    data?: Readonly<Record<string, unknown>>,
  ) => void;
  readonly child: (scope: string) => Logger;
  readonly entries: () => readonly LogEntry[];
  readonly clear: () => void;
};

export type LoggerOptions = {
  readonly scope?: string;
  readonly clock?: () => Date;
  readonly limit?: number;
  readonly minimumLevel?: LogLevel;
  readonly sink?: LogSink;
};

const RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export const createLogger = (options: LoggerOptions = {}): Logger => {
  const clock = options.clock ?? (() => new Date());
  const limit = options.limit ?? 500;
  const minimum = RANK[options.minimumLevel ?? "info"];
  const scope = options.scope ?? "platform";
  const buffer: LogEntry[] = [];

  const write = (
    level: LogLevel,
    message: string,
    data?: Readonly<Record<string, unknown>>,
  ): void => {
    if (RANK[level] < minimum) return;
    const entry: LogEntry =
      data === undefined
        ? { at: clock().toISOString(), level, scope, message }
        : { at: clock().toISOString(), level, scope, message, data };
    buffer.push(entry);
    if (buffer.length > limit) buffer.splice(0, buffer.length - limit);
    options.sink?.(entry);
  };

  const logger: Logger = {
    debug: (message, data) => write("debug", message, data),
    info: (message, data) => write("info", message, data),
    warn: (message, data) => write("warn", message, data),
    error: (message, data) => write("error", message, data),
    child: (childScope) =>
      createLogger({ ...options, scope: `${scope}.${childScope}` }),
    entries: () => [...buffer],
    clear: () => buffer.splice(0, buffer.length),
  };
  return logger;
};
