import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { authedQuery } from "./lib/customFunctions";
import { MAX_KNOWN_EXERCISE_NAMES } from "./lib/exerciseName";
import { summarizeEfforts, trendFromSets } from "./lib/records";
import {
  EXERCISE_RECORD_SCAN,
  loadRecentSetsForExercise,
  loadVoiceExerciseNames,
} from "./lib/workouts";

const TREND_SESSIONS = 48;

const effortValidator = v.object({
  setId: v.id("sets"),
  sessionId: v.id("sessions"),
  reps: v.number(),
  weightLb: v.number(),
  epleyLb: v.union(v.number(), v.null()),
  loggedAt: v.number(),
});

const historySetValidator = v.object({
  _id: v.id("sets"),
  reps: v.number(),
  weightLb: v.number(),
  loggedAt: v.number(),
  sessionId: v.id("sessions"),
  sessionStartedAt: v.number(),
});

async function ownedExercise(
  ctx: QueryCtx,
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
    }));
    exercises.sort((left, right) => left.name.localeCompare(right.name));

    return { exercises, truncated };
  },
});

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
      trendUnit: v.union(v.literal("lb"), v.literal("reps")),
      trend: v.array(
        v.object({
          sessionId: v.id("sessions"),
          startedAt: v.number(),
          value: v.number(),
        }),
      ),
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
          loggedAt: set.loggedAt,
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
        loggedAt: value.loggedAt,
      };
    }

    return {
      _id: exercise._id,
      name: exercise.name,
      bestWeight: effort(efforts.bestWeight),
      bestEpley: effort(efforts.bestEpley),
      bestBodyweight: effort(efforts.bestBodyweight),
      trendUnit: trend.unit,
      trend: trend.points.map((point) => ({
        sessionId: point.sessionId as Id<"sessions">,
        startedAt: point.startedAt,
        value: point.value,
      })),
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
        reps: set.reps,
        weightLb: set.weightLb,
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
