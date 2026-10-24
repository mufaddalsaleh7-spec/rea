/**
 * HTTP surface for TallyCraft: a JSON API plus the browser client.
 *
 * The server binds to 0.0.0.0 so it can be opened from another host (preview
 * sandboxes, a shop-floor tablet), serves only files under `public/`, and
 * answers unknown non-API paths with the single-page shell.
 */

import { createServer as createHttpServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { TallyCraft, TallyCraftError } from "./app.js";
import {
  GST_RATES,
  PRIMARY_GROUP_NAMES,
  UNITS,
  VOUCHER_TYPES,
} from "./catalog.js";
import { seed } from "./seed.js";

const MIME_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
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

export function createAppServer({
  dbPath,
  publicDir,
  app = TallyCraft.open(dbPath),
}) {
  const root = resolve(publicDir);

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
    const body = await readFile(filePath);
    response.writeHead(200, {
      "content-type":
        MIME_TYPES.get(extname(filePath)) ?? "application/octet-stream",
      "content-length": body.length,
      "cache-control": "no-cache",
    });
    response.end(body);
  };

  const handleApi = async (request, response, path, params) => {
    const method = request.method ?? "GET";

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

  const server = createHttpServer(async (request, response) => {
    const url = new URL(
      request.url ?? "/",
      `http://${request.headers.host ?? "localhost"}`,
    );
    try {
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
  });

  server.on("close", () => app.close());
  return server;
}
