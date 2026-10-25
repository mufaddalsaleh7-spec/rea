import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

import type { PlatformError } from "../core/errors.ts";
import { fromUnknownError, platformError } from "../core/errors.ts";
import type { Result } from "../core/result.ts";
import { err, ok } from "../core/result.ts";

/**
 * Controlled process execution ("spawning" in ReaOS terms).
 *
 * The platform never uses a shell. A command must name an executable from an
 * explicit allowlist, arguments are passed as an array (so quoting cannot turn
 * data into code), the working directory must resolve inside the platform root,
 * output is byte-capped, and every child is killed on timeout or shutdown.
 */

export type ExecRequest = {
  readonly command: string;
  readonly args?: readonly string[];
  /** Virtual path, resolved to a host directory inside the platform root. */
  readonly cwd?: string;
  readonly timeoutMs?: number;
};

export type ExecResult = {
  readonly id: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
  readonly timedOut: boolean;
  readonly truncated: boolean;
};

export type ProcessHost = {
  readonly exec: (
    request: ExecRequest,
  ) => Promise<Result<ExecResult, PlatformError>>;
  readonly allowedCommands: () => readonly string[];
  readonly running: () => number;
  readonly shutdown: () => Promise<void>;
};

export type ProcessHostOptions = {
  readonly allowedCommands: readonly string[];
  /**
   * Authorisation hook checked before every spawn. The platform injects the
   * capability broker here so `process:spawn` is enforced in the kernel rather
   * than trusted to callers.
   */
  readonly authorize?: () => Result<void, PlatformError>;
  readonly resolveCwd: (
    virtualPath: string,
  ) => Promise<Result<string, PlatformError>>;
  readonly homeCwd: string;
  readonly defaultTimeoutMs?: number;
  readonly maxTimeoutMs?: number;
  readonly maxOutputBytes?: number;
  readonly maxConcurrent?: number;
  readonly clock?: () => number;
  readonly onStarted?: (details: {
    readonly id: string;
    readonly command: string;
  }) => void;
  readonly onFinished?: (result: ExecResult) => void;
};

const DEFAULT_TIMEOUT_MS = 5000;
const MAX_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 64 * 1024;
const MAX_CONCURRENT = 4;

export const createProcessHost = (options: ProcessHostOptions): ProcessHost => {
  const clock = options.clock ?? (() => Date.now());
  const defaultTimeout = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxTimeout = options.maxTimeoutMs ?? MAX_TIMEOUT_MS;
  const maxOutput = options.maxOutputBytes ?? MAX_OUTPUT_BYTES;
  const maxConcurrent = options.maxConcurrent ?? MAX_CONCURRENT;
  const allowed = new Set(options.allowedCommands);
  const children = new Set<{ kill: (signal: NodeJS.Signals) => boolean }>();

  const exec = async (
    request: ExecRequest,
  ): Promise<Result<ExecResult, PlatformError>> => {
    const authorized = options.authorize?.() ?? ok(undefined);
    if (!authorized.ok) return authorized;
    if (typeof request.command !== "string" || request.command.length === 0)
      return err(
        platformError("INVALID_ARGUMENT", "A command name is required."),
      );
    if (!allowed.has(request.command))
      return err(
        platformError(
          "PERMISSION_DENIED",
          `"${request.command}" is not an approved ReaOS command.`,
          {
            command: request.command,
          },
        ),
      );
    const args = request.args ?? [];
    if (
      !args.every(
        (argument) => typeof argument === "string" && !argument.includes("\0"),
      )
    )
      return err(
        platformError("INVALID_ARGUMENT", "Command arguments must be strings."),
      );
    if (children.size >= maxConcurrent)
      return err(
        platformError(
          "LIMIT_EXCEEDED",
          `At most ${maxConcurrent} commands may run at once.`,
        ),
      );
    const timeoutMs = clamp(
      request.timeoutMs ?? defaultTimeout,
      100,
      maxTimeout,
    );

    let cwd = options.homeCwd;
    if (request.cwd !== undefined) {
      const resolved = await options.resolveCwd(request.cwd);
      if (!resolved.ok) return resolved;
      cwd = resolved.value;
    }

    const id = randomUUID();
    options.onStarted?.({ id, command: request.command });
    const startedAt = clock();

    return new Promise<Result<ExecResult, PlatformError>>((settle) => {
      let stdout = "";
      let stderr = "";
      let capturedBytes = 0;
      let truncated = false;
      let timedOut = false;
      let settled = false;

      const child = spawn(request.command, [...args], {
        cwd,
        // Deliberately minimal environment: ambient credentials and host
        // configuration are not inherited by child processes.
        env: {
          PATH: process.env["PATH"] ?? "/usr/bin:/bin",
          HOME: options.homeCwd,
          LANG: "C.UTF-8",
          TERM: "dumb",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      children.add(child);

      const handle = (stream: "stdout" | "stderr", chunk: Buffer): void => {
        const remaining = maxOutput - capturedBytes;
        if (remaining <= 0) {
          truncated = true;
          return;
        }
        const slice = chunk.subarray(0, remaining);
        capturedBytes += slice.byteLength;
        if (slice.byteLength < chunk.byteLength) truncated = true;
        const text = slice.toString("utf8");
        if (stream === "stdout") stdout += text;
        else stderr += text;
      };
      child.stdout?.on("data", (chunk: Buffer) => handle("stdout", chunk));
      child.stderr?.on("data", (chunk: Buffer) => handle("stderr", chunk));

      const finish = (exitCode: number | null, signal: string | null): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        children.delete(child);
        const result: ExecResult = {
          id,
          command: request.command,
          args: [...args],
          exitCode,
          signal,
          stdout,
          stderr,
          durationMs: Math.max(0, clock() - startedAt),
          timedOut,
          truncated,
        };
        options.onFinished?.(result);
        settle(ok(result));
      };

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, timeoutMs);

      child.once("error", (cause) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        children.delete(child);
        settle(
          err(
            fromUnknownError(
              cause,
              `"${request.command}" could not be started.`,
            ),
          ),
        );
      });
      child.once("close", (code, signal) => finish(code, signal));
    });
  };

  return {
    exec,
    allowedCommands: () => [...allowed].sort(),
    running: () => children.size,
    shutdown: async () => {
      for (const child of children) child.kill("SIGKILL");
      children.clear();
    },
  };
};

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, Math.trunc(value)));
