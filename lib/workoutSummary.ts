import { volumeLb } from "../convex/lib/records.ts";
import { resolvedSetType, type SetType } from "../convex/lib/setType.ts";

/**
 * A strength set has no stored duration. It is logged when it ends, so the
 * last 30 seconds of the gap before that timestamp count as the set. Timed
 * and distance sets use their stored duration instead. Anything left in the
 * gap, plus time after the last set, is rest.
 */
export const ASSUMED_SET_MS = 30_000;

export type SummarySet = {
  exerciseId: string;
  reps?: number | null;
  weightLb: number;
  durationSec?: number | null;
  distanceM?: number | null;
  calories?: number | null;
  setType?: SetType | null;
  loggedAt: number;
};

export type SummarySession = {
  startedAt: number;
  completedAt: number | null;
  sets: SummarySet[];
};

export type WorkoutSummary = {
  /** Null when the workout's length was never recorded. */
  totalMs: number | null;
  activeMs: number | null;
  restMs: number | null;
  exerciseCount: number;
  /** Warm-ups are not included. Drop sets and failure sets are. */
  setCount: number;
  warmupCount: number;
  volumeLb: number;
  /** Meters, warm-ups excluded. */
  distanceM: number;
  /** Kilocalories, warm-ups excluded. Drop sets count. */
  calories: number;
};

/**
 * Totals for one finished workout, or for every workout on a history day.
 * Each session's clock is split on its own, so the hours between two
 * workouts on the same day are not rest.
 */
export function summarizeSessions(sessions: SummarySession[]): WorkoutSummary {
  const exercises = new Set<string>();
  let setCount = 0;
  let warmupCount = 0;
  let distanceM = 0;
  let calories = 0;
  const sets: SummarySet[] = [];
  let totalMs = 0;
  let activeMs = 0;
  let timedSessions = 0;

  for (const session of sessions) {
    for (const set of session.sets) {
      sets.push(set);
      if (resolvedSetType(set.setType) === "warmup") {
        warmupCount += 1;
        continue;
      }
      exercises.add(set.exerciseId);
      setCount += 1;
      if ((set.distanceM ?? 0) > 0) {
        distanceM += set.distanceM ?? 0;
      }
      if ((set.calories ?? 0) > 0) {
        calories += set.calories ?? 0;
      }
    }
    const clock = sessionClock(session);
    if (!clock) {
      continue;
    }
    timedSessions += 1;
    totalMs += clock.totalMs;
    activeMs += clock.activeMs;
  }

  const hasClock = timedSessions > 0;
  return {
    totalMs: hasClock ? totalMs : null,
    activeMs: hasClock ? activeMs : null,
    restMs: hasClock ? Math.max(0, totalMs - activeMs) : null,
    exerciseCount: exercises.size,
    setCount,
    warmupCount,
    volumeLb: volumeLb(sets),
    distanceM: Math.round(distanceM * 100) / 100,
    calories,
  };
}

function sessionClock(session: SummarySession): { totalMs: number; activeMs: number } | null {
  const end = session.completedAt;
  if (end === null || !(end > session.startedAt)) {
    return null;
  }
  const totalMs = end - session.startedAt;
  const ordered = [...session.sets].sort((left, right) => left.loggedAt - right.loggedAt);
  let cursor = session.startedAt;
  let activeMs = 0;
  for (const set of ordered) {
    const at = Math.min(end, Math.max(session.startedAt, set.loggedAt));
    const gap = Math.max(0, at - cursor);
    activeMs += activeInGap(set, gap);
    cursor = Math.max(cursor, at);
  }
  return { totalMs, activeMs: Math.min(activeMs, totalMs) };
}

function activeInGap(set: SummarySet, gapMs: number): number {
  const known = set.durationSec != null && set.durationSec > 0 ? set.durationSec * 1000 : null;
  if (known !== null) {
    return Math.min(gapMs, known);
  }
  return Math.min(gapMs, ASSUMED_SET_MS);
}

/** Rounded minutes that add up: active + rest = total. Total is at least 1. */
export function summaryMinutes(
  totalMs: number,
  activeMs: number,
): { total: number; active: number; rest: number } {
  const total = Math.max(1, Math.round(totalMs / 60_000));
  const active = Math.min(total, Math.max(0, Math.round(activeMs / 60_000)));
  return { total, active, rest: total - active };
}

export function formatSummaryMinutes(minutes: number): string {
  if (minutes <= 0) {
    return "0 min";
  }
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}
