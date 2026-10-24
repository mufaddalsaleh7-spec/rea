/**
 * TallyCraft service worker.
 *
 * The point is availability, not speed tricks: a preview proxy can drop a
 * port, a static host can be offline, and the app must still open, show the
 * last known book and let the operator keep reading. So:
 *
 *   navigation  → network first (fresh boot data), cached shell when it fails
 *   /api/*      → network first, last good JSON when it fails
 *   assets      → cache first, refreshed in the background
 *
 * Every path is resolved against the worker's own scope, so the same file
 * works when the app is served from `/` by the Node server and from
 * `/rea/` on GitHub Pages or any subdirectory.
 *
 * Bump VERSION whenever the shell changes; old caches are deleted on activate.
 */

const VERSION = "tallycraft-v2";
const SHELL_CACHE = `${VERSION}-shell`;
const DATA_CACHE = `${VERSION}-data`;

// Relative to the worker's scope: "/" in a normal deployment, "/rea/" on a
// project site. Never root-absolute, or a subpath deploy 404s every asset.
const SHELL = [
  "./",
  "index.html",
  "app.js",
  "styles.css",
  "manifest.webmanifest",
  "icons/icon.svg",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "favicon.ico",
];

/** Resolve one shell path against the registration scope. */
const scopeUrl = (path) => new URL(path, self.registration.scope).href;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // One missing file must not fail the whole install; the server build has
      // no `app.js` sibling when the client was inlined, for instance.
      await Promise.all(
        SHELL.map((path) =>
          cache
            .add(new Request(scopeUrl(path), { cache: "reload" }))
            .catch(() => {}),
        ),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => !name.startsWith(VERSION))
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

async function fromCache(name, request) {
  const cache = await caches.open(name);
  return (await cache.match(request)) ?? null;
}

async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch (error) {
    const cached = await fromCache(cacheName, request);
    if (cached !== null) return cached;
    throw error;
  }
}

async function cacheFirst(request, cacheName) {
  const cached = await fromCache(cacheName, request);
  if (cached !== null) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(cacheName);
    cache.put(request, response.clone()).catch(() => {});
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/api/")) {
    // Reads stay useful offline; writes must fail loudly, never be faked.
    event.respondWith(networkFirst(request, DATA_CACHE));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          return await networkFirst(request, SHELL_CACHE);
        } catch (error) {
          const shell =
            (await fromCache(SHELL_CACHE, scopeUrl("./"))) ??
            (await fromCache(SHELL_CACHE, scopeUrl("index.html")));
          if (shell !== null) return shell;
          throw error;
        }
      })(),
    );
    return;
  }

  event.respondWith(cacheFirst(request, SHELL_CACHE));
});
