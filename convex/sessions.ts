import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { authedMutation, authedQuery } from "./lib/customFunctions";
import { getOwnedSession } from "./lib/workouts";

const exerciseSummaryValidator = v.object({
  exerciseId: v.id("exercises"),
  name: v.string(),
  setCount: v.number(),
});

const historyItemValidator = v.object({
  _id: v.id("sessions"),
  startedAt: v.number(),
  completedAt: v.number(),
  exercises: v.array(exerciseSummaryValidator),
});

const setDetailValidator = v.object({
  _id: v.id("sets"),
  exerciseId: v.id("exercises"),
  exerciseName: v.string(),
  reps: v.number(),
  weightLb: v.number(),
  loggedAt: v.number(),
});

const sessionDetailValidator = v.object({
  _id: v.id("sessions"),
  status: v.union(v.literal("open"), v.literal("completed")),
  startedAt: v.number(),
  completedAt: v.union(v.number(), v.null()),
  exercises: v.array(exerciseSummaryValidator),
  sets: v.array(setDetailValidator),
});

async function loadSessionSets(ctx: QueryCtx, sessionId: Id<"sessions">) {
  const sets = await ctx.db
    .query("sets")
    .withIndex("by_session_and_exercise", (q) => q.eq("sessionId", sessionId))
    .take(500);

  const ordered = [...sets].sort((left, right) => left.loggedAt - right.loggedAt);
  const exerciseIds = [...new Set(ordered.map((set) => set.exerciseId))];
  const exercises = await Promise.all(
    exerciseIds.map(async (exerciseId) => {
      return await ctx.db.get("exercises", exerciseId);
    }),
  );
  const names = new Map<Id<"exercises">, string>();
  for (const exercise of exercises) {
    if (exercise) {
      names.set(exercise._id, exercise.name);
    }
  }

  return ordered.map((set) => ({
    _id: set._id,
    exerciseId: set.exerciseId,
    exerciseName: names.get(set.exerciseId) ?? "Exercise",
    reps: set.reps,
    weightLb: set.weightLb,
    loggedAt: set.loggedAt,
  }));
}

function summarizeExercises(
  sets: Array<{ exerciseId: Id<"exercises">; exerciseName: string }>,
) {
  const summaries: Array<{
    exerciseId: Id<"exercises">;
    name: string;
    setCount: number;
  }> = [];
  for (const set of sets) {
    const existing = summaries.find(
      (summary) => summary.exerciseId === set.exerciseId,
    );
    if (existing) {
      existing.setCount += 1;
    } else {
      summaries.push({
        exerciseId: set.exerciseId,
        name: set.exerciseName,
        setCount: 1,
      });
    }
  }
  return summaries;
}

export const getOpen = authedQuery({
  args: {},
  returns: v.union(
    v.object({
      _id: v.id("sessions"),
      startedAt: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx) => {
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_user_status_and_started", (q) =>
        q.eq("userId", ctx.userId).eq("status", "open"),
      )
      .order("desc")
      .first();

    if (!session) {
      return null;
    }

    return {
      _id: session._id,
      startedAt: session.startedAt,
    };
  },
});

export const start = authedMutation({
  args: {},
  returns: v.id("sessions"),
  handler: async (ctx) => {
    const existing = await ctx.db
      .query("sessions")
      .withIndex("by_user_status_and_started", (q) =>
        q.eq("userId", ctx.userId).eq("status", "open"),
      )
      .order("desc")
      .first();

    if (existing) {
      return existing._id;
    }

    return await ctx.db.insert("sessions", {
      userId: ctx.userId,
      status: "open",
      startedAt: Date.now(),
    });
  },
});

export const complete = authedMutation({
  args: { sessionId: v.id("sessions") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const session = await getOwnedSession(ctx, ctx.userId, args.sessionId);
    if (!session) {
      throw new Error("Workout not found");
    }
    if (session.status !== "open") {
      throw new Error("This workout is already finished");
    }

    const sets = await ctx.db
      .query("sets")
      .withIndex("by_session_and_exercise", (q) =>
        q.eq("sessionId", session._id),
      )
      .take(1);
    if (sets.length === 0) {
      throw new Error("Log at least one set before finishing");
    }

    await ctx.db.patch("sessions", session._id, {
      status: "completed",
      completedAt: Date.now(),
    });
    return null;
  },
});

/** Drops an open workout that has no sets, such as one whose only sets were undone. */
export const discard = authedMutation({
  args: { sessionId: v.id("sessions") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const session = await getOwnedSession(ctx, ctx.userId, args.sessionId);
    if (!session) {
      throw new Error("Workout not found");
    }
    if (session.status !== "open") {
      throw new Error("This workout is already finished");
    }

    const sets = await ctx.db
      .query("sets")
      .withIndex("by_session_and_exercise", (q) =>
        q.eq("sessionId", session._id),
      )
      .take(1);
    if (sets.length > 0) {
      throw new Error("This workout has sets. Finish it instead");
    }

    await ctx.db.delete("sessions", session._id);
    return null;
  },
});

export const listHistory = authedQuery({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(historyItemValidator),
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("sessions")
      .withIndex("by_user_status_and_started", (q) =>
        q.eq("userId", ctx.userId).eq("status", "completed"),
      )
      .order("desc")
      .paginate(args.paginationOpts);

    const page = await Promise.all(
      result.page.map(async (session) => {
        const sets = await loadSessionSets(ctx, session._id);
        return {
          _id: session._id,
          startedAt: session.startedAt,
          completedAt: session.completedAt ?? session.startedAt,
          exercises: summarizeExercises(sets),
        };
      }),
    );

    return {
      ...result,
      page,
    };
  },
});

export const get = authedQuery({
  args: { sessionId: v.string() },
  returns: v.union(sessionDetailValidator, v.null()),
  handler: async (ctx, args) => {
    const sessionId = ctx.db.normalizeId("sessions", args.sessionId);
    if (sessionId === null) {
      return null;
    }

    const session = await getOwnedSession(ctx, ctx.userId, sessionId);
    if (!session) {
      return null;
    }

    const sets = await loadSessionSets(ctx, session._id);
    return {
      _id: session._id,
      status: session.status,
      startedAt: session.startedAt,
      completedAt: session.completedAt ?? null,
      exercises: summarizeExercises(sets),
      sets,
    };
  },
});
