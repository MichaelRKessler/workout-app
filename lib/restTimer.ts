import {
  clampRestSeconds,
  DEFAULT_REST_SECONDS,
  MAX_REST_SECONDS,
  MIN_REST_SECONDS,
  REST_STEP_SECONDS,
} from "../convex/lib/rest.ts";

export {
  clampRestSeconds,
  DEFAULT_REST_SECONDS,
  MAX_REST_SECONDS,
  MIN_REST_SECONDS,
  REST_STEP_SECONDS,
};

export const REST_STORAGE_KEY = "workout-rest-seconds";
export const REST_VIBRATION_PATTERN = [180, 80, 180];

export function readRestSeconds(stored: string | null): number {
  if (stored === null || stored.trim() === "") {
    return DEFAULT_REST_SECONDS;
  }
  return clampRestSeconds(Number(stored));
}

export function adjustRestSeconds(current: number, direction: -1 | 1): number {
  return clampRestSeconds(current + direction * REST_STEP_SECONDS);
}

/** Shifts a running countdown. A finished or idle timer stays as it is. */
export function shiftActiveRest(
  endsAt: number | null,
  now: number,
  previousSeconds: number,
  nextSeconds: number,
): number | null {
  if (endsAt === null || endsAt <= now) {
    return endsAt;
  }
  return endsAt + (nextSeconds - previousSeconds) * 1000;
}

export function restEndFrom(now: number, seconds: number): number {
  return now + clampRestSeconds(seconds) * 1000;
}

export function shouldVibrateRest(remainingMs: number, alreadyVibrated: boolean): boolean {
  return remainingMs <= 0 && !alreadyVibrated;
}

export function vibrateForRest(
  vibrate: ((pattern: number | number[]) => boolean) | undefined,
): void {
  if (!vibrate) {
    return;
  }
  try {
    vibrate(REST_VIBRATION_PATTERN);
  } catch {
    // Vibration can throw when the browser blocks it. The timer still finishes.
  }
}
