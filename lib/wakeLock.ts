type HeldLock = { release: () => Promise<void> };

export function createScreenWakeLock(deps: {
  isVisible: () => boolean;
  request: () => Promise<HeldLock | null>;
}) {
  let current: HeldLock | null = null;
  let stopped = false;
  let requestInFlight = false;

  async function sync() {
    if (stopped || !deps.isVisible() || requestInFlight) {
      return;
    }
    requestInFlight = true;
    try {
      const next = await deps.request();
      if (stopped || !deps.isVisible()) {
        if (next) {
          await next.release().catch(() => undefined);
        }
        return;
      }
      const previous = current;
      current = next;
      if (previous && previous !== next) {
        await previous.release().catch(() => undefined);
      }
    } finally {
      requestInFlight = false;
    }
  }

  async function stop() {
    stopped = true;
    const held = current;
    current = null;
    if (held) {
      await held.release().catch(() => undefined);
    }
  }

  return {
    sync,
    stop,
    onVisibilityChange: () => {
      void sync();
    },
  };
}

export async function requestScreenWakeLock(): Promise<HeldLock | null> {
  if (typeof navigator === "undefined" || !("wakeLock" in navigator)) {
    return null;
  }
  const request = navigator.wakeLock?.request;
  if (typeof request !== "function") {
    return null;
  }
  try {
    return await request.call(navigator.wakeLock, "screen");
  } catch {
    return null;
  }
}
