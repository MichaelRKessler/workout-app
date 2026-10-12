import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { authedMutation, authedQuery } from "./lib/customFunctions";
import { userError } from "./lib/errors";
import {
  announcedRecords,
  personalRecordValidator,
  recordAfterEdit,
  type PersonalRecord,
} from "./lib/records";
import { combineNotes, normalizeNote } from "./lib/measures";
import { resolvedSetType } from "./lib/setType";
import { setTypeValidator } from "./lib/setTypeValidator";
import {
  MAX_SETS_PER_BATCH,
  assertSessionCanAcceptSets,
  getOrCreateExercise,
  getOwnedSession,
  loadPreviousExerciseSets,
  loadSetsBefore,
  normalizeSetInput,
  presentSet,
  recordPoint,
  requireWritableSession,
  storedSetFields,
} from "./lib/workouts";

const measureValidator = {
  reps: v.union(v.number(), v.null()),
  weightLb: v.number(),
  durationSec: v.union(v.number(), v.null()),
  distanceM: v.union(v.number(), v.null()),
  calories: v.union(v.number(), v.null()),
  rpe: v.union(v.number(), v.null()),
  setType: setTypeValidator,
};

const setValidator = v.object({
  _id: v.id("sets"),
  exerciseId: v.id("exercises"),
  exerciseName: v.string(),
  ...measureValidator,
  loggedAt: v.number(),
  clientId: v.union(v.string(), v.null()),
});

const setInput = v.object({
  reps: v.optional(v.number()),
  weightLb: v.optional(v.number()),
  durationSec: v.optional(v.number()),
  distanceM: v.optional(v.number()),
  calories: v.optional(v.number()),
  rpe: v.optional(v.number()),
  setType: v.optional(setTypeValidator),
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
          clientId: set.clientId ?? null,
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
  created: Array<{ _id: Id<"sets">; loggedAt: number } & ReturnType<typeof recordPoint>>,
): Promise<{ headline: PersonalRecord | null; records: PersonalRecord[] }> {
  const earliest = created.reduce(
    (min, set) => Math.min(min, set.loggedAt),
    Number.POSITIVE_INFINITY,
  );
  const earlier = await loadSetsBefore(ctx, userId, exerciseId, earliest);
  const previous = earlier
    .filter((set) => set.userId === userId && set.exerciseId === exerciseId)
    .map((set) => recordPoint(set));
  return announcedRecords(exerciseName, created, previous);
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
    calories?: number;
    rpe?: number;
    setType?: "warmup" | "working" | "drop" | "failure";
  }>,
  loggedAtStart?: number,
): Promise<{
  setIds: Array<Id<"sets">>;
  personalRecord: PersonalRecord | null;
  personalRecords: PersonalRecord[];
  nextLoggedAt: number;
}> {
  if (sets.length > MAX_SETS_PER_BATCH) {
    throw userError(`Log up to ${MAX_SETS_PER_BATCH} sets at a time`);
  }

  const validated = sets.map((set) => normalizeSetInput(set));
  await assertSessionCanAcceptSets(ctx, session._id, validated.length);
  const exerciseId = await getOrCreateExercise(ctx, userId, exerciseName);
  const exercise = await ctx.db.get("exercises", exerciseId);
  const loggedAt = loggedAtStart ?? (await performedAt(ctx, session, validated.length));

  const created: Array<{ _id: Id<"sets">; loggedAt: number } & ReturnType<typeof recordPoint>> = [];
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
      loggedAt: loggedAt + index,
      ...storedSetFields(set),
    });
    created.push({
      _id: setId,
      loggedAt: loggedAt + index,
      ...recordPoint({ ...set, sessionId: session._id }),
    });
  }
  const announced = await recordForInserted(
      ctx,
      userId,
      exerciseId,
      exercise?.name ?? exerciseName,
      created,
    );
  return {
    setIds: created.map((set) => set._id),
    personalRecord: announced.headline,
    personalRecords: announced.records,
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
    calories: v.optional(v.number()),
    rpe: v.optional(v.number()),
    setType: v.optional(setTypeValidator),
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
        calories: args.calories,
        rpe: args.rpe,
        setType: args.setType,
      },
    ]);
    const setId = saved.setIds[0];
    if (!setId) {
      throw userError("Add at least one set");
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
      throw userError("Add at least one set");
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
      throw userError("Add at least one exercise");
    }
    const total = args.exercises.reduce((sum, exercise) => sum + exercise.sets.length, 0);
    if (total === 0) {
      throw userError("Add at least one set");
    }
    if (total > MAX_SETS_PER_BATCH) {
      throw userError(`Log up to ${MAX_SETS_PER_BATCH} sets at a time`);
    }
    const note = normalizeNote(args.note);
    const session = await requireWritableSession(ctx, ctx.userId, args.sessionId);
    let loggedAt = await performedAt(ctx, session, total);
    const setIds: Array<Id<"sets">> = [];
    const personalRecords: PersonalRecord[] = [];
    for (const exercise of args.exercises) {
      if (exercise.sets.length === 0) {
        throw userError("Add at least one set");
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
      personalRecords.push(...saved.personalRecords);
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
    calories: v.optional(v.number()),
    rpe: v.optional(v.number()),
    setType: v.optional(setTypeValidator),
  },
  returns: v.union(personalRecordValidator, v.null()),
  handler: async (ctx, args) => {
    const set = await ctx.db.get("sets", args.setId);
    if (!set || set.userId !== ctx.userId) {
      throw userError("Set not found");
    }
    await requireWritableSession(ctx, ctx.userId, set.sessionId);
    const normalized = normalizeSetInput({
      ...args,
      setType: args.setType ?? resolvedSetType(set.setType),
    });
    const exercise = await ctx.db.get("exercises", set.exerciseId);
    const earlier = await loadSetsBefore(ctx, ctx.userId, set.exerciseId, set.loggedAt);
    const previous = earlier
      .filter((item) => item.userId === ctx.userId && item.exerciseId === set.exerciseId)
      .map((item) => recordPoint(item));
    const personalRecord = recordAfterEdit(
      exercise?.name ?? "Exercise",
      recordPoint(set),
      recordPoint({ ...normalized, sessionId: set.sessionId }),
      previous,
    );
    await ctx.db.replace("sets", args.setId, {
      userId: set.userId,
      sessionId: set.sessionId,
      exerciseId: set.exerciseId,
      loggedAt: set.loggedAt,
      ...storedSetFields(normalized),
      ...(set.order !== undefined ? { order: set.order } : {}),
      ...(set.clientId !== undefined ? { clientId: set.clientId } : {}),
      ...(set.clientRevision !== undefined ? { clientRevision: set.clientRevision } : {}),
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
      throw userError("Choose at least one set");
    }
    if (args.setIds.length > MAX_SETS_PER_BATCH) {
      throw userError(`Remove up to ${MAX_SETS_PER_BATCH} sets at a time`);
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
      throw userError("Set not found");
    }
    if (sessionId === null) {
      sessionId = set.sessionId;
    } else if (set.sessionId !== sessionId) {
      throw userError("Sets must belong to the same workout");
    }
  }

  if (sessionId === null) {
    throw userError("Choose at least one set");
  }
  await requireWritableSession(ctx, userId, sessionId);

  for (const setId of uniqueIds) {
    await ctx.db.delete("sets", setId);
  }
}
