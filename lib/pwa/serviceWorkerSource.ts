import {
  NEVER_CACHE_PREFIXES,
  SHELL_CACHE_NAME,
  STATIC_PATHS,
  STATIC_PREFIXES,
} from "./cachePolicy.ts";

/**
 * Network-first service worker. Online loads always hit the network, so an
 * installed copy picks up new deploys. The cache is only the offline fallback.
 * Cross-origin requests (Google, Convex) and /api/ are not intercepted.
 */
export function serviceWorkerSource(): string {
  return `const CACHE_NAME = ${JSON.stringify(SHELL_CACHE_NAME)};
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
      await Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)),
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
  for (const prefix of NEVER_PREFIXES) {
    if (url.pathname.startsWith(prefix)) return;
  }

  const isStatic =
    STATIC_PATHS.includes(url.pathname) ||
    STATIC_PREFIXES.some((prefix) => url.pathname.startsWith(prefix));
  if (request.mode !== "navigate" && !isStatic) return;

  event.respondWith(networkFirst(request));
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (canStore(response)) {
      try {
        await cache.put(request, response.clone());
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

function canStore(response) {
  return response.ok && response.type === "basic" && !response.redirected && response.status === 200;
}
`;
}
