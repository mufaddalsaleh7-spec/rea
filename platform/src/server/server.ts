import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import type { Platform } from "../boot.ts";
import type { Logger } from "../core/logging.ts";
import type { ApiResponse } from "./api.ts";
import { handleApiRequest } from "./api.ts";

/**
 * HTTP transport for ReaOS.
 *
 * The desktop shell is a static web application served by the same process as
 * the platform API, so there is exactly one origin and no cross-origin policy to
 * maintain. The server is bound to 0.0.0.0 so a browser running on the host (or
 * behind a preview proxy) can reach it; it never trusts the `Host` header for
 * routing and it never serves files outside the UI directory.
 */

export type PlatformServer = {
  readonly listen: (options: {
    readonly port: number;
    readonly host: string;
  }) => Promise<{ readonly url: string }>;
  readonly close: () => Promise<void>;
  readonly address: () =>
    | { readonly port: number; readonly host: string }
    | undefined;
};

export type PlatformServerOptions = {
  readonly platform: Platform;
  readonly logger: Logger;
  readonly uiDirectory?: string;
  readonly maxBodyBytes?: number;
};

const MAX_BODY_BYTES = 2 * 1024 * 1024;

const MIME_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};

const defaultUiDirectory = (): string =>
  resolve(fileURLToPath(new URL("../../ui/", import.meta.url)));

const readBody = async (
  request: IncomingMessage,
  maxBodyBytes: number,
): Promise<{ body: unknown; tooLarge: boolean }> => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > maxBodyBytes) return { body: undefined, tooLarge: true };
    chunks.push(buffer);
  }
  if (chunks.length === 0) return { body: undefined, tooLarge: false };
  const raw = Buffer.concat(chunks).toString("utf8");
  try {
    return { body: JSON.parse(raw) as unknown, tooLarge: false };
  } catch {
    return { body: raw, tooLarge: false };
  }
};

const sendJson = (response: ServerResponse, payload: ApiResponse): void => {
  const text = JSON.stringify(payload.body);
  response.writeHead(payload.status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "content-length": Buffer.byteLength(text),
  });
  response.end(text);
};

export const createPlatformServer = (
  options: PlatformServerOptions,
): PlatformServer => {
  const platform = options.platform;
  const maxBodyBytes = options.maxBodyBytes ?? MAX_BODY_BYTES;
  const uiDirectory = resolve(options.uiDirectory ?? defaultUiDirectory());
  let bound: { port: number; host: string } | undefined;

  const serveStatic = async (
    request: IncomingMessage,
    response: ServerResponse,
    pathname: string,
  ): Promise<void> => {
    const requested = pathname === "/" ? "/index.html" : pathname;
    const relativePath = normalize(requested).replace(/^(\.\.[/\\])+/u, "");
    const absolute = join(uiDirectory, relativePath);
    const contained =
      absolute === uiDirectory || absolute.startsWith(`${uiDirectory}${sep}`);
    if (!contained) {
      sendJson(response, {
        status: 403,
        body: {
          ok: false,
          error: {
            code: "PERMISSION_DENIED",
            message: "Path outside the shell bundle.",
          },
        },
      });
      return;
    }
    try {
      const info = await stat(absolute);
      if (!info.isFile()) throw new Error("not a file");
      const extension = extname(absolute).toLowerCase();
      response.writeHead(200, {
        "content-type": MIME_TYPES[extension] ?? "application/octet-stream",
        "cache-control": "no-cache",
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
        "content-length": info.size,
      });
      if (request.method === "HEAD") {
        response.end();
        return;
      }
      createReadStream(absolute).pipe(response);
    } catch {
      // Single-page shell: unknown paths without a file extension fall back to
      // the shell so deep links work; asset requests stay honest 404s.
      if (extname(absolute) === "") {
        const index = join(uiDirectory, "index.html");
        try {
          const info = await stat(index);
          response.writeHead(200, {
            "content-type": MIME_TYPES[".html"] ?? "text/html",
            "cache-control": "no-cache",
            "content-length": info.size,
          });
          createReadStream(index).pipe(response);
          return;
        } catch {
          // fall through to 404
        }
      }
      sendJson(response, {
        status: 404,
        body: {
          ok: false,
          error: { code: "NOT_FOUND", message: "Not found." },
        },
      });
    }
  };

  const streamEvents = (
    request: IncomingMessage,
    response: ServerResponse,
  ): void => {
    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    response.write(": reaos event stream\n\n");
    const unsubscribe = platform.events.onAny((event) => {
      response.write(`event: ${event.topic}\n`);
      response.write(`data: ${JSON.stringify(event)}\n\n`);
    });
    const keepAlive = setInterval(() => response.write(": ping\n\n"), 15_000);
    request.on("close", () => {
      clearInterval(keepAlive);
      unsubscribe();
      response.end();
    });
  };

  const handle = async (
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> => {
    const url = new URL(request.url ?? "/", "http://reaos.local");
    if (url.pathname === "/api/events" && request.method === "GET") {
      streamEvents(request, response);
      return;
    }
    if (!url.pathname.startsWith("/api/")) {
      if (request.method !== "GET" && request.method !== "HEAD") {
        sendJson(response, {
          status: 405,
          body: {
            ok: false,
            error: { code: "INVALID_ARGUMENT", message: "Method not allowed." },
          },
        });
        return;
      }
      await serveStatic(request, response, url.pathname);
      return;
    }
    const { body, tooLarge } = ["GET", "HEAD", "DELETE"].includes(
      request.method ?? "",
    )
      ? { body: undefined, tooLarge: false }
      : await readBody(request, maxBodyBytes);
    if (tooLarge) {
      sendJson(response, {
        status: 413,
        body: {
          ok: false,
          error: {
            code: "LIMIT_EXCEEDED",
            message: "Request body is too large.",
          },
        },
      });
      return;
    }
    const query: Record<string, string> = {};
    for (const [key, value] of url.searchParams) query[key] = value;
    const result = await handleApiRequest(platform, {
      method: request.method ?? "GET",
      path: url.pathname,
      query,
      body,
    });
    sendJson(response, result);
  };

  const server: Server = createServer((request, response) => {
    handle(request, response).catch((cause: unknown) => {
      options.logger.error("request failed", {
        reason: cause instanceof Error ? cause.message : String(cause),
      });
      if (!response.headersSent)
        sendJson(response, {
          status: 500,
          body: {
            ok: false,
            error: { code: "IO_FAILURE", message: "Internal platform error." },
          },
        });
      else response.end();
    });
  });

  return {
    listen: ({ port, host }) =>
      new Promise((settle, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
          const address = server.address();
          const actualPort =
            typeof address === "object" && address !== null
              ? address.port
              : port;
          bound = { port: actualPort, host };
          options.logger.info("shell listening", { host, port: actualPort });
          settle({
            url: `http://${host === "0.0.0.0" ? "localhost" : host}:${actualPort}`,
          });
        });
      }),
    close: () =>
      new Promise((settle) => {
        server.closeAllConnections();
        server.close(() => settle());
      }),
    address: () => bound,
  };
};
