import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalMutation } from "./_generated/server";
import { isEmailAllowed, normalizeEmail } from "./lib/accessControl";
import { authedMutation, authedQuery } from "./lib/customFunctions";
import { applyMergeBatch } from "./lib/exerciseMerge";
import { exerciseRecord } from "./lib/exerciseFields";
import { formatExerciseName, MAX_KNOWN_EXERCISE_NAMES } from "./lib/exerciseName";
import { muscleGroupValidator, presentMuscle } from "./lib/muscleGroup";
import { summarizeEfforts, trendFromSets, type TrendPoint } from "./lib/records";
import { setExerciseRest } from "./lib/rest";
import { setTypeValidator } from "./lib/setTypeValidator";
import { userError } from "./lib/errors";
import {
  EXERCISE_RECORD_SCAN,
  getOrCreateExercise,
  loadRecentSetsForExercise,
  loadVoiceExerciseNames,
  presentSet,
} from "./lib/workouts";

/** Newest workouts kept for the chart. Older ones stay in the set list below it. */
const TREND_SESSIONS = 400;

const effortValidator = v.object({
  setId: v.id("sets"),
  sessionId: v.id("sessions"),
  reps: v.union(v.number(), v.null()),
  weightLb: v.number(),
  epleyLb: v.union(v.number(), v.null()),
  durationSec: v.union(v.number(), v.null()),
  distanceM: v.union(v.number(), v.null()),
  loggedAt: v.number(),
});

const calorieEffortValidator = v.object({
  sessionId: v.id("sessions"),
  calories: v.number(),
  loggedAt: v.number(),
});

const trendSnapValidator = v.object({
  reps: v.union(v.number(), v.null()),
  weightLb: v.number(),
  durationSec: v.union(v.number(), v.null()),
  distanceM: v.union(v.number(), v.null()),
});

const trendPointValidator = v.object({
  sessionId: v.id("sessions"),
  startedAt: v.number(),
  value: v.union(v.number(), v.null()),
  volumeLb: v.number(),
  topWeightLb: v.union(v.number(), v.null()),
  epleyLb: v.union(v.number(), v.null()),
  reps: v.union(v.number(), v.null()),
  durationSec: v.union(v.number(), v.null()),
  distanceM: v.union(v.number(), v.null()),
  calories: v.union(v.number(), v.null()),
  bestEpleySet: v.union(trendSnapValidator, v.null()),
  bestWeightSet: v.union(trendSnapValidator, v.null()),
  bestRepsSet: v.union(trendSnapValidator, v.null()),
  bestDurationSet: v.union(trendSnapValidator, v.null()),
  bestDistanceSet: v.union(trendSnapValidator, v.null()),
});

const historySetValidator = v.object({
  _id: v.id("sets"),
  reps: v.union(v.number(), v.null()),
  weightLb: v.number(),
  durationSec: v.union(v.number(), v.null()),
  distanceM: v.union(v.number(), v.null()),
  calories: v.union(v.number(), v.null()),
  rpe: v.union(v.number(), v.null()),
  setType: setTypeValidator,
  loggedAt: v.number(),
  sessionId: v.id("sessions"),
  sessionStartedAt: v.number(),
});

async function ownedExercise(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  rawId: string,
) {
  const exerciseId = ctx.db.normalizeId("exercises", rawId);
  if (exerciseId === null) {
    return null;
  }
  const exercise = await ctx.db.get("exercises", exerciseId);
  if (!exercise || exercise.userId !== userId) {
    return null;
  }
  return exercise;
}

const exerciseValidator = v.object({
  _id: v.id("exercises"),
  name: v.string(),
  restSeconds: v.union(v.number(), v.null()),
  muscleGroup: muscleGroupValidator,
  muscleSource: v.union(v.literal("saved"), v.literal("suggested")),
});

const EXERCISE_LIMIT = 200;

export const list = authedQuery({
  args: {},
  returns: v.object({
    exercises: v.array(exerciseValidator),
    truncated: v.boolean(),
  }),
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("exercises")
      .withIndex("by_user_and_normalized_name", (q) =>
        q.eq("userId", ctx.userId),
      )
      .take(EXERCISE_LIMIT + 1);

    const truncated = rows.length > EXERCISE_LIMIT;
    const exercises = rows.slice(0, EXERCISE_LIMIT).map((exercise) => ({
      _id: exercise._id,
      name: exercise.name,
      restSeconds: exercise.restSeconds ?? null,
      ...presentMuscle(exercise),
    }));
    exercises.sort((left, right) => left.name.localeCompare(right.name));

    return { exercises, truncated };
  },
});

/** Account rest for one exercise. Null means the device rest default. */
export const restForName = authedQuery({
  args: { name: v.string() },
  returns: v.union(v.number(), v.null()),
  handler: async (ctx, args) => {
    const formatted = formatExerciseName(args.name);
    if (!formatted) {
      return null;
    }
    const exercise = await ctx.db
      .query("exercises")
      .withIndex("by_user_and_normalized_name", (q) =>
        q.eq("userId", ctx.userId).eq("normalizedName", formatted.normalizedName),
      )
      .unique();
    if (!exercise || exercise.userId !== ctx.userId) {
      return null;
    }
    return exercise.restSeconds ?? null;
  },
});

/**
 * Saves the primary muscle, or clears it so the name's suggestion is used.
 * The weekly summary counts working sets toward this group.
 */
export const setMuscle = authedMutation({
  args: {
    exerciseId: v.id("exercises"),
    muscleGroup: v.union(muscleGroupValidator, v.null()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const exercise = await ctx.db.get("exercises", args.exerciseId);
    if (!exercise || exercise.userId !== ctx.userId) {
      throw userError("Exercise not found");
    }
    const next = args.muscleGroup ?? undefined;
    if ((exercise.muscleGroup ?? undefined) === next) {
      return null;
    }
    await ctx.db.replace(
      "exercises",
      exercise._id,
      exerciseRecord(exercise, { muscleGroup: args.muscleGroup }),
    );
    return null;
  },
});

/** Remembers rest for this exercise on the account. Null clears it. */
export const setRest = authedMutation({
  args: {
    name: v.string(),
    restSeconds: v.union(v.number(), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const exerciseId = await getOrCreateExercise(ctx, ctx.userId, args.name);
    const exercise = await ctx.db.get("exercises", exerciseId);
    if (!exercise || exercise.userId !== ctx.userId) {
      throw userError("Exercise not found");
    }
    await setExerciseRest(ctx, ctx.userId, exercise, args.restSeconds);
    return null;
  },
});

function presentTrendPoint(point: TrendPoint) {
  return {
    sessionId: point.sessionId as Id<"sessions">,
    startedAt: point.startedAt,
    value: point.value,
    volumeLb: point.volumeLb,
    topWeightLb: point.topWeightLb,
    epleyLb: point.epleyLb,
    reps: point.reps,
    durationSec: point.durationSec,
    distanceM: point.distanceM,
    calories: point.calories,
    bestEpleySet: point.bestEpleySet,
    bestWeightSet: point.bestWeightSet,
    bestRepsSet: point.bestRepsSet,
    bestDurationSet: point.bestDurationSet,
    bestDistanceSet: point.bestDistanceSet,
  };
}

/** Best efforts and a short trend. The list of sets is paginated separately. */
export const detail = authedQuery({
  args: { exerciseId: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("exercises"),
      name: v.string(),
      bestWeight: v.union(effortValidator, v.null()),
      bestEpley: v.union(effortValidator, v.null()),
      bestBodyweight: v.union(effortValidator, v.null()),
      bestDuration: v.union(effortValidator, v.null()),
      bestDistance: v.union(effortValidator, v.null()),
      bestCalories: v.union(calorieEffortValidator, v.null()),
      muscleGroup: muscleGroupValidator,
      muscleSource: v.union(v.literal("saved"), v.literal("suggested")),
      trendUnit: v.union(
        v.literal("lb"),
        v.literal("reps"),
        v.literal("m"),
        v.literal("sec"),
      ),
      trend: v.array(trendPointValidator),
      truncated: v.boolean(),
    }),
  ),
  handler: async (ctx, args) => {
    const exercise = await ownedExercise(ctx, ctx.userId, args.exerciseId);
    if (!exercise) {
      return null;
    }

    const scanned = await loadRecentSetsForExercise(ctx, ctx.userId, exercise._id);
    const truncated = scanned.length > EXERCISE_RECORD_SCAN;
    const sets = truncated ? scanned.slice(0, EXERCISE_RECORD_SCAN) : scanned;
    const efforts = summarizeEfforts(sets);

    const sessionIds: Array<Id<"sessions">> = [];
    const seen = new Set<string>();
    for (const set of sets) {
      if (seen.has(set.sessionId)) {
        continue;
      }
      seen.add(set.sessionId);
      sessionIds.push(set.sessionId);
      if (sessionIds.length >= TREND_SESSIONS) {
        break;
      }
    }
    const sessions = await Promise.all(
      sessionIds.map(async (sessionId) => await ctx.db.get("sessions", sessionId)),
    );
    const startedAt = new Map<Id<"sessions">, number>();
    for (const session of sessions) {
      if (session && session.userId === ctx.userId) {
        startedAt.set(session._id, session.startedAt);
      }
    }
    const trendSets = sets.flatMap((set) => {
      const sessionStartedAt = startedAt.get(set.sessionId);
      if (sessionStartedAt === undefined) {
        return [];
      }
      return [
        {
          _id: set._id,
          sessionId: set.sessionId,
          reps: set.reps,
          weightLb: set.weightLb,
          durationSec: set.durationSec,
          distanceM: set.distanceM,
          calories: set.calories,
          loggedAt: set.loggedAt,
          setType: set.setType,
          sessionStartedAt,
        },
      ];
    });
    const trend = trendFromSets(trendSets, TREND_SESSIONS);

    function effort(value: (typeof efforts)["bestWeight"]) {
      if (!value) {
        return null;
      }
      return {
        setId: value.setId as Id<"sets">,
        sessionId: value.sessionId as Id<"sessions">,
        reps: value.reps,
        weightLb: value.weightLb,
        epleyLb: value.epleyLb,
        durationSec: value.durationSec,
        distanceM: value.distanceM,
        loggedAt: value.loggedAt,
      };
    }

    return {
      _id: exercise._id,
      name: exercise.name,
      bestWeight: effort(efforts.bestWeight),
      bestEpley: effort(efforts.bestEpley),
      bestBodyweight: effort(efforts.bestBodyweight),
      bestDuration: effort(efforts.bestDuration),
      bestDistance: effort(efforts.bestDistance),
      bestCalories: efforts.bestCalories
        ? {
            sessionId: efforts.bestCalories.sessionId as Id<"sessions">,
            calories: efforts.bestCalories.calories,
            loggedAt: efforts.bestCalories.loggedAt,
          }
        : null,
      ...presentMuscle(exercise),
      trendUnit: trend.unit,
      trend: trend.points.map((point) => presentTrendPoint(point)),
      truncated,
    };
  },
});

/** Sets for one exercise, newest performed first. Pages group into workouts on the client. */
export const history = authedQuery({
  args: {
    exerciseId: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(historySetValidator),
  handler: async (ctx, args) => {
    const exercise = await ownedExercise(ctx, ctx.userId, args.exerciseId);
    if (!exercise) {
      return { page: [], isDone: true, continueCursor: "" };
    }

    const result = await ctx.db
      .query("sets")
      .withIndex("by_user_exercise_and_logged", (q) =>
        q.eq("userId", ctx.userId).eq("exerciseId", exercise._id),
      )
      .order("desc")
      .paginate(args.paginationOpts);

    const sessionIds = [...new Set(result.page.map((set) => set.sessionId))];
    const sessions = await Promise.all(
      sessionIds.map(async (sessionId) => await ctx.db.get("sessions", sessionId)),
    );
    const startedAt = new Map<Id<"sessions">, number>();
    for (const session of sessions) {
      if (session && session.userId === ctx.userId) {
        startedAt.set(session._id, session.startedAt);
      }
    }

    return {
      ...result,
      page: result.page.map((set) => ({
        _id: set._id,
        ...presentSet(set),
        loggedAt: set.loggedAt,
        sessionId: set.sessionId,
        sessionStartedAt: startedAt.get(set.sessionId) ?? set.loggedAt,
      })),
    };
  },
});

/** Names for the voice prompt: this user only, most recent first, capped. */
export const namesForVoice = authedQuery({
  args: {},
  returns: v.array(v.string()),
  handler: async (ctx) => {
    const names = await loadVoiceExerciseNames(ctx, ctx.userId);
    return names.slice(0, MAX_KNOWN_EXERCISE_NAMES);
  },
});

const SET_COUNT_CAP = 100;

const libraryItemValidator = v.object({
  _id: v.id("exercises"),
  name: v.string(),
  setCount: v.number(),
  setCountCapped: v.boolean(),
  muscleGroup: muscleGroupValidator,
  muscleSource: v.union(v.literal("saved"), v.literal("suggested")),
});

async function countSets(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  exerciseId: Id<"exercises">,
) {
  const rows = await ctx.db
    .query("sets")
    .withIndex("by_user_exercise_and_logged", (q) =>
      q.eq("userId", userId).eq("exerciseId", exerciseId),
    )
    .take(SET_COUNT_CAP + 1);
  return {
    setCount: Math.min(rows.length, SET_COUNT_CAP),
    setCountCapped: rows.length > SET_COUNT_CAP,
  };
}

/** Every exercise, with a set count. Pages follow the name index. */
export const browse = authedQuery({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(libraryItemValidator),
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("exercises")
      .withIndex("by_user_and_normalized_name", (q) => q.eq("userId", ctx.userId))
      .paginate(args.paginationOpts);

    const page = await Promise.all(
      result.page.map(async (exercise) => {
        const counts = await countSets(ctx, ctx.userId, exercise._id);
        return {
          _id: exercise._id,
          name: exercise.name,
          setCount: counts.setCount,
          setCountCapped: counts.setCountCapped,
          ...presentMuscle(exercise),
        };
      }),
    );
    return { ...result, page };
  },
});

const renameResult = v.union(
  v.object({
    status: v.literal("renamed"),
    name: v.string(),
  }),
  v.object({
    status: v.literal("conflict"),
    intoId: v.id("exercises"),
    intoName: v.string(),
    fromName: v.string(),
    setCount: v.number(),
    setCountCapped: v.boolean(),
  }),
);

export const rename = authedMutation({
  args: {
    exerciseId: v.id("exercises"),
    name: v.string(),
  },
  returns: renameResult,
  handler: async (ctx, args) => {
    const exercise = await ctx.db.get("exercises", args.exerciseId);
    if (!exercise || exercise.userId !== ctx.userId) {
      throw userError("Exercise not found");
    }
    const formatted = formatExerciseName(args.name);
    if (!formatted) {
      throw userError("Exercise name must be 1 to 80 characters");
    }
    const existing = await ctx.db
      .query("exercises")
      .withIndex("by_user_and_normalized_name", (q) =>
        q.eq("userId", ctx.userId).eq("normalizedName", formatted.normalizedName),
      )
      .unique();
    if (existing && existing._id !== exercise._id) {
      if (existing.userId !== ctx.userId) {
        throw userError("Exercise not found");
      }
      const counts = await countSets(ctx, ctx.userId, exercise._id);
      return {
        status: "conflict" as const,
        intoId: existing._id,
        intoName: existing.name,
        fromName: exercise.name,
        setCount: counts.setCount,
        setCountCapped: counts.setCountCapped,
      };
    }
    await ctx.db.patch("exercises", exercise._id, {
      name: formatted.name,
      normalizedName: formatted.normalizedName,
    });
    return { status: "renamed" as const, name: formatted.name };
  },
});

export const merge = authedMutation({
  args: {
    fromId: v.id("exercises"),
    intoId: v.id("exercises"),
  },
  returns: v.object({
    moved: v.number(),
    name: v.string(),
    continuing: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const result = await applyMergeBatch(ctx, ctx.userId, args.fromId, args.intoId);
    if (!result.done) {
      await ctx.scheduler.runAfter(0, internal.exercises.continueMerge, {
        userId: ctx.userId,
        fromId: args.fromId,
        intoId: args.intoId,
      });
    }
    return {
      moved: result.moved,
      name: result.name,
      continuing: !result.done,
    };
  },
});

/**
 * Finishes a merge that did not fit in the first transaction. There is no
 * signed-in caller: the public merge already checked auth and the allow list,
 * and passed that user id. Each run checks the user is still allowed and that
 * both exercises still belong to them. A user who lost access stops here
 * without deleting anything; running it again later continues the same merge.
 */
export const continueMerge = internalMutation({
  args: {
    userId: v.id("users"),
    fromId: v.id("exercises"),
    intoId: v.id("exercises"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await ctx.db.get("users", args.userId);
    const email = user?.email ? normalizeEmail(user.email) : null;
    if (!email || !(await isEmailAllowed(ctx, email))) {
      return null;
    }
    const result = await applyMergeBatch(ctx, args.userId, args.fromId, args.intoId);
    if (!result.done) {
      await ctx.scheduler.runAfter(0, internal.exercises.continueMerge, {
        userId: args.userId,
        fromId: args.fromId,
        intoId: args.intoId,
      });
    }
    return null;
  },
});
