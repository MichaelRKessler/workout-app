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

/**
 * A ± tap after a set. A running rest moves its end. Once rest is done or
 * skipped, + starts one more step of rest and − only shortens the next rest.
 * With no rest yet, either starts one at the new length.
 */
export function bumpRest(input: {
  endsAt: number | null;
  now: number;
  seconds: number;
  direction: -1 | 1;
}): { endsAt: number | null; seconds: number; restarted: boolean } {
  const { endsAt, now, seconds, direction } = input;
  if (endsAt !== null && endsAt <= now) {
    if (direction === 1) {
      return { endsAt: now + REST_STEP_SECONDS * 1000, seconds, restarted: true };
    }
    return { endsAt, seconds: adjustRestSeconds(seconds, -1), restarted: false };
  }
  const next = adjustRestSeconds(seconds, direction);
  if (endsAt === null) {
    return { endsAt: restEndFrom(now, next), seconds: next, restarted: true };
  }
  return { endsAt: shiftActiveRest(endsAt, now, seconds, next), seconds: next, restarted: false };
}

/** The countdown interval runs only while time is left. */
export function restIntervalActive(endsAt: number | null, now: number): boolean {
  return endsAt !== null && endsAt > now;
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

/** The countdown of the open workout, kept while a progress page is open. */
export const REST_RUN_KEY = "workout-rest-run";

export type SavedRest = {
  /** The workout this rest belongs to, so another workout never inherits it. */
  workout: string;
  endsAt: number;
  seconds: number;
  skipped: boolean;
};

export function savedRestValue(rest: SavedRest): string {
  return JSON.stringify(rest);
}

/**
 * A rest saved by this tab for the same workout. A countdown longer than the
 * longest rest is from a changed clock and is dropped.
 */
export function readSavedRest(stored: string | null, workout: string, now: number): SavedRest | null {
  if (stored === null) {
    return null;
  }
  let value: unknown;
  try {
    value = JSON.parse(stored);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const rest = value as Record<string, unknown>;
  if (rest.workout !== workout || typeof rest.endsAt !== "number" || !Number.isFinite(rest.endsAt)) {
    return null;
  }
  if (rest.endsAt - now > MAX_REST_SECONDS * 1000) {
    return null;
  }
  return {
    workout,
    endsAt: rest.endsAt,
    seconds: clampRestSeconds(Number(rest.seconds)),
    skipped: rest.skipped === true,
  };
}
