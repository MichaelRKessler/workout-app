import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { authedMutation, authedQuery } from "./lib/customFunctions";
import {
  MAX_SETS_PER_BATCH,
  assertReps,
  assertSessionCanAcceptSets,
  assertWeightLb,
  getOrCreateExercise,
  getOwnedSession,
  requireOpenSession,
} from "./lib/workouts";

const setValidator = v.object({
  _id: v.id("sets"),
  exerciseId: v.id("exercises"),
  exerciseName: v.string(),
  reps: v.number(),
  weightLb: v.number(),
  loggedAt: v.number(),
});

const setInput = v.object({
  reps: v.number(),
  weightLb: v.number(),
});

export const listForSession = authedQuery({
  args: { sessionId: v.id("sessions") },
  returns: v.array(setValidator),
  handler: async (ctx, args) => {
    const session = await getOwnedSession(ctx, ctx.userId, args.sessionId);
    if (!session) {
      return [];
    }

    const sets = await ctx.db
      .query("sets")
      .withIndex("by_session_and_exercise", (q) =>
        q.eq("sessionId", session._id),
      )
      .take(500);
    const ordered = [...sets].sort((left, right) => left.loggedAt - right.loggedAt);

    return await Promise.all(
      ordered.map(async (set) => {
        const exercise = await ctx.db.get("exercises", set.exerciseId);
        return {
          _id: set._id,
          exerciseId: set.exerciseId,
          exerciseName: exercise?.name ?? "Exercise",
          reps: set.reps,
          weightLb: set.weightLb,
          loggedAt: set.loggedAt,
        };
      }),
    );
  },
});

async function insertSets(
  ctx: MutationCtx,
  userId: Id<"users">,
  sessionId: Id<"sessions">,
  exerciseName: string,
  sets: Array<{ reps: number; weightLb: number }>,
): Promise<Array<Id<"sets">>> {
  if (sets.length > MAX_SETS_PER_BATCH) {
    throw new Error(`Log up to ${MAX_SETS_PER_BATCH} sets at a time`);
  }

  const validated = sets.map((set) => ({
    reps: assertReps(set.reps),
    weightLb: assertWeightLb(set.weightLb),
  }));
  await assertSessionCanAcceptSets(ctx, sessionId, validated.length);
  const exerciseId = await getOrCreateExercise(ctx, userId, exerciseName);

  const loggedAt = Date.now();
  const ids: Array<Id<"sets">> = [];
  for (let index = 0; index < validated.length; index += 1) {
    const set = validated[index];
    if (!set) {
      continue;
    }
    // One millisecond apart so a batch keeps its confirmed order when sorted
    // by loggedAt, even if the writes share the same clock reading.
    ids.push(
      await ctx.db.insert("sets", {
        userId,
        sessionId,
        exerciseId,
        reps: set.reps,
        weightLb: set.weightLb,
        loggedAt: loggedAt + index,
      }),
    );
  }
  return ids;
}

export const log = authedMutation({
  args: {
    sessionId: v.id("sessions"),
    exerciseName: v.string(),
    reps: v.number(),
    weightLb: v.number(),
  },
  returns: v.id("sets"),
  handler: async (ctx, args) => {
    const session = await requireOpenSession(ctx, ctx.userId, args.sessionId);
    const [setId] = await insertSets(ctx, ctx.userId, session._id, args.exerciseName, [
      { reps: args.reps, weightLb: args.weightLb },
    ]);
    if (!setId) {
      throw new Error("Add at least one set");
    }
    return setId;
  },
});

export const logMany = authedMutation({
  args: {
    sessionId: v.id("sessions"),
    exerciseName: v.string(),
    sets: v.array(setInput),
  },
  returns: v.array(v.id("sets")),
  handler: async (ctx, args) => {
    if (args.sets.length === 0) {
      throw new Error("Add at least one set");
    }
    const session = await requireOpenSession(ctx, ctx.userId, args.sessionId);
    return await insertSets(
      ctx,
      ctx.userId,
      session._id,
      args.exerciseName,
      args.sets,
    );
  },
});

export const remove = authedMutation({
  args: { setId: v.id("sets") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await deleteOwnedSets(ctx, ctx.userId, [args.setId]);
    return null;
  },
});

export const removeMany = authedMutation({
  args: { setIds: v.array(v.id("sets")) },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (args.setIds.length === 0) {
      throw new Error("Choose at least one set");
    }
    if (args.setIds.length > MAX_SETS_PER_BATCH) {
      throw new Error(`Remove up to ${MAX_SETS_PER_BATCH} sets at a time`);
    }
    await deleteOwnedSets(ctx, ctx.userId, args.setIds);
    return null;
  },
});

async function deleteOwnedSets(
  ctx: MutationCtx,
  userId: Id<"users">,
  setIds: Array<Id<"sets">>,
): Promise<void> {
  const uniqueIds: Array<Id<"sets">> = [];
  const seen = new Set<string>();
  for (const setId of setIds) {
    if (!seen.has(setId)) {
      seen.add(setId);
      uniqueIds.push(setId);
    }
  }

  let sessionId: Id<"sessions"> | null = null;
  for (const setId of uniqueIds) {
    const set = await ctx.db.get("sets", setId);
    if (!set || set.userId !== userId) {
      throw new Error("Set not found");
    }
    if (sessionId === null) {
      sessionId = set.sessionId;
    } else if (set.sessionId !== sessionId) {
      throw new Error("Sets must belong to the same workout");
    }
  }

  if (sessionId === null) {
    throw new Error("Choose at least one set");
  }
  await requireOpenSession(ctx, userId, sessionId);

  for (const setId of uniqueIds) {
    await ctx.db.delete("sets", setId);
  }
}
