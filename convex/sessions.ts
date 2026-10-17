import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalMutation } from "./_generated/server";
import { authedMutation, authedQuery } from "./lib/customFunctions";
import { loadAchievedRecords } from "./lib/achievedRecords";
import { recordInsertedSets, recordRemovedSets } from "./lib/exerciseStats";
import { newestLoggedAt } from "./lib/sessionActivity";
import { assertDayWindow, assertMonthWindow } from "./lib/dayWindow";
import { formatExerciseName } from "./lib/exerciseName";
import { normalizeNote } from "./lib/measures";
import { addMuscleSets, muscleCounts, muscleGroupValidator, type MuscleGroup } from "./lib/muscleGroup";
import { countsTowardVolume, persistedSetType } from "./lib/setType";
import { userError } from "./lib/errors";
import { personalRecordValidator, volumeLb, type PersonalRecord } from "./lib/records";
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
import { normalizeSupersetItems } from "./lib/superset";
import { setTypeValidator } from "./lib/setTypeValidator";
import {
  MAX_SETS_PER_SESSION,
  getOrCreateExercise,
  getOwnedSession,
  normalizeSetInput,
  presentSet,
  requireOpenSession,
  requireWritableSession,
} from "./lib/workouts";

const exerciseSummaryValidator = v.object({
  exerciseId: v.id("exercises"),
  name: v.string(),
  setCount: v.number(),
  supersetId: v.union(v.string(), v.null()),
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
  calories: v.union(v.number(), v.null()),
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
  targetCalories: v.union(v.number(), v.null()),
  skipped: v.boolean(),
  supersetId: v.union(v.string(), v.null()),
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
    recordStamps: set.recordStamps,
  }));
}

function publicSessionSet<T extends { recordStamps?: unknown }>(set: T) {
  const { recordStamps, ...rest } = set;
  void recordStamps;
  return rest;
}

function summarizeExercises(
  sets: Array<{ exerciseId: Id<"exercises">; exerciseName: string }>,
  plan?: Array<{ exerciseId: Id<"exercises">; supersetId?: string }>,
) {
  const grouped = normalizeSupersetItems(
    (plan ?? []).map((item) => ({
      exerciseId: item.exerciseId,
      supersetId: item.supersetId,
    })),
  );
  const supersetByExercise = new Map<Id<"exercises">, string>();
  for (const item of grouped) {
    if (item.supersetId) {
      supersetByExercise.set(item.exerciseId as Id<"exercises">, item.supersetId);
    }
  }
  const summaries: Array<{
    exerciseId: Id<"exercises">;
    name: string;
    setCount: number;
    supersetId: string | null;
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
        supersetId: supersetByExercise.get(set.exerciseId) ?? null,
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
      lastSetAt: await newestLoggedAt(ctx, session),
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
        targetCalories: item.targetCalories,
        skipped: skipped.get(item.exerciseId) ?? false,
        supersetId: item.supersetId,
      })),
    };
  },
});

/** The newest finished workout, for the Repeat last shortcut. */
export const latestCompleted = authedQuery({
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
        q.eq("userId", ctx.userId).eq("status", "completed"),
      )
      .order("desc")
      .first();
    if (!session || session.userId !== ctx.userId) {
      return null;
    }
    return { _id: session._id, startedAt: session.startedAt };
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
      setCount: 0,
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
      setCount: 0,
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
        targetCalories: v.optional(v.number()),
        skipped: v.optional(v.boolean()),
        supersetId: v.optional(v.string()),
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
        throw userError("Routine not found");
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
    const lastSetAt = await newestLoggedAt(ctx, session);
    if (lastSetAt === null) {
      throw userError("Log at least one set before finishing");
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
    const personalRecords = await loadAchievedRecords(
      ctx,
      ctx.userId,
      sets.map((set) => ({ ...set, sessionId: session._id })),
    );
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
      throw userError("This workout has sets. Finish it instead");
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
          exercises: summarizeExercises(sets, session.plan),
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
      calories: v.optional(v.number()),
      rpe: v.optional(v.number()),
      setType: v.optional(setTypeValidator),
    }),
  ),
});

const pastWorkoutArgs = {
  startedAt: v.number(),
  note: v.optional(v.string()),
  exercises: v.array(pastExerciseValidator),
};

/**
 * Saves a workout that already happened. It is completed immediately, so it
 * never becomes the open workout and the stale-workout pass leaves it alone.
 * Start and end are the same moment: the length was not recorded.
 */
export const logPast = authedMutation({
  args: pastWorkoutArgs,
  returns: v.object({
    sessionId: v.id("sessions"),
    personalRecords: v.array(personalRecordValidator),
  }),
  handler: async (ctx, args) => await savePastWorkout(ctx, ctx.userId, args),
});

/** logPast's work, shared with file import. */
export async function savePastWorkout(
  ctx: MutationCtx,
  userId: Id<"users">,
  args: {
    startedAt: number;
    note?: string;
    exercises: Array<{
      name: string;
      sets: Array<{
        reps?: number;
        weightLb?: number;
        durationSec?: number;
        distanceM?: number;
        calories?: number;
        rpe?: number;
        setType?: "warmup" | "working" | "drop" | "failure";
      }>;
    }>;
  },
): Promise<{ sessionId: Id<"sessions">; personalRecords: PersonalRecord[] }> {
  if (!Number.isFinite(args.startedAt)) {
    throw userError("Pick a date and time");
  }
  const now = Date.now();
  if (args.startedAt > now + FUTURE_SKEW_MS) {
    throw userError("Pick a time that has already happened");
  }
  if (args.startedAt < EARLIEST_WORKOUT_AT) {
    throw userError("Pick a date after 1999");
  }
  if (args.exercises.length === 0) {
    throw userError("Add at least one exercise");
  }
  if (args.exercises.length > MAX_PAST_EXERCISES) {
    throw userError(`Log up to ${MAX_PAST_EXERCISES} exercises at a time`);
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
      throw userError("Exercise name must be 1 to 80 characters");
    }
    if (exercise.sets.length === 0) {
      throw userError("Add at least one set");
    }
    totalSets += exercise.sets.length;
    if (totalSets > MAX_PAST_SETS) {
      throw userError(`Log up to ${MAX_PAST_SETS} sets at a time`);
    }
    validated.push({
      name: formatted.name,
      sets: exercise.sets.map((set) => normalizeSetInput(set)),
    });
  }

  const startedAt = Math.min(args.startedAt, now);
  const sessionId = await ctx.db.insert("sessions", {
    userId: userId,
    status: "completed",
    startedAt,
    completedAt: startedAt,
    setCount: 0,
    ...(note ? { note } : {}),
  });

  let offset = 0;
  const personalRecords: PersonalRecord[] = [];
  for (const exercise of validated) {
    const exerciseId = await getOrCreateExercise(ctx, userId, exercise.name);
    const stored = await ctx.db.get("exercises", exerciseId);
    const created: Array<{
      _id: Id<"sets">;
      sessionId: Id<"sessions">;
      loggedAt: number;
      reps?: number;
      weightLb: number;
      durationSec?: number;
      distanceM?: number;
      calories?: number;
      setType?: "warmup" | "working" | "drop" | "failure";
    }> = [];
    for (const set of exercise.sets) {
      const loggedAt = startedAt + offset;
      const setId = await ctx.db.insert("sets", {
        userId: userId,
        sessionId,
        exerciseId,
        weightLb: set.weightLb,
        loggedAt,
        ...(set.reps !== undefined ? { reps: set.reps } : {}),
        ...(set.durationSec !== undefined ? { durationSec: set.durationSec } : {}),
        ...(set.distanceM !== undefined ? { distanceM: set.distanceM } : {}),
        ...(set.calories !== undefined ? { calories: set.calories } : {}),
        ...(set.rpe !== undefined ? { rpe: set.rpe } : {}),
        ...persistedSetType(set.setType),
      });
      offset += 1;
      created.push({
        _id: setId,
        sessionId,
        loggedAt,
        weightLb: set.weightLb,
        ...(set.reps !== undefined ? { reps: set.reps } : {}),
        ...(set.durationSec !== undefined ? { durationSec: set.durationSec } : {}),
        ...(set.distanceM !== undefined ? { distanceM: set.distanceM } : {}),
        ...(set.calories !== undefined ? { calories: set.calories } : {}),
        setType: set.setType,
      });
    }
    const recorded = await recordInsertedSets(
      ctx,
      userId,
      exerciseId,
      stored?.name ?? exercise.name,
      created,
    );
    personalRecords.push(...recorded.records);
  }

  return { sessionId, personalRecords };
}

/** Deletes a finished workout and every set that belongs to it. */
export const remove = authedMutation({
  args: { sessionId: v.id("sessions") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const session = await getOwnedSession(ctx, ctx.userId, args.sessionId);
    if (!session) {
      throw userError("Workout not found");
    }
    if (session.status !== "completed") {
      throw userError(
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
        supersetId: string | null;
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
        exercises: summarizeExercises(sets, session.plan),
        sets,
        volumeLb: volumeLb(sets),
      });
    }
    const personalRecords = await loadAchievedRecords(
      ctx,
      ctx.userId,
      detailed.flatMap((session) =>
        session.sets.map((set) => ({ ...set, sessionId: session._id })),
      ),
    );
    return {
      sessions: detailed.map((session) => ({
        ...session,
        sets: session.sets.map((set) => publicSessionSet(set)),
      })),
      personalRecords,
      truncated,
    };
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
      throw userError("This day has too many workouts to delete");
    }
    if (sessions.length === 0) {
      throw userError("No finished workouts on this day");
    }

    const plans: Array<{
      sessionId: Id<"sessions">;
      sets: Array<Doc<"sets">>;
    }> = [];
    for (const session of sessions) {
      if (session.userId !== ctx.userId || session.status !== "completed") {
        throw userError("Workout not found");
      }
      const owned = await collectOwnedSets(ctx, session);
      plans.push({ sessionId: session._id, sets: owned });
    }

    const removed: Array<Doc<"sets">> = [];
    for (const plan of plans) {
      for (const set of plan.sets) {
        await ctx.db.delete("sets", set._id);
        removed.push(set);
      }
      await ctx.db.delete("sessions", plan.sessionId);
    }
    await recordRemovedSets(ctx, ctx.userId, removed);
    return { workouts: plans.length, sets: removed.length };
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
  const sets = await ctx.db
    .query("sets")
    .withIndex("by_session_and_exercise", (q) => q.eq("sessionId", session._id))
    .take(2001);
  if (sets.length > 2000) {
    throw userError("This workout has too many sets to delete");
  }
  for (const set of sets) {
    if (set.userId !== session.userId) {
      throw userError("Workout not found");
    }
    await ctx.db.delete("sets", set._id);
  }
  await ctx.db.delete("sessions", session._id);
  await recordRemovedSets(ctx, session.userId, sets);
}

async function collectOwnedSets(
  ctx: QueryCtx | MutationCtx,
  session: { _id: Id<"sessions">; userId: Id<"users"> },
) {
  const sets = await ctx.db
    .query("sets")
    .withIndex("by_session_and_exercise", (q) => q.eq("sessionId", session._id))
    .take(2001);
  if (sets.length > 2000) {
    throw userError("This workout has too many sets to delete");
  }
  for (const set of sets) {
    if (set.userId !== session.userId) {
      throw userError("Workout not found");
    }
  }
  return sets;
}

const weeklySummaryValidator = v.object({
  workouts: v.number(),
  sets: v.number(),
  volumeLb: v.number(),
  calories: v.number(),
  previousWorkouts: v.number(),
  previousSets: v.number(),
  previousVolumeLb: v.number(),
  previousCalories: v.number(),
  streakWeeks: v.number(),
  /**
   * Working sets this week, warm-ups excluded: a full set for each exercise's
   * main muscle and half a set for each group it also works.
   */
  muscles: v.array(
    v.object({
      group: muscleGroupValidator,
      sets: v.number(),
    }),
  ),
});

/**
 * Finished workouts whose start falls in the weeks the client computed.
 * The client passes those boundaries so this stays deterministic and follows
 * the viewer's time zone. Bodyweight sets count toward the set total only.
 * Warm-up sets are left out of the set total, the volume, and the muscle counts.
 * Muscle counts can be halves, from groups an exercise also works.
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
      throw userError("Week range must cover at least two weeks");
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
      { workouts: 0, sets: 0, volumeLb: 0, calories: 0 },
      { workouts: 0, sets: 0, volumeLb: 0, calories: 0 },
    ];
    const setsByExercise = new Map<Id<"exercises">, number>();

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
      bucket.calories += sets.reduce((sum, set) => {
        if (!countsTowardVolume(set)) {
          return sum;
        }
        const calories = set.calories ?? 0;
        return calories > 0 ? sum + calories : sum;
      }, 0);
      if (index !== thisWeek) {
        continue;
      }
      for (const set of sets) {
        if (set.userId !== ctx.userId || !countsTowardVolume(set)) {
          continue;
        }
        setsByExercise.set(set.exerciseId, (setsByExercise.get(set.exerciseId) ?? 0) + 1);
      }
    }

    const groupCounts = new Map<MuscleGroup, number>();
    for (const [exerciseId, count] of setsByExercise) {
      const exercise = await ctx.db.get("exercises", exerciseId);
      if (!exercise || exercise.userId !== ctx.userId) {
        continue;
      }
      addMuscleSets(groupCounts, exercise, count);
    }

    return {
      workouts: totals[0]?.workouts ?? 0,
      sets: totals[0]?.sets ?? 0,
      volumeLb: totals[0]?.volumeLb ?? 0,
      calories: totals[0]?.calories ?? 0,
      previousWorkouts: totals[1]?.workouts ?? 0,
      previousSets: totals[1]?.sets ?? 0,
      previousVolumeLb: totals[1]?.volumeLb ?? 0,
      previousCalories: totals[1]?.calories ?? 0,
      streakWeeks: workoutStreak(weekHasWorkout),
      muscles: muscleCounts(groupCounts),
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
      exercises: summarizeExercises(sets, session.plan),
      sets: sets.map((set) => publicSessionSet(set)),
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
  session: {
    _id: Id<"sessions">;
    startedAt: number;
    resumedAt?: number;
    setCount?: number;
    lastSetAt?: number;
  },
  now: number,
): Promise<"finished" | "discarded" | "kept"> {
  const lastSetAt = await newestLoggedAt(ctx, session);
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
