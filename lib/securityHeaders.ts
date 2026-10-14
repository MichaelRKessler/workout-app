/**
 * Clickjacking and fetch backstop. Next.js and the install-prompt script need
 * inline scripts and styles. connect-src allows Convex websockets and HTTP.
 * Google sign-in is a top-level navigation, so it is not a connect-src host.
 * Exercise demo photos load from jsDelivr. The microphone is allowed on this
 * origin only. Wake lock is left at the
 * browser default so an active workout can still keep the screen on.
 */
export const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://cdn.jsdelivr.net",
  "font-src 'self'",
  "connect-src 'self' https://*.convex.cloud wss://*.convex.cloud https://*.convex.site wss://*.convex.site",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "media-src 'self' blob:",
].join("; ");

export const securityHeaders: Array<{ key: string; value: string }> = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "microphone=(self)" },
];
