/**
 * Typed-ish client for the PHP API (php/src/Controllers/*).
 *
 * Every call goes through `request()` which normalises errors into ApiError and
 * bounds the wait so the UI can fall back to local storage when the backend is
 * unreachable instead of hanging.
 */

const BASE = (import.meta.env?.VITE_API_BASE || "/api").replace(/\/$/, "");

export class ApiError extends Error {
  constructor(message, { status = 0, details = {} } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }

  get isConflict() {
    return this.status === 409;
  }

  get isOffline() {
    return this.status === 0;
  }
}

async function request(path, { method = "GET", body, timeout = 20_000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(`${BASE}${path}`, {
      method,
      headers: body === undefined ? { accept: "application/json" } : { "content-type": "application/json", accept: "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    let payload = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { raw: text };
      }
    }
    if (!response.ok) {
      throw new ApiError(payload?.error || `${response.status} ${response.statusText}`, {
        status: response.status,
        details: payload?.details || {},
      });
    }
    return payload;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error?.name === "AbortError") {
      throw new ApiError("The workspace server timed out", { status: 0 });
    }
    throw new ApiError("The workspace server is unreachable", { status: 0 });
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  base: BASE,

  health: () => request("/health"),

  listDocuments: (search = "", limit = 60) =>
    request(`/documents?limit=${limit}${search ? `&q=${encodeURIComponent(search)}` : ""}`),

  createDocument: (name, document) => request("/documents", { method: "POST", body: { name, document } }),

  getDocument: (id) => request(`/documents/${encodeURIComponent(id)}`),

  updateDocument: (id, { document, name, baseRevision, starred }) =>
    request(`/documents/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: {
        ...(document ? { document } : {}),
        ...(name ? { name } : {}),
        ...(baseRevision !== undefined && baseRevision !== null ? { baseRevision } : {}),
        ...(starred !== undefined ? { starred } : {}),
      },
    }),

  renameDocument: (id, name, starred) =>
    request(`/documents/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: { ...(name ? { name } : {}), ...(starred !== undefined ? { starred } : {}) },
    }),

  deleteDocument: (id) => request(`/documents/${encodeURIComponent(id)}`, { method: "DELETE" }),

  revisions: (id) => request(`/documents/${encodeURIComponent(id)}/revisions`),

  restoreRevision: (id, revision) =>
    request(`/documents/${encodeURIComponent(id)}/revisions/${revision}/restore`, { method: "POST", body: {} }),

  exportUrl: (id, format = "svg", artboard = null) =>
    `${BASE}/documents/${encodeURIComponent(id)}/export?format=${format}${artboard ? `&artboard=${encodeURIComponent(artboard)}` : ""}`,

  uploadAsset: (id, { format, filename, data }) =>
    request(`/documents/${encodeURIComponent(id)}/assets`, {
      method: "POST",
      body: { format, filename, data },
      timeout: 40_000,
    }),

  assetUrl: (assetId) => `${BASE}/assets/${encodeURIComponent(assetId)}`,

  getSettings: () => request("/settings"),

  putSettings: (settings) => request("/settings", { method: "PUT", body: { settings } }),
};

/** Probe the backend once; resolves to the health payload or null. */
export async function probeBackend() {
  try {
    return await api.health();
  } catch {
    return null;
  }
}
