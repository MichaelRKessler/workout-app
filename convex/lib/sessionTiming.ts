/**
 * Pure timing rules shared by the client and Convex mutations.
 * Do not import Convex server code from this file.
 *
 * Idle time starts at the newest logged set. A "Keep going" answer counts too,
 * so the prompt does not immediately return. The workout's start time is the
 * clock only when it still has no sets.
 */

/** Ask "Still working out?" after this much inactivity. */
export const STALE_PROMPT_MS = 2 * 60 * 60 * 1000;

/** Finish or discard an open workout after this much inactivity. */
export const STALE_CLOSE_MS = 4 * 60 * 60 * 1000;

/**
 * Abandoned workouts end this long after the last set, so History includes
 * a short rest but not the hours the app was left open.
 */
export const STALE_END_MARGIN_MS = 15 * 60 * 1000;

export function idleMs(
  now: number,
  startedAt: number,
  lastSetAt: number | null,
  resumedAt: number | null,
): number {
  // A set logged an hour ago keeps the workout open even if it started yesterday.
  const activityAt = Math.max(lastSetAt ?? startedAt, resumedAt ?? 0);
  return now - activityAt;
}

/** True when an open workout with sets has been idle long enough to ask. */
export function workoutLooksStale(
  now: number,
  startedAt: number,
  lastSetAt: number | null,
  resumedAt: number | null,
): boolean {
  if (lastSetAt === null) {
    return false;
  }
  return idleMs(now, startedAt, lastSetAt, resumedAt) >= STALE_PROMPT_MS;
}

export function shouldCloseAbandoned(
  now: number,
  startedAt: number,
  lastSetAt: number | null,
  resumedAt: number | null,
): boolean {
  return idleMs(now, startedAt, lastSetAt, resumedAt) >= STALE_CLOSE_MS;
}

export function abandonedCompletedAt(
  now: number,
  startedAt: number,
  lastSetAt: number,
): number {
  const proposed = lastSetAt + STALE_END_MARGIN_MS;
  return Math.min(now, Math.max(startedAt, proposed));
}

/**
 * End time stored on a finished workout.
 * A caller may pass one. Otherwise a stale workout ends just after its last
 * set, and an active workout ends now.
 */
export function plannedCompletedAt(input: {
  now: number;
  startedAt: number;
  lastSetAt: number;
  explicit?: number;
}): number {
  if (input.explicit !== undefined) {
    if (!Number.isFinite(input.explicit)) {
      throw new Error("End time must be a time");
    }
    if (input.explicit < input.startedAt) {
      throw new Error("End time can't be before the workout started");
    }
    if (input.explicit < input.lastSetAt) {
      throw new Error("End time can't be before the last set");
    }
    if (input.explicit > input.now) {
      throw new Error("End time can't be in the future");
    }
    return input.explicit;
  }

  if (input.now - input.lastSetAt >= STALE_PROMPT_MS) {
    return abandonedCompletedAt(input.now, input.startedAt, input.lastSetAt);
  }
  return input.now;
}
