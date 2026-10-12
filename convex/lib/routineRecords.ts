import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  MAX_REPEAT_SESSIONS,
  MAX_ROUTINE_EXERCISES,
  MAX_ROUTINES,
  normalizeRoutineName,
  normalizeTargets,
  planFromPerformedSets,
  repointExercises,
  type PerformedSet,
  type PlanExercise,
  type RoutineExercise,
  type RoutineTargets,
} from "./routinePlan";
import { userError } from "./errors";
import { setExerciseRest } from "./rest";
import { carrySupersetIds, cleanSupersetId, withStoredSuperset } from "./superset";
import { getOrCreateExercise, getOwnedSession } from "./workouts";

type Reader = QueryCtx | MutationCtx;

export async function findOpenSession(ctx: Reader, userId: Id<"users">) {
  return await ctx.db
    .query("sessions")
    .withIndex("by_user_status_and_started", (q) =>
      q.eq("userId", userId).eq("status", "open"),
    )
    .order("desc")
    .first();
}

export async function listOwnedRoutines(ctx: Reader, userId: Id<"users">) {
  return await ctx.db
    .query("routines")
    .withIndex("by_user_and_sort", (q) => q.eq("userId", userId))
    .take(MAX_ROUTINES + 1);
}

export async function requireOwnedRoutine(
  ctx: Reader,
  userId: Id<"users">,
  routineId: Id<"routines">,
) {
  const routine = await ctx.db.get("routines", routineId);
  if (!routine || routine.userId !== userId) {
    throw userError("Routine not found");
  }
  return routine;
}

export async function resolveRoutineExercises(
  ctx: MutationCtx,
  userId: Id<"users">,
  exercises: Array<{
    exerciseId?: Id<"exercises">;
    name?: string;
    targetSets?: number;
    targetReps?: number;
    targetWeightLb?: number;
    targetDurationSec?: number;
    targetDistanceM?: number;
    targetCalories?: number;
    restSeconds?: number | null;
    supersetId?: string;
  }>,
): Promise<Array<RoutineTargets & { exerciseId: Id<"exercises">; supersetId?: string }>> {
  if (exercises.length < 1) {
    throw userError("Add at least one exercise");
  }
  if (exercises.length > MAX_ROUTINE_EXERCISES) {
    throw userError(`A routine can have up to ${MAX_ROUTINE_EXERCISES} exercises`);
  }

  const resolved: Array<RoutineTargets & { exerciseId: Id<"exercises">; supersetId?: string }> = [];
  const seen = new Set<string>();
  for (const exercise of exercises) {
    const exerciseId = await resolveExerciseId(ctx, userId, exercise);
    if (seen.has(exerciseId)) {
      throw userError("Each exercise can be in a routine once");
    }
    seen.add(exerciseId);
    if (exercise.restSeconds !== undefined) {
      const stored = await ctx.db.get("exercises", exerciseId);
      if (!stored || stored.userId !== userId) {
        throw userError("Exercise not found");
      }
      await setExerciseRest(ctx, userId, stored, exercise.restSeconds);
    }
    const supersetId = cleanSupersetId(exercise.supersetId);
    resolved.push({
      exerciseId,
      ...normalizeTargets(exercise),
      ...(supersetId ? { supersetId } : {}),
    });
  }
  return withStoredSuperset(resolved);
}

async function resolveExerciseId(
  ctx: MutationCtx,
  userId: Id<"users">,
  exercise: { exerciseId?: Id<"exercises">; name?: string },
): Promise<Id<"exercises">> {
  if (exercise.exerciseId) {
    const stored = await ctx.db.get("exercises", exercise.exerciseId);
    if (!stored || stored.userId !== userId) {
      throw userError("Exercise not found");
    }
    return stored._id;
  }
  if (!exercise.name) {
    throw userError("Name each exercise");
  }
  return await getOrCreateExercise(ctx, userId, exercise.name);
}

export async function exerciseNames(
  ctx: Reader,
  userId: Id<"users">,
  exercises: Array<{ exerciseId: string }>,
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  for (const exercise of exercises) {
    if (names.has(exercise.exerciseId)) {
      continue;
    }
    const exerciseId = ctx.db.normalizeId("exercises", exercise.exerciseId);
    if (!exerciseId) {
      continue;
    }
    const stored = await ctx.db.get("exercises", exerciseId);
    if (stored && stored.userId === userId) {
      names.set(stored._id, stored.name);
    }
  }
  return names;
}

export function presentTargets(target: RoutineTargets) {
  return {
    targetSets: target.targetSets ?? null,
    targetReps: target.targetReps ?? null,
    targetWeightLb: target.targetWeightLb ?? null,
    targetDurationSec: target.targetDurationSec ?? null,
    targetDistanceM: target.targetDistanceM ?? null,
    targetCalories: target.targetCalories ?? null,
  };
}

export async function presentRoutineExercises(
  ctx: Reader,
  userId: Id<"users">,
  exercises: RoutineExercise[],
) {
  const presented = [];
  for (const exercise of exercises) {
    const exerciseId = ctx.db.normalizeId("exercises", exercise.exerciseId);
    if (!exerciseId) {
      continue;
    }
    const stored = await ctx.db.get("exercises", exerciseId);
    if (!stored || stored.userId !== userId) {
      continue;
    }
    presented.push({
      exerciseId,
      name: stored.name,
      restSeconds: stored.restSeconds ?? null,
      supersetId: exercise.supersetId ?? null,
      ...presentTargets(exercise),
    });
  }
  return withStoredSuperset(presented).map((exercise) => ({
    ...exercise,
    supersetId: exercise.supersetId ?? null,
  }));
}

export async function nextSortIndex(ctx: Reader, userId: Id<"users">): Promise<number> {
  const latest = await ctx.db
    .query("routines")
    .withIndex("by_user_and_sort", (q) => q.eq("userId", userId))
    .order("desc")
    .first();
  return (latest?.sortIndex ?? -1) + 1;
}

export function normalizePlanInput(
  exercises: Array<RoutineTargets & { exerciseId: string; skipped?: boolean; supersetId?: string }>,
): PlanExercise[] {
  if (exercises.length > MAX_ROUTINE_EXERCISES) {
    throw userError(`A plan can have up to ${MAX_ROUTINE_EXERCISES} exercises`);
  }
  const seen = new Set<string>();
  const mapped = exercises.map((exercise) => {
    if (seen.has(exercise.exerciseId)) {
      throw userError("Each exercise can be in the plan once");
    }
    seen.add(exercise.exerciseId);
    const supersetId = cleanSupersetId(exercise.supersetId);
    return {
      exerciseId: exercise.exerciseId,
      ...normalizeTargets(exercise),
      ...(exercise.skipped ? { skipped: true } : {}),
      ...(supersetId ? { supersetId } : {}),
    };
  });
  return withStoredSuperset(mapped);
}

export async function assertOwnedPlan(
  ctx: Reader,
  userId: Id<"users">,
  plan: PlanExercise[],
): Promise<Array<PlanExercise & { exerciseId: Id<"exercises"> }>> {
  const owned: Array<PlanExercise & { exerciseId: Id<"exercises"> }> = [];
  for (const item of plan) {
    const exerciseId = ctx.db.normalizeId("exercises", item.exerciseId);
    if (!exerciseId) {
      throw userError("Exercise not found");
    }
    const stored = await ctx.db.get("exercises", exerciseId);
    if (!stored || stored.userId !== userId) {
      throw userError("Exercise not found");
    }
    owned.push({ ...item, exerciseId });
  }
  return owned;
}

export async function planFromOwnedSessions(
  ctx: Reader,
  userId: Id<"users">,
  sessionIds: Id<"sessions">[],
): Promise<{
  plan: Array<RoutineTargets & { exerciseId: Id<"exercises"> }>;
  planName: string | null;
}> {
  if (sessionIds.length < 1) {
    throw userError("Pick a workout to repeat");
  }
  if (sessionIds.length > MAX_REPEAT_SESSIONS) {
    throw userError(`Repeat up to ${MAX_REPEAT_SESSIONS} workouts at once`);
  }

  const sessions: Doc<"sessions">[] = [];
  const seen = new Set<string>();
  for (const sessionId of sessionIds) {
    if (seen.has(sessionId)) {
      throw userError("That workout was listed twice");
    }
    seen.add(sessionId);
    const session = await getOwnedSession(ctx, userId, sessionId);
    if (!session || session.status !== "completed") {
      throw userError("Workout not found");
    }
    sessions.push(session);
  }
  sessions.sort((left, right) => left.startedAt - right.startedAt);

  const performed: PerformedSet[] = [];
  for (const session of sessions) {
    const sets = await ctx.db
      .query("sets")
      .withIndex("by_session_and_exercise", (q) => q.eq("sessionId", session._id))
      .take(500);
    for (const set of sets) {
      if (set.userId !== userId) {
        throw userError("Workout not found");
      }
      performed.push({
        exerciseId: set.exerciseId,
        reps: set.reps ?? null,
        weightLb: set.weightLb,
        durationSec: set.durationSec ?? null,
        distanceM: set.distanceM ?? null,
        calories: set.calories ?? null,
        loggedAt: set.loggedAt,
      });
    }
  }

  const derived = planFromPerformedSets(performed);
  if (derived.length < 1) {
    throw userError("That workout has no exercises");
  }
  if (derived.length > MAX_ROUTINE_EXERCISES) {
    throw userError(`A routine can have up to ${MAX_ROUTINE_EXERCISES} exercises`);
  }
  const carried = carrySupersetIds(
    derived,
    sessions.map((session) => session.plan ?? []),
  );
  const plan = withStoredSuperset(carried).map((item) => {
    const exerciseId = ctx.db.normalizeId("exercises", item.exerciseId);
    if (!exerciseId) {
      throw userError("Exercise not found");
    }
    return { ...item, exerciseId };
  });
  return { plan, planName: null };
}

/** Open workouts repointed in one merge batch. There is normally one. */
const OPEN_SESSION_LIMIT = 500;

export async function repointSessionPlan(
  ctx: MutationCtx,
  userId: Id<"users">,
  session: Doc<"sessions">,
  fromId: Id<"exercises">,
  intoId: Id<"exercises">,
): Promise<void> {
  if (session.userId !== userId || !session.plan) {
    return;
  }
  const next = repointExercises(session.plan, fromId, intoId);
  if (!next.changed) {
    return;
  }
  await ctx.db.patch("sessions", session._id, {
    plan: withStoredSuperset(next.items),
  });
}

/**
 * Point routines, open workouts, and the finished workouts that owned the
 * moved sets at the exercise that won a merge. Finished workouts are passed
 * in: their sets just changed hands, and the plan has to follow or the
 * superset label no longer matches.
 */
export async function repointExerciseReferences(
  ctx: MutationCtx,
  userId: Id<"users">,
  fromId: Id<"exercises">,
  intoId: Id<"exercises">,
  sessionIds: ReadonlyArray<Id<"sessions">> = [],
): Promise<void> {
  const routines = await listOwnedRoutines(ctx, userId);
  for (const routine of routines) {
    if (routine.userId !== userId) {
      continue;
    }
    const next = repointExercises(routine.exercises, fromId, intoId);
    if (next.changed) {
      await ctx.db.patch("routines", routine._id, {
        exercises: withStoredSuperset(next.items),
      });
    }
  }

  const seen = new Set<string>();
  for (const sessionId of sessionIds) {
    if (seen.has(sessionId)) {
      continue;
    }
    seen.add(sessionId);
    const session = await ctx.db.get("sessions", sessionId);
    if (!session) {
      continue;
    }
    await repointSessionPlan(ctx, userId, session, fromId, intoId);
  }

  // One indexed read: Convex allows a single paginated query per function.
  const open = await ctx.db
    .query("sessions")
    .withIndex("by_user_status_and_started", (q) =>
      q.eq("userId", userId).eq("status", "open"),
    )
    .take(OPEN_SESSION_LIMIT + 1);
  if (open.length > OPEN_SESSION_LIMIT) {
    throw userError("Too many open workouts to update");
  }
  for (const session of open) {
    if (seen.has(session._id)) {
      continue;
    }
    seen.add(session._id);
    await repointSessionPlan(ctx, userId, session, fromId, intoId);
  }
}

export function routineNameOrThrow(raw: string): string {
  return normalizeRoutineName(raw);
}
