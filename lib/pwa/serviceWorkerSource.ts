import {
  LEGACY_SHELL_CACHE_NAME,
  MAX_CACHE_ENTRIES,
  NAVIGATION_TIMEOUT_MS,
  NEVER_CACHE_PREFIXES,
  SHELL_CACHE_PREFIX,
  STATIC_PATHS,
  STATIC_PREFIXES,
} from "./cachePolicy.ts";

/**
 * Network-first service worker. Online loads always ask the network, so an
 * installed copy picks up new deploys. A cached page is shown offline, or when
 * the network has not answered within NAVIGATION_TIMEOUT_MS. Responses stream
 * to the page while the offline copy is saved in the background.
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
const NAVIGATION_TIMEOUT_MS = ${JSON.stringify(NAVIGATION_TIMEOUT_MS)};

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

  if (request.mode === "navigate") {
    event.respondWith(navigation(event));
    return;
  }
  if (!isStaticPath(url.pathname)) return;

  event.respondWith(networkFirst(event));
});

function isStaticPath(pathname) {
  return STATIC_PATHS.includes(pathname) || STATIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function offlineResponse() {
  return new Response("You're offline. Reconnect, then open Spotter again.", {
    status: 503,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

async function cachedCopy(request) {
  try {
    const cache = await caches.open(CACHE_NAME);
    return (await cache.match(request)) || null;
  } catch {
    return null;
  }
}

// Pages: the network answer wins whenever it arrives in time. After
// NAVIGATION_TIMEOUT_MS a cached copy of the page, if there is one, is shown
// instead, and the late network answer still refreshes the cache. The answer
// streams to the page as it arrives; the offline copy is saved alongside.
function navigation(event) {
  const request = event.request;
  const network = fetch(request);
  event.waitUntil(network.then((response) => store(request, response), () => undefined));
  return new Promise((resolve) => {
    let settled = false;
    const finish = (response) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(response);
    };
    const timer = setTimeout(() => {
      void cachedCopy(request).then((cached) => {
        if (cached) finish(cached);
      });
    }, NAVIGATION_TIMEOUT_MS);
    network.then(finish, async () => {
      finish((await cachedCopy(request)) || offlineResponse());
    });
  });
}

// Clones before the first await, while the page has not started reading the body.
async function store(request, response) {
  if (!canStore(request, response)) return;
  let copy;
  try {
    copy = response.clone();
  } catch {
    return;
  }
  try {
    const cache = await caches.open(CACHE_NAME);
    const stored = await offlineCopy(request, copy);
    if (stored) {
      await cache.put(request, stored);
      await trimCache(cache);
    }
  } catch {
    // The network response is still returned when the cache is full.
  }
}

async function networkFirst(event) {
  const request = event.request;
  let response;
  try {
    response = await fetch(request);
  } catch {
    return (await cachedCopy(request)) || offlineResponse();
  }
  // Save the copy in the background so the page gets the file right away.
  event.waitUntil(store(request, response));
  return response;
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
