/**
 * Device settings kept in localStorage, such as the rest length and the
 * History view. Some browsers throw on any storage access when site data is
 * blocked, or on writes when storage is full. A failed read gives null (the
 * default) and a failed write is skipped, so the setting just isn't kept.
 */
export function readLocal(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeLocal(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // The setting lasts for this visit only.
  }
}

/**
 * Tab state kept in sessionStorage while you leave a page and come back, such
 * as a running rest or text typed in the composer. The same failure rules as
 * above apply. A null value removes the key.
 */
export function readSession(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeSession(key: string, value: string | null): void {
  try {
    if (value === null) {
      window.sessionStorage.removeItem(key);
    } else {
      window.sessionStorage.setItem(key, value);
    }
  } catch {
    // The state lasts until this page closes.
  }
}
