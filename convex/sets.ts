import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { authedMutation, authedQuery } from "./lib/customFunctions";
import {
  personalRecordForBatch,
  personalRecordValidator,
  type PersonalRecord,
} from "./lib/records";
import { combineNotes, normalizeNote } from "./lib/measures";
import {
  EXERCISE_RECORD_SCAN,
  MAX_SETS_PER_BATCH,
  assertSessionCanAcceptSets,
  getOrCreateExercise,
  getOwnedSession,
  loadPreviousExerciseSets,
  loadRecentSetsForExercise,
  normalizeSetInput,
  presentSet,
  recordPoint,
  requireWritableSession,
} from "./lib/workouts";

const measureValidator = {
  reps: v.union(v.number(), v.null()),
  weightLb: v.number(),
  durationSec: v.union(v.number(), v.null()),
  distanceM: v.union(v.number(), v.null()),
  rpe: v.union(v.number(), v.null()),
};

const setValidator = v.object({
  _id: v.id("sets"),
  exerciseId: v.id("exercises"),
  exerciseName: v.string(),
  ...measureValidator,
  loggedAt: v.number(),
});

const setInput = v.object({
  reps: v.optional(v.number()),
  weightLb: v.optional(v.number()),
  durationSec: v.optional(v.number()),
  distanceM: v.optional(v.number()),
  rpe: v.optional(v.number()),
});

const previousExerciseValidator = v.object({
  exerciseName: v.string(),
  normalizedName: v.string(),
  sets: v.array(v.object(measureValidator)),
});

export const recentForExercise = authedQuery({
  args: {
    exerciseName: v.string(),
    excludeSessionId: v.optional(v.id("sessions")),
  },
  returns: v.union(previousExerciseValidator, v.null()),
  handler: async (ctx, args) => {
    return await loadPreviousExerciseSets(
      ctx,
      ctx.userId,
      args.exerciseName,
      args.excludeSessionId,
    );
  },
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
          ...presentSet(set),
          loggedAt: set.loggedAt,
        };
      }),
    );
  },
});

const loggedSetsValidator = v.object({
  setIds: v.array(v.id("sets")),
  personalRecord: v.union(personalRecordValidator, v.null()),
});

const loggedWorkoutValidator = v.object({
  setIds: v.array(v.id("sets")),
  personalRecords: v.array(personalRecordValidator),
});

async function performedAt(
  ctx: MutationCtx,
  session: { _id: Id<"sessions">; status: "open" | "completed"; startedAt: number },
  count: number,
): Promise<number> {
  if (session.status === "open") {
    return Date.now();
  }
  const existing = await ctx.db
    .query("sets")
    .withIndex("by_session_and_exercise", (q) => q.eq("sessionId", session._id))
    .take(500);
  let newest = session.startedAt;
  for (const set of existing) {
    if (set.loggedAt > newest) {
      newest = set.loggedAt;
    }
  }
  const now = Date.now();
  let base = newest + 1;
  if (base + count - 1 > now) {
    base = now - (count - 1);
  }
  if (base < session.startedAt) {
    base = session.startedAt;
  }
  return base;
}

async function recordForInserted(
  ctx: MutationCtx,
  userId: Id<"users">,
  exerciseId: Id<"exercises">,
  exerciseName: string,
  created: Array<{ _id: Id<"sets"> } & ReturnType<typeof recordPoint>>,
): Promise<PersonalRecord | null> {
  const recent = await loadRecentSetsForExercise(ctx, userId, exerciseId);
  const createdIds = new Set(created.map((set) => set._id));
  const previous = recent
    .filter((set) => !createdIds.has(set._id))
    .slice(0, EXERCISE_RECORD_SCAN)
    .map((set) => recordPoint(set));
  return personalRecordForBatch(exerciseName, created, previous);
}

async function insertSets(
  ctx: MutationCtx,
  userId: Id<"users">,
  session: { _id: Id<"sessions">; status: "open" | "completed"; startedAt: number },
  exerciseName: string,
  sets: Array<{
    reps?: number;
    weightLb?: number;
    durationSec?: number;
    distanceM?: number;
    rpe?: number;
  }>,
  loggedAtStart?: number,
): Promise<{ setIds: Array<Id<"sets">>; personalRecord: PersonalRecord | null; nextLoggedAt: number }> {
  if (sets.length > MAX_SETS_PER_BATCH) {
    throw new Error(`Log up to ${MAX_SETS_PER_BATCH} sets at a time`);
  }

  const validated = sets.map((set) => normalizeSetInput(set));
  await assertSessionCanAcceptSets(ctx, session._id, validated.length);
  const exerciseId = await getOrCreateExercise(ctx, userId, exerciseName);
  const exercise = await ctx.db.get("exercises", exerciseId);
  const loggedAt = loggedAtStart ?? (await performedAt(ctx, session, validated.length));

  const created: Array<{ _id: Id<"sets"> } & ReturnType<typeof recordPoint>> = [];
  for (let index = 0; index < validated.length; index += 1) {
    const set = validated[index];
    if (!set) {
      continue;
    }
    // One millisecond apart so a batch keeps its confirmed order when sorted
    // by loggedAt, even if the writes share the same clock reading.
    const setId = await ctx.db.insert("sets", {
      userId,
      sessionId: session._id,
      exerciseId,
      weightLb: set.weightLb,
      loggedAt: loggedAt + index,
      ...(set.reps !== undefined ? { reps: set.reps } : {}),
      ...(set.durationSec !== undefined ? { durationSec: set.durationSec } : {}),
      ...(set.distanceM !== undefined ? { distanceM: set.distanceM } : {}),
      ...(set.rpe !== undefined ? { rpe: set.rpe } : {}),
    });
    created.push({ _id: setId, ...recordPoint(set) });
  }
  return {
    setIds: created.map((set) => set._id),
    personalRecord: await recordForInserted(
      ctx,
      userId,
      exerciseId,
      exercise?.name ?? exerciseName,
      created,
    ),
    nextLoggedAt: loggedAt + validated.length,
  };
}

export const log = authedMutation({
  args: {
    sessionId: v.id("sessions"),
    exerciseName: v.string(),
    reps: v.optional(v.number()),
    weightLb: v.optional(v.number()),
    durationSec: v.optional(v.number()),
    distanceM: v.optional(v.number()),
    rpe: v.optional(v.number()),
  },
  returns: v.object({
    setId: v.id("sets"),
    personalRecord: v.union(personalRecordValidator, v.null()),
  }),
  handler: async (ctx, args) => {
    const session = await requireWritableSession(ctx, ctx.userId, args.sessionId);
    const saved = await insertSets(ctx, ctx.userId, session, args.exerciseName, [
      {
        reps: args.reps,
        weightLb: args.weightLb,
        durationSec: args.durationSec,
        distanceM: args.distanceM,
        rpe: args.rpe,
      },
    ]);
    const setId = saved.setIds[0];
    if (!setId) {
      throw new Error("Add at least one set");
    }
    return { setId, personalRecord: saved.personalRecord };
  },
});

export const logMany = authedMutation({
  args: {
    sessionId: v.id("sessions"),
    exerciseName: v.string(),
    sets: v.array(setInput),
  },
  returns: loggedSetsValidator,
  handler: async (ctx, args) => {
    if (args.sets.length === 0) {
      throw new Error("Add at least one set");
    }
    const session = await requireWritableSession(ctx, ctx.userId, args.sessionId);
    const saved = await insertSets(ctx, ctx.userId, session, args.exerciseName, args.sets);
    return { setIds: saved.setIds, personalRecord: saved.personalRecord };
  },
});

/** One confirm writes every exercise, so a multi-exercise log cannot half-save. */
export const logWorkout = authedMutation({
  args: {
    sessionId: v.id("sessions"),
    note: v.optional(v.string()),
    exercises: v.array(
      v.object({
        exerciseName: v.string(),
        sets: v.array(setInput),
      }),
    ),
  },
  returns: loggedWorkoutValidator,
  handler: async (ctx, args) => {
    if (args.exercises.length === 0) {
      throw new Error("Add at least one exercise");
    }
    const total = args.exercises.reduce((sum, exercise) => sum + exercise.sets.length, 0);
    if (total === 0) {
      throw new Error("Add at least one set");
    }
    if (total > MAX_SETS_PER_BATCH) {
      throw new Error(`Log up to ${MAX_SETS_PER_BATCH} sets at a time`);
    }
    const note = normalizeNote(args.note);
    const session = await requireWritableSession(ctx, ctx.userId, args.sessionId);
    let loggedAt = await performedAt(ctx, session, total);
    const setIds: Array<Id<"sets">> = [];
    const personalRecords: PersonalRecord[] = [];
    for (const exercise of args.exercises) {
      if (exercise.sets.length === 0) {
        throw new Error("Add at least one set");
      }
      const saved = await insertSets(
        ctx,
        ctx.userId,
        session,
        exercise.exerciseName,
        exercise.sets,
        loggedAt,
      );
      loggedAt = saved.nextLoggedAt;
      setIds.push(...saved.setIds);
      if (saved.personalRecord) {
        personalRecords.push(saved.personalRecord);
      }
    }
    if (note) {
      const combined = combineNotes(session.note, note);
      if (combined && combined !== session.note) {
        await ctx.db.patch("sessions", session._id, { note: combined });
      }
    }
    return { setIds, personalRecords };
  },
});

export const update = authedMutation({
  args: {
    setId: v.id("sets"),
    reps: v.optional(v.number()),
    weightLb: v.optional(v.number()),
    durationSec: v.optional(v.number()),
    distanceM: v.optional(v.number()),
    rpe: v.optional(v.number()),
  },
  returns: v.union(personalRecordValidator, v.null()),
  handler: async (ctx, args) => {
    const set = await ctx.db.get("sets", args.setId);
    if (!set || set.userId !== ctx.userId) {
      throw new Error("Set not found");
    }
    await requireWritableSession(ctx, ctx.userId, set.sessionId);
    const normalized = normalizeSetInput(args);
    const exercise = await ctx.db.get("exercises", set.exerciseId);
    const recent = await loadRecentSetsForExercise(ctx, ctx.userId, set.exerciseId);
    const previous = recent
      .filter((item) => item._id !== set._id)
      .slice(0, EXERCISE_RECORD_SCAN)
      .map((item) => recordPoint(item));
    const personalRecord = personalRecordForBatch(
      exercise?.name ?? "Exercise",
      [recordPoint(normalized)],
      previous,
    );
    await ctx.db.patch("sets", args.setId, {
      weightLb: normalized.weightLb,
      reps: normalized.reps,
      durationSec: normalized.durationSec,
      distanceM: normalized.distanceM,
      rpe: normalized.rpe,
    });
    return personalRecord;
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
  await requireWritableSession(ctx, userId, sessionId);

  for (const setId of uniqueIds) {
    await ctx.db.delete("sets", setId);
  }
}
