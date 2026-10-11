/** Same-origin prefixes the service worker must never cache or respond to. */
export const NEVER_CACHE_PREFIXES = ["/api/"];

/** Hashed build assets and icons. Network-first, then the offline fallback. */
export const STATIC_PREFIXES = ["/_next/static/", "/icons/"];

export const STATIC_PATHS = ["/manifest.webmanifest"];

export const SHELL_CACHE_NAME = "workout-shell-v1";

export type FetchDecision = "passthrough" | "network-first";

/**
 * What the service worker may intercept. Everything else is the browser's,
 * including Google sign-in, Convex, and /api/voice.
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
  for (const prefix of NEVER_CACHE_PREFIXES) {
    if (url.pathname.startsWith(prefix)) {
      return "passthrough";
    }
  }
  const isStatic =
    STATIC_PATHS.includes(url.pathname) ||
    STATIC_PREFIXES.some((prefix) => url.pathname.startsWith(prefix));
  if (input.mode === "navigate" || isStatic) {
    return "network-first";
  }
  return "passthrough";
}

/** A response may be stored only when it is the final page, not a redirect. */
export function mayStoreResponse(input: {
  ok: boolean;
  type: string;
  redirected: boolean;
  status: number;
}): boolean {
  return input.ok && input.type === "basic" && !input.redirected && input.status === 200;
}
