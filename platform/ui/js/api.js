/**
 * Typed-ish client for the ReaOS platform API.
 *
 * Every call resolves to `{ ok: true, data }` or `{ ok: false, error }`. Network
 * failures are normalised into the same shape so UI code never needs try/catch.
 */

const request = async (method, path, body) => {
  try {
    const response = await fetch(path, {
      method,
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const payload = await response.json().catch(() => null);
    if (payload === null) {
      return {
        ok: false,
        error: {
          code: "IO_FAILURE",
          message: `The platform returned ${response.status}.`,
        },
      };
    }
    return payload;
  } catch (cause) {
    return {
      ok: false,
      error: {
        code: "UNAVAILABLE",
        message: `Cannot reach the platform: ${cause instanceof Error ? cause.message : String(cause)}`,
      },
    };
  }
};

const query = (params) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) search.set(key, String(value));
  }
  const text = search.toString();
  return text.length === 0 ? "" : `?${text}`;
};

export const api = {
  health: () => request("GET", "/api/health"),
  capabilities: () => request("GET", "/api/capabilities"),
  system: () => request("GET", "/api/system"),
  logs: () => request("GET", "/api/system/logs"),
  apps: () => request("GET", "/api/apps"),

  settings: () => request("GET", "/api/settings"),
  patchSettings: (patch) => request("PATCH", "/api/settings", patch),
  resetSettings: () => request("POST", "/api/settings/reset"),

  list: (path) => request("GET", `/api/files${query({ path })}`),
  readFile: (path) => request("POST", "/api/files/read", { path }),
  writeFile: (path, content) =>
    request("POST", "/api/files/write", { path, content }),
  mkdir: (path) => request("POST", "/api/files/mkdir", { path }),
  rename: (from, to) => request("POST", "/api/files/rename", { from, to }),
  trash: (path) => request("POST", "/api/files/delete", { path }),
  purge: (path) => request("POST", "/api/files/purge", { path }),
  trashList: () => request("GET", "/api/files/trash"),
  emptyTrash: () => request("POST", "/api/files/trash/empty"),

  search: (q) => request("GET", `/api/search${query({ q })}`),

  notifications: () => request("GET", "/api/notifications"),
  dismiss: (id) => request("POST", "/api/notifications/dismiss", { id }),
  dismissAll: () => request("POST", "/api/notifications/dismiss-all"),
  publishNotification: (title, body, level = "info") =>
    request("POST", "/api/notifications", { title, body, level }),

  exec: (command, args = [], timeoutMs) =>
    request("POST", "/api/terminal/exec", { command, args, timeoutMs }),
};

/**
 * Subscribes to the platform event stream. Returns a function that closes it.
 * EventSource reconnects on its own, which is what we want for a desktop shell.
 */
export const connectEvents = (handlers) => {
  const source = new EventSource("/api/events");
  for (const [topic, handler] of Object.entries(handlers)) {
    source.addEventListener(topic, (message) => {
      try {
        handler(JSON.parse(message.data));
      } catch {
        // Ignore malformed frames; the stream is not authoritative state.
      }
    });
  }
  source.addEventListener("error", () => {
    // EventSource retries automatically; surface a single low-key signal.
    handlers["stream:error"]?.(null);
  });
  return () => source.close();
};
