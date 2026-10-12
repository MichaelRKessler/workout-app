/** Same-origin prefixes the service worker must never cache or respond to. */
export const NEVER_CACHE_PREFIXES = ["/api/"];

/** Hashed build assets and icons. Network-first, then the offline fallback. */
export const STATIC_PREFIXES = ["/_next/static/", "/icons/"];

export const STATIC_PATHS = ["/manifest.webmanifest"];

/**
 * Previous installs used this exact name, so activate never deleted anything
 * and signed-in HTML (including the login token) accumulated. New caches use
 * a build id under a different prefix. Sign-out still deletes this name.
 */
export const LEGACY_SHELL_CACHE_NAME = "workout-shell-v1";

/** Prefix for every shell cache this app creates, including the legacy name. */
export const SHELL_CACHE_PREFIX = "workout-shell-";

/** Current caches are `workout-shell-v2-<build id>` so v1 is always purged. */
export const SHELL_CACHE_VERSION = "v2";

/** Cap cached responses so visited URLs cannot grow without bound. */
export const MAX_CACHE_ENTRIES = 200;

export type FetchDecision = "passthrough" | "network-first";

/**
 * What the service worker may intercept. Everything else is the browser's,
 * including Google sign-in, Convex, and /api/voice. The OAuth return carries
 * `code` and is also left to the browser so the worker cannot swallow it.
 */
export function fetchDecision(input: {
  method: string;
  url: string;
  pageOrigin: string;
  mode: string;
  hasAuthorization: boolean;
  hasRange: boolean;
  isRsc: boolean;
  isPrefetch: boolean;
}): FetchDecision {
  if (input.method !== "GET") {
    return "passthrough";
  }
  if (input.hasAuthorization || input.hasRange || input.isRsc || input.isPrefetch) {
    return "passthrough";
  }
  let url: URL;
  try {
    url = new URL(input.url);
  } catch {
    return "passthrough";
  }
  if (url.origin !== input.pageOrigin) {
    return "passthrough";
  }
  if (url.searchParams.has("code")) {
    return "passthrough";
  }
  for (const prefix of NEVER_CACHE_PREFIXES) {
    if (url.pathname.startsWith(prefix)) {
      return "passthrough";
    }
  }
  const isStatic = isStaticPath(url.pathname);
  if (input.mode === "navigate" || isStatic) {
    return "network-first";
  }
  return "passthrough";
}

export function isStaticPath(pathname: string): boolean {
  return (
    STATIC_PATHS.includes(pathname) ||
    STATIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  );
}

export function isShellCacheName(name: string): boolean {
  return name === LEGACY_SHELL_CACHE_NAME || name.startsWith(SHELL_CACHE_PREFIX);
}

/** Build-scoped cache name. Changing it makes activate drop every older cache. */
export function shellCacheName(buildId: string): string {
  const cleaned = buildId.replace(/[^A-Za-z0-9._-]/g, "").slice(0, 80);
  const id = cleaned.length > 0 ? cleaned : "dev";
  return `${SHELL_CACHE_PREFIX}${SHELL_CACHE_VERSION}-${id}`;
}

export function hasNoStore(cacheControl: string | null | undefined): boolean {
  return /(?:^|,)\s*no-store\b/i.test(cacheControl ?? "");
}

/**
 * A response may be stored only when it is the final successful resource.
 * `no-store` blocks an unchanged copy. Navigations are handled separately:
 * the worker stores a token-free document, never this response as-is.
 */
export function mayStoreResponse(input: {
  ok: boolean;
  type: string;
  redirected: boolean;
  status: number;
  cacheControl?: string | null;
}): boolean {
  if (!input.ok || input.type !== "basic" || input.redirected || input.status !== 200) {
    return false;
  }
  if (hasNoStore(input.cacheControl)) {
    return false;
  }
  return true;
}

/**
 * Remove Convex Auth's server token from an HTML document before it is cached.
 * The fetch time is zeroed so the client keeps the token in localStorage
 * instead of treating this shell as a sign-out. Returns null when a
 * token-shaped value is still present.
 */
export function sanitizeCachedDocument(html: string): string | null {
  if (typeof html !== "string" || html.length === 0 || html.length > 2_000_000) {
    return null;
  }
  const next = html
    .replace(/\\?"eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\\?"/g, "null")
    .replace(/_timeFetched\\?":\s*\d+/g, (match) => match.replace(/\d+$/, "0"));
  if (/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/.test(next)) {
    return null;
  }
  return next;
}

export type CachedEntryKind = "static" | "document" | "drop";

/** What to carry out of an old cache when the worker activates. */
export function cachedEntryKind(pathname: string, contentType: string | null): CachedEntryKind {
  if (isStaticPath(pathname)) {
    return "static";
  }
  if ((contentType ?? "").toLowerCase().includes("text/html")) {
    return "document";
  }
  return "drop";
}
