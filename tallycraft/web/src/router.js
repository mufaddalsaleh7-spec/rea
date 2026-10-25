/**
 * Hash routing without a router library.
 *
 * The app is served from /app/ by the PHP build and from /static/ by the
 * snapshot build, so a hash keeps every deep link portable across both.
 */

import { useEffect, useState } from "react";

export function parseRoute(hash = globalThis.location.hash) {
  const raw = hash.replace(/^#\/?/, "");
  const [pathPart, queryPart = ""] = raw.split("?");
  const segments = pathPart.split("/").filter(Boolean);
  const params = Object.fromEntries(new URLSearchParams(queryPart));
  return { segments, params, path: segments.join("/") };
}

export function navigate(target, params = {}) {
  const query = new URLSearchParams(
    Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== ""),
  ).toString();
  globalThis.location.hash = `#/${target.replace(/^\//, "")}${query === "" ? "" : `?${query}`}`;
}

export function useRoute() {
  const [route, setRoute] = useState(() => parseRoute());
  useEffect(() => {
    const listener = () => setRoute(parseRoute());
    globalThis.addEventListener("hashchange", listener);
    return () => globalThis.removeEventListener("hashchange", listener);
  }, []);
  return route;
}
