import { v } from "convex/values";
import { authedMutation, authedQuery } from "./lib/customFunctions";
import {
  MAX_ROUTINES,
  MAX_ROUTINE_EXERCISES,
} from "./lib/routinePlan";
import {
  findOpenSession,
  listOwnedRoutines,
  nextSortIndex,
  planFromOwnedSessions,
  presentRoutineExercises,
  requireOwnedRoutine,
  resolveRoutineExercises,
  routineNameOrThrow,
} from "./lib/routineRecords";

const targetFields = {
  targetSets: v.optional(v.number()),
  targetReps: v.optional(v.number()),
  targetWeightLb: v.optional(v.number()),
  targetDurationSec: v.optional(v.number()),
  targetDistanceM: v.optional(v.number()),
};

const exerciseInput = v.object({
  exerciseId: v.optional(v.id("exercises")),
  name: v.optional(v.string()),
  ...targetFields,
});

const exerciseDetail = v.object({
  exerciseId: v.id("exercises"),
  name: v.string(),
  targetSets: v.union(v.number(), v.null()),
  targetReps: v.union(v.number(), v.null()),
  targetWeightLb: v.union(v.number(), v.null()),
  targetDurationSec: v.union(v.number(), v.null()),
  targetDistanceM: v.union(v.number(), v.null()),
});

const routineSummary = v.object({
  _id: v.id("routines"),
  name: v.string(),
  exerciseCount: v.number(),
  exerciseNames: v.array(v.string()),
  exercises: v.array(exerciseDetail),
});

const startedResult = v.union(
  v.object({
    status: v.literal("started"),
    sessionId: v.id("sessions"),
  }),
  v.object({
    status: v.literal("alreadyOpen"),
    sessionId: v.id("sessions"),
  }),
);

export const list = authedQuery({
  args: {},
  returns: v.array(routineSummary),
  handler: async (ctx) => {
    const routines = await listOwnedRoutines(ctx, ctx.userId);
    const owned = routines.filter((routine) => routine.userId === ctx.userId);
    const presented = await Promise.all(
      owned.map(async (routine) => {
        const exercises = await presentRoutineExercises(
          ctx,
          ctx.userId,
          routine.exercises,
        );
        return {
          _id: routine._id,
          name: routine.name,
          exerciseCount: exercises.length,
          exerciseNames: exercises.map((exercise) => exercise.name),
          exercises,
        };
      }),
    );
    return presented;
  },
});

export const get = authedQuery({
  args: { routineId: v.string() },
  returns: v.union(routineSummary, v.null()),
  handler: async (ctx, args) => {
    const routineId = ctx.db.normalizeId("routines", args.routineId);
    if (!routineId) {
      return null;
    }
    const routine = await ctx.db.get("routines", routineId);
    if (!routine || routine.userId !== ctx.userId) {
      return null;
    }
    const exercises = await presentRoutineExercises(
      ctx,
      ctx.userId,
      routine.exercises,
    );
    return {
      _id: routine._id,
      name: routine.name,
      exerciseCount: exercises.length,
      exerciseNames: exercises.map((exercise) => exercise.name),
      exercises,
    };
  },
});

export const create = authedMutation({
  args: {
    name: v.string(),
    exercises: v.array(exerciseInput),
  },
  returns: v.id("routines"),
  handler: async (ctx, args) => {
    const existing = await listOwnedRoutines(ctx, ctx.userId);
    if (existing.length >= MAX_ROUTINES) {
      throw new Error(`You can save up to ${MAX_ROUTINES} routines`);
    }
    const name = routineNameOrThrow(args.name);
    const exercises = await resolveRoutineExercises(ctx, ctx.userId, args.exercises);
    const now = Date.now();
    return await ctx.db.insert("routines", {
      userId: ctx.userId,
      name,
      exercises,
      sortIndex: await nextSortIndex(ctx, ctx.userId),
      createdAt: now,
      updatedAt: now,
    });
  },
});

/** Builds a routine from one finished workout or from every workout on a day. */
export const createFromSessions = authedMutation({
  args: {
    name: v.string(),
    sessionIds: v.array(v.id("sessions")),
  },
  returns: v.id("routines"),
  handler: async (ctx, args) => {
    const existing = await listOwnedRoutines(ctx, ctx.userId);
    if (existing.length >= MAX_ROUTINES) {
      throw new Error(`You can save up to ${MAX_ROUTINES} routines`);
    }
    const name = routineNameOrThrow(args.name);
    const { plan } = await planFromOwnedSessions(ctx, ctx.userId, args.sessionIds);
    const now = Date.now();
    return await ctx.db.insert("routines", {
      userId: ctx.userId,
      name,
      exercises: plan,
      sortIndex: await nextSortIndex(ctx, ctx.userId),
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const update = authedMutation({
  args: {
    routineId: v.id("routines"),
    name: v.string(),
    exercises: v.array(exerciseInput),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const routine = await requireOwnedRoutine(ctx, ctx.userId, args.routineId);
    const name = routineNameOrThrow(args.name);
    const exercises = await resolveRoutineExercises(ctx, ctx.userId, args.exercises);
    await ctx.db.patch("routines", routine._id, {
      name,
      exercises,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const reorder = authedMutation({
  args: { routineIds: v.array(v.id("routines")) },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (args.routineIds.length > MAX_ROUTINES) {
      throw new Error(`You can save up to ${MAX_ROUTINES} routines`);
    }
    const routines = await listOwnedRoutines(ctx, ctx.userId);
    const owned = routines.filter((routine) => routine.userId === ctx.userId);
    if (owned.length !== args.routineIds.length) {
      throw new Error("Refresh and try that order again");
    }
    const byId = new Map(owned.map((routine) => [routine._id, routine]));
    const seen = new Set<string>();
    for (let index = 0; index < args.routineIds.length; index += 1) {
      const routineId = args.routineIds[index];
      if (!routineId || seen.has(routineId) || !byId.has(routineId)) {
        throw new Error("Routine not found");
      }
      seen.add(routineId);
      const routine = byId.get(routineId);
      if (routine && routine.sortIndex !== index) {
        await ctx.db.patch("routines", routineId, { sortIndex: index });
      }
    }
    return null;
  },
});

export const remove = authedMutation({
  args: { routineId: v.id("routines") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const routine = await requireOwnedRoutine(ctx, ctx.userId, args.routineId);
    await ctx.db.delete("routines", routine._id);
    return null;
  },
});

/**
 * Starts a workout from a saved routine. An open workout is left as it is:
 * the caller should offer to continue that one.
 */
export const begin = authedMutation({
  args: { routineId: v.id("routines") },
  returns: startedResult,
  handler: async (ctx, args) => {
    const open = await findOpenSession(ctx, ctx.userId);
    if (open) {
      return { status: "alreadyOpen" as const, sessionId: open._id };
    }
    const routine = await requireOwnedRoutine(ctx, ctx.userId, args.routineId);
    const plan = [];
    for (const exercise of routine.exercises) {
      const stored = await ctx.db.get("exercises", exercise.exerciseId);
      if (!stored || stored.userId !== ctx.userId) {
        continue;
      }
      plan.push(exercise);
    }
    if (plan.length === 0) {
      throw new Error("Add an exercise before starting this routine");
    }
    if (plan.length > MAX_ROUTINE_EXERCISES) {
      throw new Error(`A routine can have up to ${MAX_ROUTINE_EXERCISES} exercises`);
    }
    const sessionId = await ctx.db.insert("sessions", {
      userId: ctx.userId,
      status: "open",
      startedAt: Date.now(),
      planName: routine.name,
      routineId: routine._id,
      plan,
    });
    return { status: "started" as const, sessionId };
  },
});
