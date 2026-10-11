import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalMutation } from "./_generated/server";
import { authedMutation, authedQuery } from "./lib/customFunctions";
import {
  abandonedCompletedAt,
  plannedCompletedAt,
  shouldCloseAbandoned,
} from "./lib/sessionTiming";
import { getOwnedSession, requireOpenSession } from "./lib/workouts";

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

async function newestLoggedAt(
  ctx: QueryCtx | MutationCtx,
  sessionId: Id<"sessions">,
): Promise<number | null> {
  const sets = await ctx.db
    .query("sets")
    .withIndex("by_session_and_exercise", (q) => q.eq("sessionId", sessionId))
    .take(500);
  let newest: number | null = null;
  for (const set of sets) {
    if (newest === null || set.loggedAt > newest) {
      newest = set.loggedAt;
    }
  }
  return newest;
}

export const getOpen = authedQuery({
  args: {},
  returns: v.union(
    v.object({
      _id: v.id("sessions"),
      startedAt: v.number(),
      resumedAt: v.union(v.number(), v.null()),
      lastSetAt: v.union(v.number(), v.null()),
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
      resumedAt: session.resumedAt ?? null,
      lastSetAt: await newestLoggedAt(ctx, session._id),
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
  args: {
    sessionId: v.id("sessions"),
    completedAt: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const session = await requireOpenSession(ctx, ctx.userId, args.sessionId);
    const lastSetAt = await newestLoggedAt(ctx, session._id);
    if (lastSetAt === null) {
      throw new Error("Log at least one set before finishing");
    }

    const completedAt = plannedCompletedAt({
      now: Date.now(),
      startedAt: session.startedAt,
      lastSetAt,
      explicit: args.completedAt,
    });
    await ctx.db.patch("sessions", session._id, {
      status: "completed",
      completedAt,
    });
    return null;
  },
});

/** Records that the user is still in an idle open workout, so the prompt and cron wait. */
export const keepGoing = authedMutation({
  args: { sessionId: v.id("sessions") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const session = await requireOpenSession(ctx, ctx.userId, args.sessionId);
    await ctx.db.patch("sessions", session._id, { resumedAt: Date.now() });
    return null;
  },
});

/** Drops an open workout that has no sets, such as one whose only sets were undone. */
export const discard = authedMutation({
  args: { sessionId: v.id("sessions") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const session = await requireOpenSession(ctx, ctx.userId, args.sessionId);

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

const STALE_SCAN_PAGE = 20;

/**
 * Closes workouts nobody finished. Internal only: a cron has no user identity,
 * and clients cannot call it. It writes each open session in place and returns
 * counts, not workout contents. Public session and set functions still require
 * the allow list.
 */
export const closeStale = internalMutation({
  args: { cursor: v.optional(v.string()) },
  returns: v.object({
    finished: v.number(),
    discarded: v.number(),
    done: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const now = Date.now();
    const page = await ctx.db
      .query("sessions")
      .withIndex("by_status", (q) => q.eq("status", "open"))
      .paginate({ numItems: STALE_SCAN_PAGE, cursor: args.cursor ?? null });

    let finished = 0;
    let discarded = 0;
    for (const session of page.page) {
      const outcome = await closeAbandonedSession(ctx, session, now);
      if (outcome === "finished") {
        finished += 1;
      } else if (outcome === "discarded") {
        discarded += 1;
      }
    }

    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.sessions.closeStale, {
        cursor: page.continueCursor,
      });
    }

    return { finished, discarded, done: page.isDone };
  },
});

async function closeAbandonedSession(
  ctx: MutationCtx,
  session: { _id: Id<"sessions">; startedAt: number; resumedAt?: number },
  now: number,
): Promise<"finished" | "discarded" | "kept"> {
  const sets = await ctx.db
    .query("sets")
    .withIndex("by_session_and_exercise", (q) => q.eq("sessionId", session._id))
    .take(500);
  const lastSetAt = sets.reduce<number | null>(
    (newest, set) => (newest === null || set.loggedAt > newest ? set.loggedAt : newest),
    null,
  );
  const resumedAt = session.resumedAt ?? null;
  if (!shouldCloseAbandoned(now, session.startedAt, lastSetAt, resumedAt)) {
    return "kept";
  }
  if (lastSetAt === null) {
    await ctx.db.delete("sessions", session._id);
    return "discarded";
  }
  await ctx.db.patch("sessions", session._id, {
    status: "completed",
    completedAt: abandonedCompletedAt(now, session.startedAt, lastSetAt),
  });
  return "finished";
}
