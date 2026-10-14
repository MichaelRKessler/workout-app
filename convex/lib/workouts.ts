import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  exerciseNameKey,
  formatExerciseName,
  legacyExerciseNameKey,
  MAX_KNOWN_EXERCISE_NAMES,
  type FormattedExerciseName,
} from "./exerciseName";
import { normalizeStoredSet, type NormalizedSet } from "./measures";
import { MAX_REPS, MIN_REPS, REPS_MESSAGE, wholeInRange } from "./setLimits";
import { persistedSetType, resolvedSetType, type SetType } from "./setType";
import { userError } from "./errors";

export const MAX_SETS_PER_SESSION = 500;

/** Exercises checked for an old-key spelling match before a new one is made. */
const LEGACY_SCAN = 500;

/** One confirmed voice list, and one Undo of that list. */
export const MAX_SETS_PER_BATCH = 30;

export async function getOwnedSession(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  sessionId: Id<"sessions">,
) {
  const session = await ctx.db.get("sessions", sessionId);
  if (!session || session.userId !== userId) {
    return null;
  }
  return session;
}

/**
 * The exercise a typed name means, whatever its spelling. Exercises saved
 * before spelling variants matched keep their old key until the cleanup
 * rewrites it, so a name that misses falls back to that key.
 */
export async function findExerciseByName(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  formatted: FormattedExerciseName,
): Promise<Doc<"exercises"> | null> {
  const byKey = await ctx.db
    .query("exercises")
    .withIndex("by_user_and_normalized_name", (q) =>
      q.eq("userId", userId).eq("normalizedName", formatted.normalizedName),
    )
    .first();
  if (byKey) {
    return byKey;
  }
  const legacyKey = legacyExerciseNameKey(formatted.name);
  if (legacyKey !== formatted.normalizedName) {
    const byLegacyKey = await ctx.db
      .query("exercises")
      .withIndex("by_user_and_normalized_name", (q) =>
        q.eq("userId", userId).eq("normalizedName", legacyKey),
      )
      .first();
    if (byLegacyKey) {
      return byLegacyKey;
    }
  }
  // An old key can be another spelling, such as "sit-ups" for "Sit ups".
  // Only a library that still has old keys needs this scan.
  const library = await ctx.db
    .query("exercises")
    .withIndex("by_user_and_normalized_name", (q) => q.eq("userId", userId))
    .take(LEGACY_SCAN);
  return (
    library.find(
      (exercise) =>
        exercise.normalizedName !== exerciseNameKey(exercise.name) &&
        exerciseNameKey(exercise.name) === formatted.normalizedName,
    ) ?? null
  );
}

export async function getOrCreateExercise(
  ctx: MutationCtx,
  userId: Id<"users">,
  rawName: string,
): Promise<Id<"exercises">> {
  const formatted = formatExerciseName(rawName);
  if (!formatted) {
    throw userError("Exercise name must be 1 to 80 characters");
  }

  const existing = await findExerciseByName(ctx, userId, formatted);

  if (existing) {
    return existing._id;
  }

  return await ctx.db.insert("exercises", {
    userId,
    name: formatted.name,
    normalizedName: formatted.normalizedName,
    createdAt: Date.now(),
  });
}

export function assertReps(reps: number): number {
  if (!wholeInRange(reps, MIN_REPS, MAX_REPS)) {
    throw userError(REPS_MESSAGE);
  }
  return reps;
}

export function assertWeightLb(weightLb: number): number {
  if (!Number.isFinite(weightLb) || weightLb < 0 || weightLb > 2000) {
    throw userError("Weight must be between 0 and 2000 lb");
  }
  return Math.round(weightLb * 100) / 100;
}

export function presentSet(set: {
  reps?: number;
  weightLb: number;
  durationSec?: number;
  distanceM?: number;
  calories?: number;
  rpe?: number;
  setType?: SetType;
}) {
  return {
    reps: set.reps ?? null,
    weightLb: set.weightLb,
    durationSec: set.durationSec ?? null,
    distanceM: set.distanceM ?? null,
    calories: set.calories ?? null,
    rpe: set.rpe ?? null,
    setType: resolvedSetType(set.setType),
  };
}

export function recordPoint(set: {
  reps?: number | null;
  weightLb: number;
  durationSec?: number | null;
  distanceM?: number | null;
  calories?: number | null;
  setType?: SetType | null;
  sessionId?: string;
}) {
  return {
    reps: set.reps ?? null,
    weightLb: set.weightLb,
    durationSec: set.durationSec ?? null,
    distanceM: set.distanceM ?? null,
    calories: set.calories ?? null,
    setType: resolvedSetType(set.setType),
    ...(set.sessionId !== undefined ? { sessionId: set.sessionId } : {}),
  };
}

/** Measure fields for an insert or replace. Working omits setType. */
export function storedSetFields(set: NormalizedSet) {
  return {
    weightLb: set.weightLb,
    ...(set.reps !== undefined ? { reps: set.reps } : {}),
    ...(set.durationSec !== undefined ? { durationSec: set.durationSec } : {}),
    ...(set.distanceM !== undefined ? { distanceM: set.distanceM } : {}),
    ...(set.calories !== undefined ? { calories: set.calories } : {}),
    ...(set.rpe !== undefined ? { rpe: set.rpe } : {}),
    ...persistedSetType(set.setType),
  };
}

export function normalizeSetInput(input: {
  reps?: number | null;
  weightLb?: number | null;
  durationSec?: number | null;
  distanceM?: number | null;
  calories?: number | null;
  rpe?: number | null;
  setType?: SetType | null;
}): NormalizedSet {
  return normalizeStoredSet(input);
}

export async function requireOpenSession(
  ctx: MutationCtx,
  userId: Id<"users">,
  sessionId: Id<"sessions">,
) {
  const session = await getOwnedSession(ctx, userId, sessionId);
  if (!session) {
    throw userError("Workout not found");
  }
  if (session.status !== "open") {
    throw userError("This workout is already finished");
  }
  return session;
}

/** The owner's open or finished workout. Finished workouts can be corrected. */
export async function requireWritableSession(
  ctx: MutationCtx,
  userId: Id<"users">,
  sessionId: Id<"sessions">,
) {
  const session = await getOwnedSession(ctx, userId, sessionId);
  if (!session) {
    throw userError("Workout not found");
  }
  return session;
}

/** Newest sets for one exercise, by when they were performed. */
export const EXERCISE_RECORD_SCAN = 2000;

export async function loadRecentSetsForExercise(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  exerciseId: Id<"exercises">,
) {
  return await ctx.db
    .query("sets")
    .withIndex("by_user_exercise_and_logged", (q) =>
      q.eq("userId", userId).eq("exerciseId", exerciseId),
    )
    .order("desc")
    .take(EXERCISE_RECORD_SCAN + 1);
}

/** Sets performed strictly before this moment, newest first. Later workouts are left out. */
export async function loadSetsBefore(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  exerciseId: Id<"exercises">,
  loggedBefore: number,
) {
  return await ctx.db
    .query("sets")
    .withIndex("by_user_exercise_and_logged", (q) =>
      q.eq("userId", userId).eq("exerciseId", exerciseId).lt("loggedAt", loggedBefore),
    )
    .order("desc")
    .take(EXERCISE_RECORD_SCAN);
}

export async function assertSessionCanAcceptSets(
  ctx: MutationCtx,
  sessionId: Id<"sessions">,
  adding: number,
): Promise<void> {
  if (adding < 1) {
    throw userError("Add at least one set");
  }
  const session = await ctx.db.get("sessions", sessionId);
  if (session && session.setCount !== undefined) {
    if (session.setCount + adding > MAX_SETS_PER_SESSION) {
      throw userError("This workout already has 500 sets");
    }
    return;
  }
  const existing = await ctx.db
    .query("sets")
    .withIndex("by_session_and_exercise", (q) => q.eq("sessionId", sessionId))
    .take(MAX_SETS_PER_SESSION);
  if (existing.length + adding > MAX_SETS_PER_SESSION) {
    throw userError("This workout already has 500 sets");
  }
}

const VOICE_SESSION_SCAN = 20;

export type PreviousSet = {
  reps: number | null;
  weightLb: number;
  durationSec: number | null;
  distanceM: number | null;
  calories: number | null;
  rpe: number | null;
  setType: SetType;
};

export type PreviousExerciseSets = {
  exerciseName: string;
  normalizedName: string;
  sets: PreviousSet[];
};

/**
 * Sets from the newest workout that includes this exercise, excluding the
 * open one when the caller passes it. Ordered oldest set to newest set.
 */
export async function loadPreviousExerciseSets(
  ctx: QueryCtx,
  userId: Id<"users">,
  rawName: string,
  excludeSessionId: Id<"sessions"> | undefined,
): Promise<PreviousExerciseSets | null> {
  const formatted = formatExerciseName(rawName);
  if (!formatted) {
    return null;
  }

  const exercise = await findExerciseByName(ctx, userId, formatted);
  if (!exercise || exercise.userId !== userId) {
    return null;
  }

  const recent = await ctx.db
    .query("sets")
    .withIndex("by_user_exercise_and_logged", (q) =>
      q.eq("userId", userId).eq("exerciseId", exercise._id),
    )
    .order("desc")
    .take(MAX_SETS_PER_SESSION);

  const picked = setsFromNewestSession(recent, excludeSessionId);
  if (picked) {
    return previousSetsResult(exercise, picked);
  }

  // The newest window was entirely the excluded workout. Look through earlier
  // workouts one session at a time. A query can paginate only once, so this
  // uses bounded takes instead.
  const excludedEntireWindow =
    excludeSessionId !== undefined &&
    recent.length === MAX_SETS_PER_SESSION &&
    recent.every((set) => set.sessionId === excludeSessionId);
  if (!excludedEntireWindow) {
    return null;
  }

  const completed = await ctx.db
    .query("sessions")
    .withIndex("by_user_status_and_started", (q) =>
      q.eq("userId", userId).eq("status", "completed"),
    )
    .order("desc")
    .take(VOICE_SESSION_SCAN);

  for (const session of completed) {
    if (session._id === excludeSessionId) {
      continue;
    }
    const sets = await ctx.db
      .query("sets")
      .withIndex("by_session_and_exercise", (q) =>
        q.eq("sessionId", session._id).eq("exerciseId", exercise._id),
      )
      .take(MAX_SETS_PER_SESSION);
    if (sets.length > 0) {
      return previousSetsResult(exercise, sets);
    }
  }

  return null;
}

function setsFromNewestSession(
  sets: Array<Doc<"sets">>,
  excludeSessionId: Id<"sessions"> | undefined,
): Array<Doc<"sets">> | null {
  let targetSession: Id<"sessions"> | null = null;
  const matched: Array<Doc<"sets">> = [];
  for (const set of sets) {
    if (excludeSessionId && set.sessionId === excludeSessionId) {
      continue;
    }
    if (targetSession === null) {
      targetSession = set.sessionId;
    }
    if (set.sessionId !== targetSession) {
      break;
    }
    matched.push(set);
  }
  return matched.length > 0 ? matched : null;
}

function compareSetsAscending(left: Doc<"sets">, right: Doc<"sets">): number {
  if (left.loggedAt !== right.loggedAt) {
    return left.loggedAt - right.loggedAt;
  }
  return left._creationTime - right._creationTime;
}

function compareSetsDescending(left: Doc<"sets">, right: Doc<"sets">): number {
  return compareSetsAscending(right, left);
}

function previousSetsResult(
  exercise: Doc<"exercises">,
  sets: Array<Doc<"sets">>,
): PreviousExerciseSets {
  const ordered = [...sets].sort(compareSetsAscending);
  return {
    exerciseName: exercise.name,
    normalizedName: exerciseNameKey(exercise.name),
    sets: ordered.map((set) => ({
      reps: set.reps ?? null,
      weightLb: set.weightLb,
      durationSec: set.durationSec ?? null,
      distanceM: set.distanceM ?? null,
      calories: set.calories ?? null,
      rpe: set.rpe ?? null,
      setType: resolvedSetType(set.setType),
    })),
  };
}

/** Recent names first, then the rest of this user's library, capped. */
export async function loadVoiceExerciseNames(
  ctx: QueryCtx,
  userId: Id<"users">,
): Promise<string[]> {
  const names: string[] = [];
  const seen = new Set<string>();

  const add = (raw: string) => {
    if (names.length >= MAX_KNOWN_EXERCISE_NAMES) {
      return;
    }
    const formatted = formatExerciseName(raw);
    if (!formatted || seen.has(formatted.normalizedName)) {
      return;
    }
    seen.add(formatted.normalizedName);
    names.push(formatted.name);
  };

  const open = await ctx.db
    .query("sessions")
    .withIndex("by_user_status_and_started", (q) =>
      q.eq("userId", userId).eq("status", "open"),
    )
    .order("desc")
    .take(1);
  const completed = await ctx.db
    .query("sessions")
    .withIndex("by_user_status_and_started", (q) =>
      q.eq("userId", userId).eq("status", "completed"),
    )
    .order("desc")
    .take(VOICE_SESSION_SCAN);

  for (const session of [...open, ...completed]) {
    if (names.length >= MAX_KNOWN_EXERCISE_NAMES) {
      break;
    }
    const sets = await ctx.db
      .query("sets")
      .withIndex("by_session_and_exercise", (q) => q.eq("sessionId", session._id))
      .take(MAX_SETS_PER_SESSION);
    const ordered = [...sets].sort(compareSetsDescending);
    const exerciseIds: Array<Id<"exercises">> = [];
    const seenIds = new Set<string>();
    for (const set of ordered) {
      if (seenIds.has(set.exerciseId)) {
        continue;
      }
      seenIds.add(set.exerciseId);
      exerciseIds.push(set.exerciseId);
    }
    const exercises = await Promise.all(
      exerciseIds.map(async (exerciseId) => await ctx.db.get("exercises", exerciseId)),
    );
    for (const exercise of exercises) {
      if (exercise && exercise.userId === userId) {
        add(exercise.name);
      }
    }
  }

  if (names.length < MAX_KNOWN_EXERCISE_NAMES) {
    const library = await ctx.db
      .query("exercises")
      .withIndex("by_user_and_normalized_name", (q) => q.eq("userId", userId))
      .take(MAX_KNOWN_EXERCISE_NAMES);
    const extras = [...library].sort((left, right) => left.name.localeCompare(right.name));
    for (const exercise of extras) {
      if (exercise.userId === userId) {
        add(exercise.name);
      }
    }
  }

  return names;
}
