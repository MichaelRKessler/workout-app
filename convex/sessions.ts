import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalMutation } from "./_generated/server";
import { authedMutation, authedQuery } from "./lib/customFunctions";
import { formatExerciseName } from "./lib/exerciseName";
import {
  personalRecordForBatch,
  personalRecordValidator,
  volumeLb,
  type PersonalRecord,
} from "./lib/records";
import {
  abandonedCompletedAt,
  plannedCompletedAt,
  shouldCloseAbandoned,
} from "./lib/sessionTiming";
import { assertWeekRange, weekIndexFor, workoutStreak } from "./lib/week";
import {
  EXERCISE_RECORD_SCAN,
  MAX_SETS_PER_SESSION,
  assertReps,
  assertWeightLb,
  getOrCreateExercise,
  getOwnedSession,
  loadRecentSetsForExercise,
  requireOpenSession,
} from "./lib/workouts";

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

const EARLIEST_WORKOUT_AT = Date.UTC(2000, 0, 1);
const FUTURE_SKEW_MS = 60 * 1000;
const MAX_PAST_EXERCISES = 40;
const MAX_PAST_SETS = 120;
const WEEK_SESSION_SCAN = 1500;

const pastExerciseValidator = v.object({
  name: v.string(),
  sets: v.array(
    v.object({
      reps: v.number(),
      weightLb: v.number(),
    }),
  ),
});

/**
 * Saves a workout that already happened. It is completed immediately, so it
 * never becomes the open workout and the stale-workout pass leaves it alone.
 * Start and end are the same moment: the length was not recorded.
 */
export const logPast = authedMutation({
  args: {
    startedAt: v.number(),
    exercises: v.array(pastExerciseValidator),
  },
  returns: v.object({
    sessionId: v.id("sessions"),
    personalRecords: v.array(personalRecordValidator),
  }),
  handler: async (ctx, args) => {
    if (!Number.isFinite(args.startedAt)) {
      throw new Error("Pick a date and time");
    }
    const now = Date.now();
    if (args.startedAt > now + FUTURE_SKEW_MS) {
      throw new Error("Pick a time that has already happened");
    }
    if (args.startedAt < EARLIEST_WORKOUT_AT) {
      throw new Error("Pick a date after 1999");
    }
    if (args.exercises.length === 0) {
      throw new Error("Add at least one exercise");
    }
    if (args.exercises.length > MAX_PAST_EXERCISES) {
      throw new Error(`Log up to ${MAX_PAST_EXERCISES} exercises at a time`);
    }

    let totalSets = 0;
    const validated: Array<{
      name: string;
      sets: Array<{ reps: number; weightLb: number }>;
    }> = [];
    for (const exercise of args.exercises) {
      const formatted = formatExerciseName(exercise.name);
      if (!formatted) {
        throw new Error("Exercise name must be 1 to 80 characters");
      }
      if (exercise.sets.length === 0) {
        throw new Error("Add at least one set");
      }
      totalSets += exercise.sets.length;
      if (totalSets > MAX_PAST_SETS) {
        throw new Error(`Log up to ${MAX_PAST_SETS} sets at a time`);
      }
      validated.push({
        name: formatted.name,
        sets: exercise.sets.map((set) => ({
          reps: assertReps(set.reps),
          weightLb: assertWeightLb(set.weightLb),
        })),
      });
    }

    const startedAt = Math.min(args.startedAt, now);
    const sessionId = await ctx.db.insert("sessions", {
      userId: ctx.userId,
      status: "completed",
      startedAt,
      completedAt: startedAt,
    });

    let offset = 0;
    const personalRecords: PersonalRecord[] = [];
    for (const exercise of validated) {
      const exerciseId = await getOrCreateExercise(ctx, ctx.userId, exercise.name);
      const stored = await ctx.db.get("exercises", exerciseId);
      const created: Array<{ reps: number; weightLb: number }> = [];
      for (const set of exercise.sets) {
        await ctx.db.insert("sets", {
          userId: ctx.userId,
          sessionId,
          exerciseId,
          reps: set.reps,
          weightLb: set.weightLb,
          loggedAt: startedAt + offset,
        });
        offset += 1;
        created.push(set);
      }
      const recent = await loadRecentSetsForExercise(ctx, ctx.userId, exerciseId);
      const previous = recent
        .filter((set) => set.sessionId !== sessionId)
        .slice(0, EXERCISE_RECORD_SCAN)
        .map((set) => ({ reps: set.reps, weightLb: set.weightLb }));
      const record = personalRecordForBatch(
        stored?.name ?? exercise.name,
        created,
        previous,
      );
      if (record) {
        personalRecords.push(record);
      }
    }

    return { sessionId, personalRecords };
  },
});

/** Deletes a finished workout and every set that belongs to it. */
export const remove = authedMutation({
  args: { sessionId: v.id("sessions") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const session = await getOwnedSession(ctx, ctx.userId, args.sessionId);
    if (!session) {
      throw new Error("Workout not found");
    }
    if (session.status !== "completed") {
      throw new Error(
        "An open workout can't be deleted. Discard it if it's empty, or finish it first",
      );
    }
    await deleteFinishedSets(ctx, session);
    await ctx.db.delete("sessions", session._id);
    return null;
  },
});

async function deleteFinishedSets(
  ctx: MutationCtx,
  session: { _id: Id<"sessions">; userId: Id<"users"> },
): Promise<void> {
  for (let page = 0; page < 20; page += 1) {
    const sets = await ctx.db
      .query("sets")
      .withIndex("by_session_and_exercise", (q) => q.eq("sessionId", session._id))
      .take(100);
    if (sets.length === 0) {
      return;
    }
    for (const set of sets) {
      if (set.userId !== session.userId) {
        throw new Error("Workout not found");
      }
      await ctx.db.delete("sets", set._id);
    }
  }
  const leftover = await ctx.db
    .query("sets")
    .withIndex("by_session_and_exercise", (q) => q.eq("sessionId", session._id))
    .take(1);
  if (leftover.length > 0) {
    throw new Error("This workout has too many sets to delete");
  }
}

const weeklySummaryValidator = v.object({
  workouts: v.number(),
  sets: v.number(),
  volumeLb: v.number(),
  previousWorkouts: v.number(),
  previousSets: v.number(),
  previousVolumeLb: v.number(),
  streakWeeks: v.number(),
});

/**
 * Finished workouts whose start falls in the weeks the client computed.
 * The client passes those boundaries so this stays deterministic and follows
 * the viewer's time zone. Bodyweight sets count toward the set total only.
 */
export const weeklySummary = authedQuery({
  args: {
    weekStarts: v.array(v.number()),
    weekEndsAt: v.number(),
  },
  returns: weeklySummaryValidator,
  handler: async (ctx, args) => {
    assertWeekRange(args.weekStarts, args.weekEndsAt);
    const first = args.weekStarts[0];
    if (first === undefined) {
      throw new Error("Week range must cover at least two weeks");
    }
    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_user_status_and_started", (q) =>
        q.eq("userId", ctx.userId).eq("status", "completed").gte("startedAt", first),
      )
      .order("desc")
      .take(WEEK_SESSION_SCAN);

    const thisWeek = args.weekStarts.length - 1;
    const lastWeek = args.weekStarts.length - 2;
    const weekHasWorkout = args.weekStarts.map(() => false);
    const totals = [
      { workouts: 0, sets: 0, volumeLb: 0 },
      { workouts: 0, sets: 0, volumeLb: 0 },
    ];

    for (const session of sessions) {
      if (session.userId !== ctx.userId) {
        continue;
      }
      const index = weekIndexFor(session.startedAt, args.weekStarts, args.weekEndsAt);
      if (index === null) {
        continue;
      }
      weekHasWorkout[index] = true;
      if (index !== thisWeek && index !== lastWeek) {
        continue;
      }
      const bucket = index === thisWeek ? totals[0] : totals[1];
      if (!bucket) {
        continue;
      }
      const sets = await ctx.db
        .query("sets")
        .withIndex("by_session_and_exercise", (q) => q.eq("sessionId", session._id))
        .take(MAX_SETS_PER_SESSION);
      bucket.workouts += 1;
      bucket.sets += sets.length;
      bucket.volumeLb = Math.round((bucket.volumeLb + volumeLb(sets)) * 100) / 100;
    }

    return {
      workouts: totals[0]?.workouts ?? 0,
      sets: totals[0]?.sets ?? 0,
      volumeLb: totals[0]?.volumeLb ?? 0,
      previousWorkouts: totals[1]?.workouts ?? 0,
      previousSets: totals[1]?.sets ?? 0,
      previousVolumeLb: totals[1]?.volumeLb ?? 0,
      streakWeeks: workoutStreak(weekHasWorkout),
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
