/**
 * The one place that knows how to talk to the backend.
 *
 * The PHP router answers exactly what the Node one does, so this module never
 * needs to know which one is running. Errors carry the backend's code so a
 * screen can react to `UNBALANCED` differently from `INTERNAL`.
 */

import { useCallback, useEffect, useState } from "react";

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const BASE = globalThis.TALLYCRAFT_BASE ?? "";

export async function api(path, options = {}) {
  const { method = "GET", body, text = false, signal } = options;
  const response = await fetch(`${BASE}${path}`, {
    method,
    signal,
    headers:
      body === undefined
        ? undefined
        : {
            "content-type":
              typeof body === "string" ? "application/xml" : "application/json",
          },
    body:
      body === undefined
        ? undefined
        : typeof body === "string"
          ? body
          : JSON.stringify(body),
  });
  const payload = text ? await response.text() : await response.json().catch(() => null);
  if (!response.ok) {
    const error = payload?.error ?? {};
    throw new ApiError(
      response.status,
      error.code ?? "HTTP_ERROR",
      error.message ?? `Request failed with ${response.status}`,
      error.details ?? null,
    );
  }
  return payload;
}

/** Tiny data hook: one request, a loading flag, an error and a reload handle. */
export function useApi(path, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (path === null) {
      setState({ data: null, error: null, loading: false });
      return undefined;
    }
    const controller = new AbortController();
    setState((current) => ({ ...current, loading: true, error: null }));
    api(path, { signal: controller.signal })
      .then((data) => setState({ data, error: null, loading: false }))
      .catch((error) => {
        if (error.name === "AbortError") return;
        setState({ data: null, error, loading: false });
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, nonce, ...deps]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  return { ...state, reload };
}
