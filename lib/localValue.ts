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
