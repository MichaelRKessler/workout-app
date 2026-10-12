export const INSTALLED_DISPLAY_MODES = [
  "standalone",
  "fullscreen",
  "minimal-ui",
  "window-controls-overlay",
] as const;

export function isInstalledDisplayMode(mode: string): boolean {
  return (INSTALLED_DISPLAY_MODES as readonly string[]).includes(mode);
}

/** Added to the manifest's shortcut links so /start knows a tap came from one. */
export const SHORTCUT_SOURCE = "shortcut";

/**
 * A link from another site or app must not start a workout by itself. Android
 * reports any app that opened the link (Gmail, WhatsApp) the same way as the
 * launcher, so only the app's own shortcuts, marked with `source=shortcut`,
 * keep the one-tap start. Links inside the app keep it too.
 */
export function startNeedsConfirmation(input: {
  installed: boolean;
  referrer: string;
  pageOrigin: string;
  source: string | null;
}): boolean {
  if (!input.installed) {
    return true;
  }
  const referrer = input.referrer.trim();
  const fromShortcut = input.source === SHORTCUT_SOURCE;
  if (referrer.length === 0) {
    return !fromShortcut;
  }
  let url: URL;
  try {
    url = new URL(referrer);
  } catch {
    return true;
  }
  if (url.protocol === "android-app:") {
    return !fromShortcut;
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
