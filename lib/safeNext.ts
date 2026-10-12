const FALLBACK_ORIGIN = "https://local.invalid";

/**
 * A same-app path to return to after sign-in. Anything else stays on home.
 * Tab, CR, and LF are rejected before URL parsing because browsers strip them
 * and would turn "/\\t/evil.com" into a different origin. The result is only
 * pathname, search, and hash of a same-origin URL.
 */
export function safeNextPath(value: string | null | undefined, origin?: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 200) {
    return "/";
  }
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) < 0x20) {
      return "/";
    }
  }
  if (hasEncodedControl(value)) {
    return "/";
  }
  const base = httpOrigin(origin) ?? FALLBACK_ORIGIN;
  let url: URL;
  try {
    url = new URL(value, base);
  } catch {
    return "/";
  }
  if (url.origin !== base || url.username !== "" || url.password !== "") {
    return "/";
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

function httpOrigin(origin: string | undefined): string | null {
  if (!origin) {
    return null;
  }
  try {
    const url = new URL(origin);
    if (url.origin === "null" || (url.protocol !== "https:" && url.protocol !== "http:")) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

/** Percent-encoded C0 controls, so a second decode cannot revive a tab or newline. */
function hasEncodedControl(value: string): boolean {
  return /%(?:0[0-9a-fA-F]|1[0-9a-fA-F]|7[fF])/i.test(value);
}
