export const INSTALLED_DISPLAY_MODES = [
  "standalone",
  "fullscreen",
  "minimal-ui",
  "window-controls-overlay",
] as const;

export function isInstalledDisplayMode(mode: string): boolean {
  return (INSTALLED_DISPLAY_MODES as readonly string[]).includes(mode);
}

/**
 * A link from another site must not start a workout by itself. The installed
 * app's shortcuts open in standalone with an empty referrer (or the Android
 * launcher referrer) and keep the one-tap behavior.
 */
export function startNeedsConfirmation(input: {
  installed: boolean;
  referrer: string;
  pageOrigin: string;
}): boolean {
  if (!input.installed) {
    return true;
  }
  const referrer = input.referrer.trim();
  if (referrer.length === 0) {
    return false;
  }
  let url: URL;
  try {
    url = new URL(referrer);
  } catch {
    return true;
  }
  if (url.protocol === "android-app:") {
    return false;
  }
  return url.origin !== input.pageOrigin;
}

export function startConfirmCopy(input: {
  action: string | null;
  routineId: string | null;
}): { title: string; body: string; confirmLabel: string } {
  if (input.routineId) {
    return {
      title: "Start this routine?",
      body: "This link will start a workout from that routine.",
      confirmLabel: "Start routine",
    };
  }
  if (input.action === "repeat") {
    return {
      title: "Repeat your last workout?",
      body: "This link will start a workout from your latest session.",
      confirmLabel: "Repeat workout",
    };
  }
  return {
    title: "Start a workout?",
    body: "This link will start a workout on your account.",
    confirmLabel: "Start workout",
  };
}
