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
import { setExerciseRest } from "./rest";
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
    throw new Error("Routine not found");
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
    restSeconds?: number | null;
  }>,
): Promise<Array<RoutineTargets & { exerciseId: Id<"exercises"> }>> {
  if (exercises.length < 1) {
    throw new Error("Add at least one exercise");
  }
  if (exercises.length > MAX_ROUTINE_EXERCISES) {
    throw new Error(`A routine can have up to ${MAX_ROUTINE_EXERCISES} exercises`);
  }

  const resolved: Array<RoutineTargets & { exerciseId: Id<"exercises"> }> = [];
  const seen = new Set<string>();
  for (const exercise of exercises) {
    const exerciseId = await resolveExerciseId(ctx, userId, exercise);
    if (seen.has(exerciseId)) {
      throw new Error("Each exercise can be in a routine once");
    }
    seen.add(exerciseId);
    if (exercise.restSeconds !== undefined) {
      const stored = await ctx.db.get("exercises", exerciseId);
      if (!stored || stored.userId !== userId) {
        throw new Error("Exercise not found");
      }
      await setExerciseRest(ctx, userId, stored, exercise.restSeconds);
    }
    resolved.push({
      exerciseId,
      ...normalizeTargets(exercise),
    });
  }
  return resolved;
}

async function resolveExerciseId(
  ctx: MutationCtx,
  userId: Id<"users">,
  exercise: { exerciseId?: Id<"exercises">; name?: string },
): Promise<Id<"exercises">> {
  if (exercise.exerciseId) {
    const stored = await ctx.db.get("exercises", exercise.exerciseId);
    if (!stored || stored.userId !== userId) {
      throw new Error("Exercise not found");
    }
    return stored._id;
  }
  if (!exercise.name) {
    throw new Error("Name each exercise");
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
      ...presentTargets(exercise),
    });
  }
  return presented;
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
  exercises: Array<RoutineTargets & { exerciseId: string; skipped?: boolean }>,
): PlanExercise[] {
  if (exercises.length > MAX_ROUTINE_EXERCISES) {
    throw new Error(`A plan can have up to ${MAX_ROUTINE_EXERCISES} exercises`);
  }
  const seen = new Set<string>();
  return exercises.map((exercise) => {
    if (seen.has(exercise.exerciseId)) {
      throw new Error("Each exercise can be in the plan once");
    }
    seen.add(exercise.exerciseId);
    return {
      exerciseId: exercise.exerciseId,
      ...normalizeTargets(exercise),
      ...(exercise.skipped ? { skipped: true } : {}),
    };
  });
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
      throw new Error("Exercise not found");
    }
    const stored = await ctx.db.get("exercises", exerciseId);
    if (!stored || stored.userId !== userId) {
      throw new Error("Exercise not found");
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
    throw new Error("Pick a workout to repeat");
  }
  if (sessionIds.length > MAX_REPEAT_SESSIONS) {
    throw new Error(`Repeat up to ${MAX_REPEAT_SESSIONS} workouts at once`);
  }

  const sessions: Doc<"sessions">[] = [];
  const seen = new Set<string>();
  for (const sessionId of sessionIds) {
    if (seen.has(sessionId)) {
      throw new Error("That workout was listed twice");
    }
    seen.add(sessionId);
    const session = await getOwnedSession(ctx, userId, sessionId);
    if (!session || session.status !== "completed") {
      throw new Error("Workout not found");
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
        throw new Error("Workout not found");
      }
      performed.push({
        exerciseId: set.exerciseId,
        reps: set.reps ?? null,
        weightLb: set.weightLb,
        durationSec: set.durationSec ?? null,
        distanceM: set.distanceM ?? null,
        loggedAt: set.loggedAt,
      });
    }
  }

  const derived = planFromPerformedSets(performed);
  if (derived.length < 1) {
    throw new Error("That workout has no exercises");
  }
  if (derived.length > MAX_ROUTINE_EXERCISES) {
    throw new Error(`A routine can have up to ${MAX_ROUTINE_EXERCISES} exercises`);
  }
  const plan = derived.map((item) => {
    const exerciseId = ctx.db.normalizeId("exercises", item.exerciseId);
    if (!exerciseId) {
      throw new Error("Exercise not found");
    }
    return { ...item, exerciseId };
  });
  return { plan, planName: null };
}

export async function repointExerciseReferences(
  ctx: MutationCtx,
  userId: Id<"users">,
  fromId: Id<"exercises">,
  intoId: Id<"exercises">,
): Promise<void> {
  const routines = await listOwnedRoutines(ctx, userId);
  for (const routine of routines) {
    if (routine.userId !== userId) {
      continue;
    }
    const next = repointExercises(routine.exercises, fromId, intoId);
    if (next.changed) {
      await ctx.db.patch("routines", routine._id, { exercises: next.items });
    }
  }

  const openSessions = await ctx.db
    .query("sessions")
    .withIndex("by_user_status_and_started", (q) =>
      q.eq("userId", userId).eq("status", "open"),
    )
    .take(10);
  for (const session of openSessions) {
    if (!session.plan || session.userId !== userId) {
      continue;
    }
    const next = repointExercises(session.plan, fromId, intoId);
    if (next.changed) {
      await ctx.db.patch("sessions", session._id, { plan: next.items });
    }
  }
}

export function routineNameOrThrow(raw: string): string {
  return normalizeRoutineName(raw);
}
