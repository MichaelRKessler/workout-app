import {
  LEGACY_SHELL_CACHE_NAME,
  MAX_CACHE_ENTRIES,
  NEVER_CACHE_PREFIXES,
  SHELL_CACHE_PREFIX,
  STATIC_PATHS,
  STATIC_PREFIXES,
} from "./cachePolicy.ts";

/**
 * Network-first service worker. Online loads always hit the network, so an
 * installed copy picks up new deploys. The cache is only the offline fallback.
 * Cross-origin requests (Google, Convex), /api/, and the OAuth `code` return
 * are not intercepted.
 *
 * Signed-in HTML contains the Convex login token. Navigations are stored only
 * after that token is removed. On activate, older caches (including
 * workout-shell-v1) are migrated without their tokens and then deleted, so an
 * already-installed copy drops previously cached pages.
 */
export function serviceWorkerSource(cacheName: string): string {
  return `const CACHE_NAME = ${JSON.stringify(cacheName)};
const MAX_ENTRIES = ${JSON.stringify(MAX_CACHE_ENTRIES)};
const LEGACY_CACHE_NAME = ${JSON.stringify(LEGACY_SHELL_CACHE_NAME)};
const CACHE_PREFIX = ${JSON.stringify(SHELL_CACHE_PREFIX)};
const NEVER_PREFIXES = ${JSON.stringify(NEVER_CACHE_PREFIXES)};
const STATIC_PREFIXES = ${JSON.stringify(STATIC_PREFIXES)};
const STATIC_PATHS = ${JSON.stringify(STATIC_PATHS)};

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      const next = await caches.open(CACHE_NAME);
      for (const key of keys) {
        if (key === CACHE_NAME) continue;
        if (key !== LEGACY_CACHE_NAME && !key.startsWith(CACHE_PREFIX)) continue;
        const previous = await caches.open(key);
        const requests = await previous.keys();
        for (const request of requests) {
          const response = await previous.match(request);
          if (!response) continue;
          const path = new URL(request.url).pathname;
          if (isStaticPath(path)) {
            try {
              await next.put(request, response);
            } catch {
              // A full quota should not keep the old token cache alive.
            }
            continue;
          }
          const type = response.headers.get("content-type") || "";
          if (!type.toLowerCase().includes("text/html")) continue;
          const sanitized = sanitizeCachedDocument(await response.text());
          if (!sanitized) continue;
          const headers = new Headers();
          headers.set("content-type", type);
          try {
            await next.put(request, new Response(sanitized, { status: 200, headers }));
          } catch {
            // Drop the page rather than keep the unsanitized original.
          }
        }
      }
      await trimCache(next);
      const remaining = await caches.keys();
      await Promise.all(
        remaining.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  if (request.headers.has("authorization")) return;
  if (request.headers.has("range")) return;
  if (request.headers.get("rsc") === "1") return;
  if (request.headers.has("next-router-prefetch")) return;
  if (request.headers.has("next-router-state-tree")) return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.searchParams.has("code")) return;
  for (const prefix of NEVER_PREFIXES) {
    if (url.pathname.startsWith(prefix)) return;
  }

  const isStatic = isStaticPath(url.pathname);
  if (request.mode !== "navigate" && !isStatic) return;

  event.respondWith(networkFirst(request));
});

function isStaticPath(pathname) {
  return STATIC_PATHS.includes(pathname) || STATIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (canStore(request, response)) {
      const copy = response.clone();
      try {
        const stored = await offlineCopy(request, copy);
        if (stored) {
          await cache.put(request, stored);
          await trimCache(cache);
        }
      } catch {
        // The network response is still returned when the cache is full.
      }
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    return new Response("You're offline. Reconnect, then open Workout again.", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}

function canStore(request, response) {
  if (!(response.ok && response.type === "basic" && !response.redirected && response.status === 200)) {
    return false;
  }
  const cacheControl = response.headers.get("cache-control") || "";
  const noStore = /(?:^|,)\\s*no-store\\b/i.test(cacheControl);
  if (request.mode === "navigate") {
    // Dynamic HTML is no-store because it contains the login token. Store a
    // sanitized copy below instead of this response.
    return true;
  }
  return !noStore;
}

async function offlineCopy(request, response) {
  if (request.mode !== "navigate") {
    return response;
  }
  const type = response.headers.get("content-type") || "";
  if (!type.toLowerCase().includes("text/html")) return null;
  const sanitized = sanitizeCachedDocument(await response.text());
  if (!sanitized) return null;
  const headers = new Headers();
  headers.set("content-type", type);
  return new Response(sanitized, { status: 200, headers });
}

function sanitizeCachedDocument(html) {
  if (typeof html !== "string" || html.length === 0 || html.length > 2000000) return null;
  var next = html.replace(/\\\\?"eyJ[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}\\\\?"/g, "null");
  next = next.replace(/(_timeFetched\\\\?":\\s*)\\d+/g, function (_match, prefix) {
    return prefix + "0";
  });
  if (/eyJ[A-Za-z0-9_-]{16,}/.test(next)) return null;
  return next;
}
/* end-sanitizeCachedDocument */

async function trimCache(cache) {
  const keys = await cache.keys();
  if (keys.length <= MAX_ENTRIES) return;
  const pages = [];
  const assets = [];
  for (const key of keys) {
    const path = new URL(key.url).pathname;
    if (isStaticPath(path)) assets.push(key);
    else pages.push(key);
  }
  let extra = keys.length - MAX_ENTRIES;
  for (const key of pages.concat(assets)) {
    if (extra <= 0) break;
    await cache.delete(key);
    extra -= 1;
  }
}
`;
}
