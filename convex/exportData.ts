import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { authedQuery } from "./lib/customFunctions";
import { normalizeSupersetItems } from "./lib/superset";
import { resolvedSetType } from "./lib/setType";

const setRow = v.object({
  loggedAt: v.number(),
  workoutStartedAt: v.number(),
  workoutId: v.id("sessions"),
  exercise: v.string(),
  setType: v.string(),
  reps: v.union(v.number(), v.null()),
  weightLb: v.number(),
  durationSec: v.union(v.number(), v.null()),
  distanceM: v.union(v.number(), v.null()),
  rpe: v.union(v.number(), v.null()),
  note: v.union(v.string(), v.null()),
  superset: v.union(v.string(), v.null()),
});

const bodyRow = v.object({
  loggedAt: v.number(),
  weightLb: v.union(v.number(), v.null()),
  bodyFatPct: v.union(v.number(), v.null()),
  waistCm: v.union(v.number(), v.null()),
  chestCm: v.union(v.number(), v.null()),
  armCm: v.union(v.number(), v.null()),
  hipsCm: v.union(v.number(), v.null()),
  thighCm: v.union(v.number(), v.null()),
  note: v.union(v.string(), v.null()),
});

const routineRow = v.object({
  routine: v.string(),
  sortIndex: v.number(),
  exerciseOrder: v.number(),
  exercise: v.string(),
  superset: v.union(v.string(), v.null()),
  targetSets: v.union(v.number(), v.null()),
  targetReps: v.union(v.number(), v.null()),
  targetWeightLb: v.union(v.number(), v.null()),
  targetDurationSec: v.union(v.number(), v.null()),
  targetDistanceM: v.union(v.number(), v.null()),
  restSeconds: v.union(v.number(), v.null()),
});

async function ownedSession(
  ctx: QueryCtx,
  userId: Id<"users">,
  sessionId: Id<"sessions">,
  cache: Map<string, { startedAt: number; note: string | null; supersetByExercise: Map<string, string> } | null>,
) {
  const cached = cache.get(sessionId);
  if (cached !== undefined) {
    return cached;
  }
  const session = await ctx.db.get("sessions", sessionId);
  if (!session || session.userId !== userId) {
    cache.set(sessionId, null);
    return null;
  }
  const grouped = normalizeSupersetItems(session.plan ?? []);
  const supersetByExercise = new Map<string, string>();
  for (const item of grouped) {
    if (item.supersetId) {
      supersetByExercise.set(item.exerciseId, item.supersetId);
    }
  }
  const value = {
    startedAt: session.startedAt,
    note: session.note ?? null,
    supersetByExercise,
  };
  cache.set(sessionId, value);
  return value;
}

/** One page of sets, oldest first. The browser asks for the next page until this is done. */
export const sets = authedQuery({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(setRow),
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("sets")
      .withIndex("by_user_and_logged", (q) => q.eq("userId", ctx.userId))
      .order("asc")
      .paginate(args.paginationOpts);

    const sessions = new Map<
      string,
      { startedAt: number; note: string | null; supersetByExercise: Map<string, string> } | null
    >();
    const names = new Map<string, string>();
    const page = [];
    for (const set of result.page) {
      if (set.userId !== ctx.userId) {
        continue;
      }
      const session = await ownedSession(ctx, ctx.userId, set.sessionId, sessions);
      if (!session) {
        continue;
      }
      let exerciseName = names.get(set.exerciseId);
      if (exerciseName === undefined) {
        const exercise = await ctx.db.get("exercises", set.exerciseId);
        exerciseName = exercise && exercise.userId === ctx.userId ? exercise.name : "Exercise";
        names.set(set.exerciseId, exerciseName);
      }
      page.push({
        loggedAt: set.loggedAt,
        workoutStartedAt: session.startedAt,
        workoutId: set.sessionId,
        exercise: exerciseName,
        setType: resolvedSetType(set.setType),
        reps: set.reps ?? null,
        weightLb: set.weightLb,
        durationSec: set.durationSec ?? null,
        distanceM: set.distanceM ?? null,
        rpe: set.rpe ?? null,
        note: session.note,
        superset: session.supersetByExercise.get(set.exerciseId) ?? null,
      });
    }
    return { ...result, page };
  },
});

/** One page of body entries, oldest first. */
export const body = authedQuery({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(bodyRow),
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("bodyEntries")
      .withIndex("by_user_and_logged", (q) => q.eq("userId", ctx.userId))
      .order("asc")
      .paginate(args.paginationOpts);
    return {
      ...result,
      page: result.page
        .filter((entry) => entry.userId === ctx.userId)
        .map((entry) => ({
          loggedAt: entry.loggedAt,
          weightLb: entry.weightLb ?? null,
          bodyFatPct: entry.bodyFatPct ?? null,
          waistCm: entry.waistCm ?? null,
          chestCm: entry.chestCm ?? null,
          armCm: entry.armCm ?? null,
          hipsCm: entry.hipsCm ?? null,
          thighCm: entry.thighCm ?? null,
          note: entry.note ?? null,
        })),
    };
  },
});

/** Every saved routine. The list is capped, so one read is enough. */
export const routines = authedQuery({
  args: {},
  returns: v.array(routineRow),
  handler: async (ctx) => {
    const routines = await ctx.db
      .query("routines")
      .withIndex("by_user_and_sort", (q) => q.eq("userId", ctx.userId))
      .take(40);
    const rows = [];
    for (const routine of routines) {
      if (routine.userId !== ctx.userId) {
        continue;
      }
      const grouped = normalizeSupersetItems(routine.exercises);
      let order = 0;
      for (const exercise of grouped) {
        order += 1;
        const stored = await ctx.db.get("exercises", exercise.exerciseId);
        if (!stored || stored.userId !== ctx.userId) {
          continue;
        }
        rows.push({
          routine: routine.name,
          sortIndex: routine.sortIndex,
          exerciseOrder: order,
          exercise: stored.name,
          superset: exercise.supersetId ?? null,
          targetSets: exercise.targetSets ?? null,
          targetReps: exercise.targetReps ?? null,
          targetWeightLb: exercise.targetWeightLb ?? null,
          targetDurationSec: exercise.targetDurationSec ?? null,
          targetDistanceM: exercise.targetDistanceM ?? null,
          restSeconds: stored.restSeconds ?? null,
        });
      }
    }
    return rows;
  },
});
