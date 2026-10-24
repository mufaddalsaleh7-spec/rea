/**
 * HTTP surface for TallyCraft: a JSON API plus the browser client.
 *
 * The server binds to 0.0.0.0 so it can be opened from another host (preview
 * sandboxes, a shop-floor tablet), serves only files under `public/`, and
 * answers unknown non-API paths with the single-page shell.
 */

import { createServer as createHttpServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { basename, extname, join, normalize, resolve, sep } from "node:path";
import { TallyCraft, TallyCraftError } from "./app.js";
import {
  GST_RATES,
  PRIMARY_GROUP_NAMES,
  UNITS,
  VOUCHER_TYPES,
} from "./catalog.js";
import { instanceInfo, previewUrlFor } from "./instance.js";
import { seed } from "./seed.js";

const MIME_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".ico", "image/x-icon"],
  [".woff2", "font/woff2"],
  [".xml", "application/xml; charset=utf-8"],
]);

function sendJson(response, status, body, headers = {}) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(payload),
    ...headers,
  });
  response.end(payload);
}

const NOT_FOUND_CODES = new Set([
  "UNKNOWN_LEDGER",
  "UNKNOWN_GROUP",
  "UNKNOWN_VOUCHER",
  "UNKNOWN_STOCK_ITEM",
  "NO_COMPANY",
]);

function sendError(response, error) {
  if (error instanceof TallyCraftError) {
    const status = NOT_FOUND_CODES.has(error.code) ? 404 : 400;
    sendJson(response, status, {
      error: {
        code: error.code,
        message: error.message,
        details: error.details ?? null,
      },
    });
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  sendJson(response, 500, { error: { code: "INTERNAL", message } });
}

async function readBody(request, limitBytes = 12 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limitBytes) {
      throw new TallyCraftError(
        "PAYLOAD_TOO_LARGE",
        "Request body exceeds 12 MB",
      );
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function readJson(request) {
  const body = await readBody(request);
  if (body.trim() === "") return {};
  try {
    return JSON.parse(body);
  } catch {
    throw new TallyCraftError("INVALID_JSON", "Request body is not valid JSON");
  }
}

function numberParam(params, key, fallback = null) {
  const raw = params.get(key);
  if (raw === null || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new TallyCraftError("INVALID_PARAMETER", `${key} must be numeric`);
  }
  return value;
}

function textParam(params, key, fallback = null) {
  const raw = params.get(key);
  return raw === null || raw === "" ? fallback : raw;
}

/**
 * First-paint data written into the HTML.
 *
 * The client prefers the live API, but a proxy that blocks or rewrites `/api/*`
 * would otherwise leave a blank page. Inlining the same payload lets the shell
 * render the real book on first paint and fall back to it if fetches fail.
 */
function bootPayload(app) {
  return {
    "/api/catalog": {
      groups: app.listGroups(),
      primaryGroups: PRIMARY_GROUP_NAMES,
      voucherTypes: VOUCHER_TYPES,
      units: UNITS,
      gstRates: GST_RATES,
    },
    "/api/company": app.getCompany(),
    "/api/statistics": app.statistics(),
    "/api/vouchers?limit=7": { vouchers: app.listVouchers({ limit: 7 }) },
    "/api/ledgers": { ledgers: app.listLedgers() },
  };
}

function injectBootData(html, app) {
  if (!html.includes("</head>")) return html;
  const payload = JSON.stringify(bootPayload(app)).replaceAll("</", "<\\/");
  const tag = `<script id="tallycraft-boot" type="application/json">${payload}</script>`;
  return html.replace("</head>", `${tag}\n  </head>`);
}

export function createAppServer({
  dbPath,
  publicDir,
  app = TallyCraft.open(dbPath),
  instance = null,
  logRequests = true,
  log = (line) => process.stdout.write(`${line}\n`),
}) {
  const root = resolve(publicDir);

  /**
   * One access line per request, recording whether a proxy forwarded it.
   *
   * When a preview panel reports "unavailable", this line answers the first
   * question: did the request reach the sandbox at all? No line means the
   * failure is upstream of this process.
   */
  const recordRequest = (request, response, startedAt) => {
    if (!logRequests) return;
    const forwarded = [
      "x-forwarded-for",
      "x-forwarded-host",
      "forwarded",
      "x-real-ip",
    ].filter((header) => request.headers[header] !== undefined);
    const path = (request.url ?? "/").split("?")[0];
    log(
      [
        "req",
        request.method ?? "GET",
        path,
        response.statusCode,
        `${Date.now() - startedAt}ms`,
        `host=${request.headers.host ?? "-"}`,
        `via=${forwarded.length === 0 ? "direct" : forwarded.join(",")}`,
        `ip=${request.socket.remoteAddress ?? "-"}`,
      ].join(" "),
    );
  };

  const serveStatic = async (response, pathname) => {
    const relative = normalize(decodeURIComponent(pathname)).replace(
      /^(\.\.[/\\])+/,
      "",
    );
    let filePath = resolve(join(root, relative));
    if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) {
      sendJson(response, 403, {
        error: {
          code: "FORBIDDEN",
          message: "Path is outside the client root",
        },
      });
      return;
    }
    let info = await stat(filePath).catch(() => null);
    if (info !== null && info.isDirectory()) {
      // A directory serves its own index.html first (the static web app lives
      // at /static/), and only then the SPA shell.
      const own = join(filePath, "index.html");
      const ownInfo = await stat(own).catch(() => null);
      if (ownInfo !== null) {
        filePath = own;
        info = ownInfo;
      }
    }
    if (info === null || info.isDirectory()) {
      filePath = join(root, "index.html");
      info = await stat(filePath).catch(() => null);
      if (info === null) {
        sendJson(response, 404, {
          error: { code: "NOT_FOUND", message: "Client build is missing" },
        });
        return;
      }
    }
    let body = await readFile(filePath);
    if (extname(filePath) === ".html") {
      body = Buffer.from(injectBootData(body.toString("utf8"), app), "utf8");
    }
    response.writeHead(200, {
      "content-type":
        MIME_TYPES.get(extname(filePath)) ?? "application/octet-stream",
      "content-length": body.length,
      // A service worker or manifest served from a stale cache can pin an old
      // shell forever, so everything stays revalidated.
      "cache-control": "no-cache",
      // The worker controls the whole origin, not just its own directory.
      ...(basename(filePath) === "sw.js"
        ? { "service-worker-allowed": "/" }
        : {}),
    });
    response.end(body);
  };

  const handleApi = async (request, response, path, params) => {
    const method = request.method ?? "GET";

    if (path === "/api/instance") {
      // Readiness contract: who am I, which port, which preview URL, how long.
      const info =
        instance === null
          ? instanceInfo({ port: 0 })
          : typeof instance === "function"
            ? instance()
            : instance;
      // The same process answers on several ports. Report the one this
      // request arrived on, so every alias states its own preview URL. The
      // primary keeps the configured identity even when it was bound on an
      // ephemeral port.
      const localPort = request.socket.localPort;
      const isAlias =
        Number.isInteger(localPort) &&
        localPort !== (server.boundPort ?? info.port);
      const reported = isAlias
        ? {
            ...info,
            port: localPort,
            localUrl: `http://127.0.0.1:${localPort}`,
            previewUrl: previewUrlFor(localPort, info.sandboxId ?? undefined),
            aliasOf: info.port,
          }
        : info;
      sendJson(response, 200, reported);
      return;
    }

    if (path === "/api/health") {
      const statistics = (() => {
        try {
          return app.statistics();
        } catch {
          return null;
        }
      })();
      sendJson(response, 200, { ok: true, database: dbPath, statistics });
      return;
    }

    if (path === "/api/catalog") {
      sendJson(response, 200, {
        groups: app.listGroups(),
        primaryGroups: PRIMARY_GROUP_NAMES,
        voucherTypes: VOUCHER_TYPES,
        units: UNITS,
        gstRates: GST_RATES,
      });
      return;
    }

    if (path === "/api/company") {
      sendJson(response, 200, app.getCompany());
      return;
    }

    if (path === "/api/statistics") {
      sendJson(response, 200, app.statistics());
      return;
    }

    if (path === "/api/groups") {
      sendJson(response, 200, app.listGroups());
      return;
    }

    if (path === "/api/ledgers") {
      if (method === "GET") {
        sendJson(response, 200, {
          ledgers: app.listLedgers({
            group: textParam(params, "group"),
            search: textParam(params, "search"),
          }),
        });
        return;
      }
      if (method === "POST") {
        const body = await readJson(request);
        sendJson(response, 201, app.createLedger(body));
        return;
      }
    }

    const ledgerMatch = /^\/api\/ledgers\/(\d+)$/.exec(path);
    if (ledgerMatch !== null) {
      const id = Number(ledgerMatch[1]);
      if (method === "GET") {
        sendJson(response, 200, app.getLedger(id));
        return;
      }
      if (method === "PATCH" || method === "PUT") {
        sendJson(response, 200, app.updateLedger(id, await readJson(request)));
        return;
      }
      if (method === "DELETE") {
        sendJson(response, 200, app.deleteLedger(id));
        return;
      }
    }

    if (path === "/api/stock-items") {
      if (method === "GET") {
        const summary = app.stockSummary({
          asOf: textParam(params, "asOf") ?? undefined,
        });
        sendJson(response, 200, summary);
        return;
      }
      if (method === "POST") {
        const body = await readJson(request);
        sendJson(response, 201, app.createStockItem(body));
        return;
      }
    }

    if (path === "/api/vouchers") {
      if (method === "GET") {
        sendJson(response, 200, {
          vouchers: app.listVouchers({
            from: textParam(params, "from"),
            to: textParam(params, "to"),
            type: textParam(params, "type"),
            ledgerId: numberParam(params, "ledgerId"),
            search: textParam(params, "search"),
            limit: numberParam(params, "limit", 200),
            offset: numberParam(params, "offset", 0),
          }),
        });
        return;
      }
      if (method === "POST") {
        sendJson(response, 201, app.createVoucher(await readJson(request)));
        return;
      }
    }

    if (path === "/api/vouchers/next") {
      const type = textParam(params, "type");
      const date = textParam(params, "date");
      if (type === null) {
        throw new TallyCraftError("INVALID_PARAMETER", "type is required");
      }
      sendJson(response, 200, {
        number: app.currentVoucherNumber(
          app.resolveVoucherType(type),
          date ?? new Date().toISOString().slice(0, 10),
        ),
      });
      return;
    }

    const voucherMatch = /^\/api\/vouchers\/(\d+)$/.exec(path);
    if (voucherMatch !== null) {
      const id = Number(voucherMatch[1]);
      if (method === "GET") {
        sendJson(response, 200, app.getVoucher(id));
        return;
      }
      if (method === "DELETE") {
        sendJson(response, 200, app.deleteVoucher(id));
        return;
      }
    }

    if (path.startsWith("/api/reports/")) {
      const report = path.slice("/api/reports/".length);
      const asOf = textParam(params, "asOf");
      const from = textParam(params, "from");
      const to = textParam(params, "to");
      switch (report) {
        case "trial-balance":
          sendJson(
            response,
            200,
            app.trialBalance({
              asOf,
              detailed: textParam(params, "detailed") !== "false",
            }),
          );
          return;
        case "balance-sheet":
          sendJson(response, 200, app.balanceSheet({ asOf }));
          return;
        case "profit-loss":
          sendJson(response, 200, app.profitLoss({ from, to }));
          return;
        case "day-book":
          sendJson(
            response,
            200,
            app.dayBook({
              date: textParam(params, "date"),
              type: textParam(params, "type"),
            }),
          );
          return;
        case "outstanding":
          sendJson(
            response,
            200,
            app.outstanding({
              asOf,
              type: textParam(params, "type", "receivable"),
            }),
          );
          return;
        case "gst-summary":
          sendJson(response, 200, app.gstSummary({ from, to }));
          return;
        case "stock-summary":
          sendJson(response, 200, app.stockSummary({ asOf }));
          return;
        case "ledger": {
          const ledgerId = numberParam(params, "ledgerId");
          if (ledgerId === null) {
            throw new TallyCraftError(
              "INVALID_PARAMETER",
              "ledgerId is required",
            );
          }
          sendJson(response, 200, app.ledgerReport({ ledgerId, from, to }));
          return;
        }
        default:
          sendJson(response, 404, {
            error: { code: "UNKNOWN_REPORT", message: `No report "${report}"` },
          });
          return;
      }
    }

    if (path === "/api/export/xml") {
      const xml = app.exportXml({
        from: textParam(params, "from"),
        to: textParam(params, "to"),
        masters: textParam(params, "masters") !== "false",
        vouchers: textParam(params, "vouchers") !== "false",
      });
      const stamp = new Date().toISOString().slice(0, 10);
      response.writeHead(200, {
        "content-type": "application/xml; charset=utf-8",
        "content-disposition": `attachment; filename="tallycraft-${stamp}.xml"`,
        "cache-control": "no-store",
      });
      response.end(xml);
      return;
    }

    if (path === "/api/import/xml" && method === "POST") {
      const xml = await readBody(request);
      const dryRun = textParam(params, "dryRun") === "true";
      sendJson(response, 200, app.importXml(xml, { dryRun }));
      return;
    }

    if (path === "/api/demo/reset" && method === "POST") {
      sendJson(response, 200, seed(app));
      return;
    }

    sendJson(response, 404, {
      error: { code: "NOT_FOUND", message: `No route for ${method} ${path}` },
    });
  };

  const handler = async (request, response) => {
    const startedAt = Date.now();
    response.on("finish", () => recordRequest(request, response, startedAt));
    const url = new URL(
      request.url ?? "/",
      `http://${request.headers.host ?? "localhost"}`,
    );
    try {
      // Plain-text liveness probe for proxies, containers and uptime checks.
      if (url.pathname === "/healthz") {
        response.writeHead(200, {
          "content-type": "text/plain; charset=utf-8",
          "cache-control": "no-store",
        });
        response.end(request.method === "HEAD" ? undefined : "ok");
        return;
      }
      if (url.pathname.startsWith("/api/")) {
        await handleApi(
          request,
          response,
          url.pathname.replace(/\/+$/, ""),
          url.searchParams,
        );
        return;
      }
      if (request.method !== "GET" && request.method !== "HEAD") {
        sendJson(response, 405, {
          error: {
            code: "METHOD_NOT_ALLOWED",
            message: "Use GET for client files",
          },
        });
        return;
      }
      await serveStatic(
        response,
        url.pathname === "/" ? "/index.html" : url.pathname,
      );
    } catch (error) {
      sendError(response, error);
    }
  };

  const server = createHttpServer(handler);
  server.requestHandler = handler;
  server.extraServers = [];

  /**
   * Listen on the primary port, plus optional aliases.
   *
   * A preview proxy may target a conventional development port rather than the
   * one we picked. Serving the same handler on several ports removes that
   * assumption: whichever port the proxy dials, it reaches this instance and
   * the same ledger. Aliases are best effort — a taken alias is skipped, never
   * fatal.
   */
  server.listenAll = async (port, host = "0.0.0.0", extraPorts = []) => {
    const primary = new Promise((resolve, reject) => {
      const onError = (error) => reject(error);
      server.once("error", onError);
      server.listen(port, host, () => {
        server.removeListener("error", onError);
        resolve(server.address().port);
      });
    });
    const wanted = [
      ...new Set(
        extraPorts.filter(
          (extra) => Number.isInteger(extra) && extra >= 0 && extra !== port,
        ),
      ),
    ];
    const aliases = wanted.map(
      (extra) =>
        new Promise((resolve) => {
          const alias = createHttpServer(handler);
          alias.on("error", () => resolve(null));
          alias.listen(extra, host, () => {
            server.extraServers.push(alias);
            resolve(alias.address().port);
          });
        }),
    );
    const [primaryPort, ...aliasPorts] = await Promise.all([
      primary,
      ...aliases,
    ]);
    server.boundPort = primaryPort;
    const bound = aliasPorts.filter((value) => value !== null);
    return {
      port: primaryPort,
      aliases: bound,
      // Requested aliases that were already busy: the instance stays up, it
      // just answers on fewer ports. Never fatal, never silent.
      skipped: wanted.filter((extra, index) => aliasPorts[index] === null),
    };
  };

  server.on("close", () => {
    for (const alias of server.extraServers) alias.close();
    // A server can be constructed without a database (health probes, tests).
    if (app) app.close();
  });
  return server;
}
