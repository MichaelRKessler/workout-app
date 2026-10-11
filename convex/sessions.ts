import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalMutation } from "./_generated/server";
import { authedMutation, authedQuery } from "./lib/customFunctions";
import { loadAchievedRecords } from "./lib/achievedRecords";
import { assertDayWindow, assertMonthWindow } from "./lib/dayWindow";
import { formatExerciseName } from "./lib/exerciseName";
import { normalizeNote } from "./lib/measures";
import { countsTowardVolume } from "./lib/setType";
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
  assertOwnedPlan,
  findOpenSession,
  normalizePlanInput,
  planFromOwnedSessions,
  presentRoutineExercises,
} from "./lib/routineRecords";
import { MAX_ROUTINE_NAME_LENGTH } from "./lib/routinePlan";
import {
  EXERCISE_RECORD_SCAN,
  MAX_SETS_PER_SESSION,
  getOrCreateExercise,
  getOwnedSession,
  loadRecentSetsForExercise,
  normalizeSetInput,
  presentSet,
  recordPoint,
  requireOpenSession,
  requireWritableSession,
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
  volumeLb: v.number(),
});

const setDetailValidator = v.object({
  _id: v.id("sets"),
  exerciseId: v.id("exercises"),
  exerciseName: v.string(),
  reps: v.union(v.number(), v.null()),
  weightLb: v.number(),
  durationSec: v.union(v.number(), v.null()),
  distanceM: v.union(v.number(), v.null()),
  rpe: v.union(v.number(), v.null()),
  setType: v.union(
    v.literal("warmup"),
    v.literal("working"),
    v.literal("drop"),
    v.literal("failure"),
  ),
  loggedAt: v.number(),
  clientId: v.union(v.string(), v.null()),
});

const planItemValidator = v.object({
  exerciseId: v.id("exercises"),
  name: v.string(),
  targetSets: v.union(v.number(), v.null()),
  targetReps: v.union(v.number(), v.null()),
  targetWeightLb: v.union(v.number(), v.null()),
  targetDurationSec: v.union(v.number(), v.null()),
  targetDistanceM: v.union(v.number(), v.null()),
  skipped: v.boolean(),
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

const sessionDetailValidator = v.object({
  _id: v.id("sessions"),
  status: v.union(v.literal("open"), v.literal("completed")),
  startedAt: v.number(),
  completedAt: v.union(v.number(), v.null()),
  note: v.union(v.string(), v.null()),
  exercises: v.array(exerciseSummaryValidator),
  sets: v.array(setDetailValidator),
});

async function loadSessionSets(ctx: QueryCtx | MutationCtx, sessionId: Id<"sessions">) {
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
    ...presentSet(set),
    loggedAt: set.loggedAt,
    clientId: set.clientId ?? null,
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
      note: v.union(v.string(), v.null()),
      planName: v.union(v.string(), v.null()),
      routineId: v.union(v.id("routines"), v.null()),
      plan: v.array(planItemValidator),
    }),
    v.null(),
  ),
  handler: async (ctx) => {
    const session = await findOpenSession(ctx, ctx.userId);

    if (!session) {
      return null;
    }

    const presented = await presentRoutineExercises(ctx, ctx.userId, session.plan ?? []);
    const skipped = new Map(
      (session.plan ?? []).map((item) => [item.exerciseId, item.skipped === true]),
    );

    return {
      _id: session._id,
      startedAt: session.startedAt,
      resumedAt: session.resumedAt ?? null,
      lastSetAt: await newestLoggedAt(ctx, session._id),
      note: session.note ?? null,
      planName: session.planName ?? null,
      routineId: session.routineId ?? null,
      plan: presented.map((item) => ({
        exerciseId: item.exerciseId,
        name: item.name,
        targetSets: item.targetSets,
        targetReps: item.targetReps,
        targetWeightLb: item.targetWeightLb,
        targetDurationSec: item.targetDurationSec,
        targetDistanceM: item.targetDistanceM,
        skipped: skipped.get(item.exerciseId) ?? false,
      })),
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

/**
 * Starts a workout with the exercises from finished workouts, in the order
 * they were performed. Does not save a routine. An open workout is unchanged.
 */
export const repeat = authedMutation({
  args: { sessionIds: v.array(v.id("sessions")) },
  returns: startedResult,
  handler: async (ctx, args) => {
    const open = await findOpenSession(ctx, ctx.userId);
    if (open) {
      return { status: "alreadyOpen" as const, sessionId: open._id };
    }
    const { plan } = await planFromOwnedSessions(ctx, ctx.userId, args.sessionIds);
    const sessionId = await ctx.db.insert("sessions", {
      userId: ctx.userId,
      status: "open",
      startedAt: Date.now(),
      plan,
    });
    return { status: "started" as const, sessionId };
  },
});

/** Replaces the checklist on an open workout. Used for skip and reorder. */
export const setPlan = authedMutation({
  args: {
    sessionId: v.id("sessions"),
    planName: v.optional(v.string()),
    routineId: v.optional(v.id("routines")),
    plan: v.array(
      v.object({
        exerciseId: v.id("exercises"),
        targetSets: v.optional(v.number()),
        targetReps: v.optional(v.number()),
        targetWeightLb: v.optional(v.number()),
        targetDurationSec: v.optional(v.number()),
        targetDistanceM: v.optional(v.number()),
        skipped: v.optional(v.boolean()),
      }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const session = await requireOpenSession(ctx, ctx.userId, args.sessionId);
    const normalized = normalizePlanInput(args.plan);
    const owned = await assertOwnedPlan(ctx, ctx.userId, normalized);
    let routineId = session.routineId;
    if (args.routineId) {
      const routine = await ctx.db.get("routines", args.routineId);
      if (!routine || routine.userId !== ctx.userId) {
        throw new Error("Routine not found");
      }
      routineId = routine._id;
    }
    const planName =
      args.planName === undefined
        ? session.planName
        : args.planName.trim().slice(0, MAX_ROUTINE_NAME_LENGTH) || undefined;
    await ctx.db.patch("sessions", session._id, {
      plan: owned,
      ...(planName ? { planName } : {}),
      ...(routineId ? { routineId } : {}),
    });
    return null;
  },
});

export const complete = authedMutation({
  args: {
    sessionId: v.id("sessions"),
    completedAt: v.optional(v.number()),
    note: v.optional(v.string()),
  },
  returns: v.object({
    completedAt: v.number(),
    personalRecords: v.array(personalRecordValidator),
  }),
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
    const note = args.note === undefined ? session.note : normalizeNote(args.note);
    await ctx.db.patch("sessions", session._id, {
      status: "completed",
      completedAt,
      note,
    });
    const sets = await loadSessionSets(ctx, session._id);
    const personalRecords = await loadAchievedRecords(ctx, ctx.userId, sets);
    return { completedAt, personalRecords };
  },
});

export const setNote = authedMutation({
  args: {
    sessionId: v.id("sessions"),
    note: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const session = await requireWritableSession(ctx, ctx.userId, args.sessionId);
    await ctx.db.patch("sessions", session._id, { note: normalizeNote(args.note) });
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
          volumeLb: volumeLb(sets),
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
      reps: v.optional(v.number()),
      weightLb: v.optional(v.number()),
      durationSec: v.optional(v.number()),
      distanceM: v.optional(v.number()),
      rpe: v.optional(v.number()),
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
    note: v.optional(v.string()),
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

    const note = normalizeNote(args.note);
    let totalSets = 0;
    const validated: Array<{
      name: string;
      sets: ReturnType<typeof normalizeSetInput>[];
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
        sets: exercise.sets.map((set) => normalizeSetInput(set)),
      });
    }

    const startedAt = Math.min(args.startedAt, now);
    const sessionId = await ctx.db.insert("sessions", {
      userId: ctx.userId,
      status: "completed",
      startedAt,
      completedAt: startedAt,
      ...(note ? { note } : {}),
    });

    let offset = 0;
    const personalRecords: PersonalRecord[] = [];
    for (const exercise of validated) {
      const exerciseId = await getOrCreateExercise(ctx, ctx.userId, exercise.name);
      const stored = await ctx.db.get("exercises", exerciseId);
      const created: Array<ReturnType<typeof recordPoint>> = [];
      for (const set of exercise.sets) {
        await ctx.db.insert("sets", {
          userId: ctx.userId,
          sessionId,
          exerciseId,
          weightLb: set.weightLb,
          loggedAt: startedAt + offset,
          ...(set.reps !== undefined ? { reps: set.reps } : {}),
          ...(set.durationSec !== undefined ? { durationSec: set.durationSec } : {}),
          ...(set.distanceM !== undefined ? { distanceM: set.distanceM } : {}),
          ...(set.rpe !== undefined ? { rpe: set.rpe } : {}),
        });
        offset += 1;
        created.push(recordPoint(set));
      }
      const recent = await loadRecentSetsForExercise(ctx, ctx.userId, exerciseId);
      const previous = recent
        .filter((set) => set.sessionId !== sessionId)
        .slice(0, EXERCISE_RECORD_SCAN)
        .map((set) => recordPoint(set));
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
    await deleteFinishedSession(ctx, session);
    return null;
  },
});

const MAX_DAY_SESSIONS = 40;

const daySessionValidator = v.object({
  _id: v.id("sessions"),
  status: v.literal("completed"),
  startedAt: v.number(),
  completedAt: v.union(v.number(), v.null()),
  note: v.union(v.string(), v.null()),
  exercises: v.array(exerciseSummaryValidator),
  sets: v.array(setDetailValidator),
  volumeLb: v.number(),
});

/**
 * Finished workouts performed in one local day. The browser computes the
 * day bounds; this only returns the signed-in user's completed sessions.
 * Open workouts are excluded so a live session is not folded into the day.
 */
const MAX_MONTH_SESSIONS = 120;

/**
 * Start times of finished workouts in one local month. The browser sends the
 * month bounds and groups these onto calendar days. Open workouts are left out.
 */
export const calendar = authedQuery({
  args: {
    startedFrom: v.number(),
    startedUntil: v.number(),
  },
  returns: v.object({
    startedAts: v.array(v.number()),
    truncated: v.boolean(),
  }),
  handler: async (ctx, args) => {
    assertMonthWindow(args.startedFrom, args.startedUntil);
    const found = await ctx.db
      .query("sessions")
      .withIndex("by_user_status_and_started", (q) =>
        q
          .eq("userId", ctx.userId)
          .eq("status", "completed")
          .gte("startedAt", args.startedFrom)
          .lt("startedAt", args.startedUntil),
      )
      .order("asc")
      .take(MAX_MONTH_SESSIONS + 1);

    const startedAts: number[] = [];
    for (const session of found) {
      if (session.userId !== ctx.userId || session.status !== "completed") {
        continue;
      }
      if (startedAts.length >= MAX_MONTH_SESSIONS) {
        break;
      }
      startedAts.push(session.startedAt);
    }
    return { startedAts, truncated: found.length > MAX_MONTH_SESSIONS };
  },
});

export const listDay = authedQuery({
  args: {
    startedFrom: v.number(),
    startedUntil: v.number(),
  },
  returns: v.object({
    sessions: v.array(daySessionValidator),
    personalRecords: v.array(personalRecordValidator),
    truncated: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const { sessions, truncated } = await completedSessionsInWindow(
      ctx,
      ctx.userId,
      args.startedFrom,
      args.startedUntil,
    );
    const detailed: Array<{
      _id: Id<"sessions">;
      status: "completed";
      startedAt: number;
      completedAt: number | null;
      note: string | null;
      exercises: Array<{
        exerciseId: Id<"exercises">;
        name: string;
        setCount: number;
      }>;
      sets: Awaited<ReturnType<typeof loadSessionSets>>;
      volumeLb: number;
    }> = [];
    for (const session of sessions) {
      const sets = await loadSessionSets(ctx, session._id);
      detailed.push({
        _id: session._id,
        status: "completed" as const,
        startedAt: session.startedAt,
        completedAt: session.completedAt ?? null,
        note: session.note ?? null,
        exercises: summarizeExercises(sets),
        sets,
        volumeLb: volumeLb(sets),
      });
    }
    const personalRecords = await loadAchievedRecords(
      ctx,
      ctx.userId,
      detailed.flatMap((session) => session.sets),
    );
    return { sessions: detailed, personalRecords, truncated };
  },
});

/**
 * Deletes every finished workout the owner performed in one local day, and
 * the sets on those workouts. One mutation, so a failure keeps the day intact.
 * Open workouts in the same window are left alone.
 */
export const removeDay = authedMutation({
  args: {
    startedFrom: v.number(),
    startedUntil: v.number(),
  },
  returns: v.object({
    workouts: v.number(),
    sets: v.number(),
  }),
  handler: async (ctx, args) => {
    const { sessions, truncated } = await completedSessionsInWindow(
      ctx,
      ctx.userId,
      args.startedFrom,
      args.startedUntil,
    );
    if (truncated) {
      throw new Error("This day has too many workouts to delete");
    }
    if (sessions.length === 0) {
      throw new Error("No finished workouts on this day");
    }

    const plans: Array<{ sessionId: Id<"sessions">; setIds: Array<Id<"sets">> }> = [];
    for (const session of sessions) {
      if (session.userId !== ctx.userId || session.status !== "completed") {
        throw new Error("Workout not found");
      }
      plans.push({
        sessionId: session._id,
        setIds: await collectOwnedSetIds(ctx, session),
      });
    }

    let sets = 0;
    for (const plan of plans) {
      for (const setId of plan.setIds) {
        await ctx.db.delete("sets", setId);
        sets += 1;
      }
      await ctx.db.delete("sessions", plan.sessionId);
    }
    return { workouts: plans.length, sets };
  },
});

async function completedSessionsInWindow(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  startedFrom: number,
  startedUntil: number,
) {
  assertDayWindow(startedFrom, startedUntil);
  const found = await ctx.db
    .query("sessions")
    .withIndex("by_user_status_and_started", (q) =>
      q
        .eq("userId", userId)
        .eq("status", "completed")
        .gte("startedAt", startedFrom)
        .lt("startedAt", startedUntil),
    )
    .order("asc")
    .take(MAX_DAY_SESSIONS + 1);

  const sessions: Array<(typeof found)[number]> = [];
  for (const session of found) {
    if (session.userId !== userId || session.status !== "completed") {
      continue;
    }
    if (sessions.length < MAX_DAY_SESSIONS) {
      sessions.push(session);
    }
  }
  return { sessions, truncated: found.length > MAX_DAY_SESSIONS };
}

async function deleteFinishedSession(
  ctx: MutationCtx,
  session: { _id: Id<"sessions">; userId: Id<"users"> },
): Promise<void> {
  const setIds = await collectOwnedSetIds(ctx, session);
  for (const setId of setIds) {
    await ctx.db.delete("sets", setId);
  }
  await ctx.db.delete("sessions", session._id);
}

async function collectOwnedSetIds(
  ctx: QueryCtx | MutationCtx,
  session: { _id: Id<"sessions">; userId: Id<"users"> },
): Promise<Array<Id<"sets">>> {
  const sets = await ctx.db
    .query("sets")
    .withIndex("by_session_and_exercise", (q) => q.eq("sessionId", session._id))
    .take(2001);
  if (sets.length > 2000) {
    throw new Error("This workout has too many sets to delete");
  }
  const ids: Array<Id<"sets">> = [];
  for (const set of sets) {
    if (set.userId !== session.userId) {
      throw new Error("Workout not found");
    }
    ids.push(set._id);
  }
  return ids;
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
 * Warm-up sets are left out of the set total and the volume.
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
      bucket.sets += sets.filter((set) => countsTowardVolume(set)).length;
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
      note: session.note ?? null,
      exercises: summarizeExercises(sets),
      sets,
    };
  },
});

const STALE_SCAN_PAGE = 20;

/**
 * Closes workouts nobody has touched. Idle time is the newest set (or the
 * start time when there are no sets), not how long ago the workout began.
 * Internal only: a cron has no user identity, and clients cannot call it.
 * It writes each open session in place and returns counts, not workout
 * contents. Completed workouts, including ones logged for a past day, are
 * not in this index. Public session and set functions still require the
 * allow list.
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
  const lastSetAt = await newestLoggedAt(ctx, session._id);
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
