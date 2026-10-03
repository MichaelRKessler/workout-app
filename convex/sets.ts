import { v } from "convex/values";
import { authedMutation, authedQuery } from "./lib/customFunctions";
import {
  assertReps,
  assertSessionCanAcceptSet,
  assertWeightLb,
  getOrCreateExercise,
  getOwnedSession,
} from "./lib/workouts";

const setValidator = v.object({
  _id: v.id("sets"),
  exerciseId: v.id("exercises"),
  exerciseName: v.string(),
  reps: v.number(),
  weightLb: v.number(),
  loggedAt: v.number(),
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

export const log = authedMutation({
  args: {
    sessionId: v.id("sessions"),
    exerciseName: v.string(),
    reps: v.number(),
    weightLb: v.number(),
  },
  returns: v.id("sets"),
  handler: async (ctx, args) => {
    const session = await getOwnedSession(ctx, ctx.userId, args.sessionId);
    if (!session) {
      throw new Error("Workout not found");
    }
    if (session.status !== "open") {
      throw new Error("This workout is already finished");
    }

    const reps = assertReps(args.reps);
    const weightLb = assertWeightLb(args.weightLb);
    await assertSessionCanAcceptSet(ctx, session._id);
    const exerciseId = await getOrCreateExercise(
      ctx,
      ctx.userId,
      args.exerciseName,
    );

    const existingForExercise = await ctx.db
      .query("sets")
      .withIndex("by_session_and_exercise", (q) =>
        q.eq("sessionId", session._id).eq("exerciseId", exerciseId),
      )
      .take(500);

    return await ctx.db.insert("sets", {
      userId: ctx.userId,
      sessionId: session._id,
      exerciseId,
      reps,
      weightLb,
      order: existingForExercise.length + 1,
      loggedAt: Date.now(),
    });
  },
});

export const remove = authedMutation({
  args: { setId: v.id("sets") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const set = await ctx.db.get("sets", args.setId);
    if (!set || set.userId !== ctx.userId) {
      throw new Error("Set not found");
    }

    const session = await getOwnedSession(ctx, ctx.userId, set.sessionId);
    if (!session) {
      throw new Error("Workout not found");
    }
    if (session.status !== "open") {
      throw new Error("This workout is already finished");
    }

    await ctx.db.delete("sets", set._id);
    return null;
  },
});
