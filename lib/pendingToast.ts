const KEY = "workout-pending-toast";

export function stashToast(message: string): void {
  try {
    sessionStorage.setItem(KEY, message);
  } catch {
    // Private mode can reject storage. The workout is still saved.
  }
}

export function takeToast(): string | null {
  try {
    const value = sessionStorage.getItem(KEY);
    if (value) {
      sessionStorage.removeItem(KEY);
    }
    return value;
  } catch {
    return null;
  }
}
