import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  absorbSet,
  bestsFromStored,
  comparisonPoints,
  countableCalories,
  emptyBests,
  headlineFromStamps,
  type BestSnap,
  type Bests,
  type CalorieSnap,
  type MarkDraft,
  type MarkMetric,
} from "./recordBests";
import { announcedRecords, recordAfterEdit, recordsFromStamps, type PersonalRecord, type RecordStamp } from "./records";
import { noteSetsAdded } from "./sessionActivity";
import { resolvedSetType, type SetType } from "./setType";
import { loadSetsBefore, recordPoint } from "./workouts";

const SET_PAGE = 40;
const PURGE_PAGE = 60;
const STALL_MS = 2 * 60 * 1000;
const BACKFILL_EXERCISES = 5;
const BACKFILL_SESSIONS = 4;
const LIBRARY_CAP = 100;

const METRICS: MarkMetric[] = ["weight", "epley", "reps", "duration", "distance", "calories"];

export type InsertedSet = {
  _id: Id<"sets">;
  sessionId: Id<"sessions">;
  loggedAt: number;
  reps?: number | null;
  weightLb: number;
  durationSec?: number | null;
  distanceM?: number | null;
  calories?: number | null;
  setType?: SetType | null;
};

export type RecordedSets = {
  headline: PersonalRecord | null;
  records: PersonalRecord[];
  perSet: Array<{ setId: Id<"sets">; personalRecord: PersonalRecord | null }>;
};

type ReadCtx = QueryCtx | MutationCtx;

export async function findExerciseStats(
  ctx: ReadCtx,
  userId: Id<"users">,
  exerciseId: Id<"exercises">,
): Promise<Doc<"exerciseStats"> | null> {
  const stats = await ctx.db
    .query("exerciseStats")
    .withIndex("by_user_and_exercise", (q) => q.eq("userId", userId).eq("exerciseId", exerciseId))
    .unique();
  if (!stats || stats.userId !== userId || stats.exerciseId !== exerciseId) {
    return null;
  }
  return stats;
}

/** Library counts stay capped at 100. Ready stats avoid reading the sets. */
export function libraryCount(setCount: number): { setCount: number; setCountCapped: boolean } {
  return {
    setCount: Math.min(setCount, LIBRARY_CAP),
    setCountCapped: setCount > LIBRARY_CAP,
  };
}

export function effortsFromStats(stats: Doc<"exerciseStats">): {
  bestWeight: BestSnap | null;
  bestEpley: BestSnap | null;
  bestBodyweight: BestSnap | null;
  bestDuration: BestSnap | null;
  bestDistance: BestSnap | null;
  bestCalories: CalorieSnap | null;
} {
  return {
    bestWeight: stats.bestWeight && stats.bestWeight.weightLb > 0 ? stats.bestWeight : null,
    bestEpley: stats.bestEpley && stats.bestEpley.epleyLb !== null ? stats.bestEpley : null,
    bestBodyweight: stats.bestReps,
    bestDuration: stats.bestDuration && (stats.bestDuration.durationSec ?? 0) > 0 ? stats.bestDuration : null,
    bestDistance: stats.bestDistance && (stats.bestDistance.distanceM ?? 0) > 0 ? stats.bestDistance : null,
    bestCalories: stats.bestCalories && stats.bestCalories.calories > 0 ? stats.bestCalories : null,
  };
}

/**
 * Records for sets that were just inserted. Appends update the stored bests
 * in place. A past set, or history that is not ready yet, keeps today's scan
 * for the announcement and schedules a rebuild.
 */
export async function recordInsertedSets(
  ctx: MutationCtx,
  userId: Id<"users">,
  exerciseId: Id<"exercises">,
  exerciseName: string,
  created: InsertedSet[],
): Promise<RecordedSets> {
  if (created.length === 0) {
    return { headline: null, records: [], perSet: [] };
  }
  const sorted = [...created].sort((left, right) => left.loggedAt - right.loggedAt || (left._id < right._id ? -1 : 1));
  await noteAddedSessions(ctx, sorted);
  const stats = await findExerciseStats(ctx, userId, exerciseId);
  const earliest = sorted[0]?.loggedAt ?? 0;
  const appending =
    stats !== null &&
    stats.ready &&
    !stats.drop &&
    (stats.lastLoggedAt === null || earliest > stats.lastLoggedAt);
  if (appending && stats) {
    return await commitFold(ctx, stats, exerciseName, sorted, bestsFromStored(stats), true);
  }
  if (stats?.ready && !stats.drop) {
    const announced = await announceFromMarks(ctx, stats, exerciseName, sorted);
    await requestRebuild(ctx, userId, exerciseId);
    return announced;
  }
  if (await historyIsOnly(ctx, userId, exerciseId, sorted)) {
    return await commitFresh(ctx, userId, exerciseId, exerciseName, sorted);
  }
  const announced = await announceFromScan(ctx, userId, exerciseId, exerciseName, sorted);
  await requestRebuild(ctx, userId, exerciseId);
  return announced;
}

/** Announces an edit, then rebuilds. The latest set can be judged from marks. */
export async function recordEditedSet(
  ctx: MutationCtx,
  userId: Id<"users">,
  exerciseId: Id<"exercises">,
  exerciseName: string,
  loggedAt: number,
  sessionId: Id<"sessions">,
  before: ReturnType<typeof recordPoint>,
  after: ReturnType<typeof recordPoint>,
): Promise<PersonalRecord | null> {
  const stats = await findExerciseStats(ctx, userId, exerciseId);
  const latest =
    stats !== null &&
    stats.ready &&
    !stats.drop &&
    (stats.lastLoggedAt === null || loggedAt >= stats.lastLoggedAt);
  let personalRecord: PersonalRecord | null;
  if (latest && stats) {
    const bests = await bestsBefore(ctx, stats, loggedAt);
    const row = await readSessionCalories(ctx, userId, exerciseId, stats.generation, sessionId);
    const prior = Math.max(0, row - countableCalories(before));
    personalRecord = recordAfterEdit(
      exerciseName,
      before,
      after,
      comparisonPoints(bests, sessionId, prior),
    );
  } else {
    const earlier = await loadSetsBefore(ctx, userId, exerciseId, loggedAt);
    personalRecord = recordAfterEdit(
      exerciseName,
      before,
      after,
      earlier
        .filter((set) => set.userId === userId && set.exerciseId === exerciseId)
        .map((set) => recordPoint(set)),
    );
  }
  await requestRebuild(ctx, userId, exerciseId);
  return personalRecord;
}

export async function invalidateExercises(
  ctx: MutationCtx,
  userId: Id<"users">,
  exerciseIds: Array<Id<"exercises">>,
): Promise<void> {
  const seen = new Set<string>();
  for (const exerciseId of exerciseIds) {
    if (seen.has(exerciseId)) {
      continue;
    }
    seen.add(exerciseId);
    await requestRebuild(ctx, userId, exerciseId);
  }
}

export async function stampsOrScan(
  ctx: ReadCtx,
  userId: Id<"users">,
  exerciseId: Id<"exercises">,
  exerciseName: string,
  created: Array<{ recordStamps?: RecordStamp[] }>,
  scan: () => Promise<PersonalRecord[]>,
): Promise<PersonalRecord[]> {
  if (created.length === 0) {
    return [];
  }
  if (created.some((set) => set.recordStamps === undefined)) {
    return await scan();
  }
  const stats = await findExerciseStats(ctx, userId, exerciseId);
  if (!stats?.ready || stats.drop) {
    return await scan();
  }
  return recordsFromStamps(
    exerciseName,
    created.map((set) => set.recordStamps ?? []),
  );
}

export async function requestRebuild(
  ctx: MutationCtx,
  userId: Id<"users">,
  exerciseId: Id<"exercises">,
): Promise<void> {
  const exercise = await ctx.db.get("exercises", exerciseId);
  const stats = await findExerciseStats(ctx, userId, exerciseId);
  const now = Date.now();
  const missing = !exercise || exercise.userId !== userId;
  if (missing) {
    if (!stats) {
      return;
    }
    await ctx.db.patch("exerciseStats", stats._id, {
      drop: true,
      ready: false,
      dirty: false,
      phase: "purge",
      cursor: null,
      scheduledAt: now,
    });
    await schedulePage(userId, exerciseId, stats.generation, null, ctx);
    return;
  }
  if (!stats) {
    await ctx.db.insert("exerciseStats", blankStats(userId, exerciseId, 1, now));
    await schedulePage(userId, exerciseId, 1, null, ctx);
    return;
  }
  if (stats.ready) {
    const generation = stats.generation + 1;
    await ctx.db.patch("exerciseStats", stats._id, {
      generation,
      phase: "purge",
      cursor: null,
      ready: false,
      dirty: false,
      drop: false,
      scheduledAt: now,
    });
    await schedulePage(userId, exerciseId, generation, null, ctx);
    return;
  }
  if (!stats.dirty) {
    await ctx.db.patch("exerciseStats", stats._id, { dirty: true });
  }
}

export async function runRebuildPage(
  ctx: MutationCtx,
  args: {
    userId: Id<"users">;
    exerciseId: Id<"exercises">;
    generation: number;
    cursor: string | null;
  },
): Promise<void> {
  const stats = await findExerciseStats(ctx, args.userId, args.exerciseId);
  if (!stats || stats.generation !== args.generation || (stats.cursor ?? null) !== (args.cursor ?? null)) {
    return;
  }
  const exercise = await ctx.db.get("exercises", args.exerciseId);
  if (exercise && exercise.userId !== args.userId) {
    return;
  }
  if (!exercise && !stats.drop) {
    await ctx.db.patch("exerciseStats", stats._id, {
      drop: true,
      ready: false,
      phase: "purge",
      cursor: null,
      scheduledAt: Date.now(),
    });
    await schedulePage(args.userId, args.exerciseId, stats.generation, null, ctx);
    return;
  }
  if (stats.drop && stats.phase === "walk") {
    await ctx.db.patch("exerciseStats", stats._id, {
      phase: "purge",
      cursor: null,
      scheduledAt: Date.now(),
    });
    await schedulePage(args.userId, args.exerciseId, stats.generation, null, ctx);
    return;
  }
  if (stats.phase === "purge") {
    await purgeMarks(ctx, stats, args.cursor);
    return;
  }
  if (stats.phase === "purgeCalories") {
    await purgeCalories(ctx, stats, args.cursor);
    return;
  }
  await walkSets(ctx, stats, args.cursor);
}

export async function runBackfill(ctx: MutationCtx, followUp: boolean): Promise<void> {
  const now = Date.now();
  await resumeStalled(ctx, now);
  let state = await ctx.db
    .query("statsBackfill")
    .withIndex("by_key", (q) => q.eq("key", "main"))
    .unique();
  if (!state) {
    const id = await ctx.db.insert("statsBackfill", {
      key: "main",
      exerciseCursor: null,
      exercisesDone: false,
      sessionCursor: null,
      sessionsDone: false,
      runningUntil: 0,
    });
    state = await ctx.db.get("statsBackfill", id);
  }
  if (!state || state.key !== "main") {
    return;
  }
  if (state.exercisesDone && state.sessionsDone) {
    return;
  }
  if (!followUp && state.runningUntil > now) {
    return;
  }
  await ctx.db.patch("statsBackfill", state._id, { runningUntil: now + 30_000 });
  let exercisesDone = state.exercisesDone;
  let exerciseCursor = state.exerciseCursor;
  if (!exercisesDone) {
    const page = await ctx.db.query("exercises").paginate({
      numItems: BACKFILL_EXERCISES,
      cursor: exerciseCursor,
    });
    for (const exercise of page.page) {
      if (exercise.userId === undefined) {
        continue;
      }
      const existing = await findExerciseStats(ctx, exercise.userId, exercise._id);
      if (!existing) {
        await requestRebuild(ctx, exercise.userId, exercise._id);
      }
    }
    exercisesDone = page.isDone;
    exerciseCursor = page.isDone ? null : page.continueCursor;
    await ctx.db.patch("statsBackfill", state._id, {
      exercisesDone,
      exerciseCursor,
      runningUntil: Date.now() + 30_000,
    });
    // One paginate per mutation. Sessions wait for the next tick.
    await ctx.scheduler.runAfter(0, internal.exerciseStats.backfillTick, { followUp: true });
    return;
  }
  const sessions = await ctx.db.query("sessions").paginate({
    numItems: BACKFILL_SESSIONS,
    cursor: state.sessionCursor,
  });
  for (const session of sessions.page) {
    if (session.setCount !== undefined) {
      continue;
    }
    const sets = await ctx.db
      .query("sets")
      .withIndex("by_session_and_exercise", (q) => q.eq("sessionId", session._id))
      .take(500);
    const owned = sets.filter((set) => set.userId === session.userId);
    let last: number | null = null;
    for (const set of owned) {
      if (last === null || set.loggedAt > last) {
        last = set.loggedAt;
      }
    }
    const fresh = await ctx.db.get("sessions", session._id);
    if (!fresh || fresh.setCount !== undefined || fresh.userId !== session.userId) {
      continue;
    }
    await ctx.db.patch("sessions", session._id, {
      setCount: owned.length,
      ...(last !== null ? { lastSetAt: last } : {}),
    });
  }
  await ctx.db.patch("statsBackfill", state._id, {
    exercisesDone: true,
    sessionCursor: sessions.isDone ? null : sessions.continueCursor,
    sessionsDone: sessions.isDone,
    runningUntil: sessions.isDone ? 0 : Date.now() + 30_000,
  });
  if (!sessions.isDone) {
    await ctx.scheduler.runAfter(0, internal.exerciseStats.backfillTick, { followUp: true });
  }
}

async function resumeStalled(ctx: MutationCtx, now: number): Promise<void> {
  const rows = await ctx.db
    .query("exerciseStats")
    .withIndex("by_ready", (q) => q.eq("ready", false))
    .take(8);
  for (const stats of rows) {
    if (stats.scheduledAt !== null && now - stats.scheduledAt < STALL_MS) {
      continue;
    }
    await ctx.db.patch("exerciseStats", stats._id, { scheduledAt: now });
    await schedulePage(stats.userId, stats.exerciseId, stats.generation, stats.cursor, ctx);
  }
}

async function purgeMarks(
  ctx: MutationCtx,
  stats: Doc<"exerciseStats">,
  cursor: string | null,
): Promise<void> {
  const page = await ctx.db
    .query("recordMarks")
    .withIndex("by_exercise", (q) => q.eq("exerciseId", stats.exerciseId))
    .paginate({ numItems: PURGE_PAGE, cursor });
  for (const mark of page.page) {
    if (mark.userId !== stats.userId || mark.exerciseId !== stats.exerciseId) {
      continue;
    }
    if (stats.drop || mark.generation !== stats.generation) {
      await ctx.db.delete("recordMarks", mark._id);
    }
  }
  if (!page.isDone) {
    await continuePage(ctx, stats, page.continueCursor, {});
    return;
  }
  await ctx.db.patch("exerciseStats", stats._id, {
    phase: "purgeCalories",
    cursor: null,
    scheduledAt: Date.now(),
  });
  await schedulePage(stats.userId, stats.exerciseId, stats.generation, null, ctx);
}

async function purgeCalories(
  ctx: MutationCtx,
  stats: Doc<"exerciseStats">,
  cursor: string | null,
): Promise<void> {
  const page = await ctx.db
    .query("exerciseSessionCalories")
    .withIndex("by_exercise", (q) => q.eq("exerciseId", stats.exerciseId))
    .paginate({ numItems: PURGE_PAGE, cursor });
  for (const row of page.page) {
    if (row.userId !== stats.userId || row.exerciseId !== stats.exerciseId) {
      continue;
    }
    if (stats.drop || row.generation !== stats.generation) {
      await ctx.db.delete("exerciseSessionCalories", row._id);
    }
  }
  if (!page.isDone) {
    await continuePage(ctx, stats, page.continueCursor, {});
    return;
  }
  if (stats.drop) {
    await ctx.db.delete("exerciseStats", stats._id);
    return;
  }
  await ctx.db.patch("exerciseStats", stats._id, {
    phase: "walk",
    cursor: null,
    setCount: 0,
    lastLoggedAt: null,
    scheduledAt: Date.now(),
    ...storedBests(emptyBests()),
  });
  await schedulePage(stats.userId, stats.exerciseId, stats.generation, null, ctx);
}

async function walkSets(
  ctx: MutationCtx,
  stats: Doc<"exerciseStats">,
  cursor: string | null,
): Promise<void> {
  const exercise = await ctx.db.get("exercises", stats.exerciseId);
  if (!exercise || exercise.userId !== stats.userId) {
    await ctx.db.patch("exerciseStats", stats._id, { drop: true, phase: "purge", cursor: null });
    await schedulePage(stats.userId, stats.exerciseId, stats.generation, null, ctx);
    return;
  }
  const page = await ctx.db
    .query("sets")
    .withIndex("by_user_exercise_and_logged", (q) =>
      q.eq("userId", stats.userId).eq("exerciseId", stats.exerciseId),
    )
    .order("asc")
    .paginate({ numItems: SET_PAGE, cursor });
  let bests = bestsFromStored(stats);
  let setCount = stats.setCount;
  let lastLoggedAt = stats.lastLoggedAt;
  for (const set of page.page) {
    if (set.userId !== stats.userId || set.exerciseId !== stats.exerciseId) {
      continue;
    }
    const before = await readSessionCalories(
      ctx,
      stats.userId,
      stats.exerciseId,
      stats.generation,
      set.sessionId,
    );
    const folded = absorbSet(exercise.name, bests, before, judged(set));
    bests = folded.bests;
    await writeStamps(ctx, set._id, set.recordStamps, folded.stamps);
    await writeMarks(ctx, stats, folded.marks);
    await writeSessionCalories(
      ctx,
      stats,
      set.sessionId,
      folded.sessionCalories,
      set.loggedAt,
    );
    setCount += 1;
    if (lastLoggedAt === null || set.loggedAt > lastLoggedAt) {
      lastLoggedAt = set.loggedAt;
    }
  }
  const patch = {
    ...storedBests(bests),
    setCount,
    lastLoggedAt,
    scheduledAt: Date.now(),
  };
  if (!page.isDone) {
    await continuePage(ctx, stats, page.continueCursor, patch);
    return;
  }
  if (stats.dirty) {
    const generation = stats.generation + 1;
    await ctx.db.patch("exerciseStats", stats._id, {
      ...storedBests(emptyBests()),
      generation,
      phase: "purge",
      cursor: null,
      ready: false,
      dirty: false,
      drop: false,
      setCount: 0,
      lastLoggedAt: null,
      scheduledAt: Date.now(),
    });
    await schedulePage(stats.userId, stats.exerciseId, generation, null, ctx);
    return;
  }
  await ctx.db.patch("exerciseStats", stats._id, {
    ...patch,
    ready: true,
    dirty: false,
    cursor: null,
    phase: "walk",
  });
}

async function commitFresh(
  ctx: MutationCtx,
  userId: Id<"users">,
  exerciseId: Id<"exercises">,
  exerciseName: string,
  sets: InsertedSet[],
): Promise<RecordedSets> {
  const now = Date.now();
  const id = await ctx.db.insert("exerciseStats", {
    ...blankStats(userId, exerciseId, 1, now),
    phase: "walk",
    ready: true,
  });
  const stats = await ctx.db.get("exerciseStats", id);
  if (!stats) {
    return announceFromScan(ctx, userId, exerciseId, exerciseName, sets);
  }
  return await commitFold(ctx, stats, exerciseName, sets, emptyBests(), true);
}

async function commitFold(
  ctx: MutationCtx,
  stats: Doc<"exerciseStats">,
  exerciseName: string,
  sets: InsertedSet[],
  bests: Bests,
  ready: boolean,
): Promise<RecordedSets> {
  const sessionId = sets[0]?.sessionId;
  const sameSession = sessionId !== undefined && sets.every((set) => set.sessionId === sessionId);
  const prior = sameSession
    ? await readSessionCalories(ctx, stats.userId, stats.exerciseId, stats.generation, sessionId)
    : 0;
  const announced = sameSession
    ? announcedRecords(
        exerciseName,
        sets.map((set) => pointOf(set)),
        comparisonPoints(bests, sessionId, prior),
      )
    : null;
  let current = bests;
  const totals = new Map<string, number>();
  const perSet: RecordedSets["perSet"] = [];
  for (const set of sets) {
    const before = totals.get(set.sessionId) ?? (await readSessionCalories(
      ctx,
      stats.userId,
      stats.exerciseId,
      stats.generation,
      set.sessionId,
    ));
    const folded = absorbSet(exerciseName, current, before, judged(set));
    current = folded.bests;
    totals.set(set.sessionId, folded.sessionCalories);
    await writeStamps(ctx, set._id, undefined, folded.stamps);
    await writeMarks(ctx, stats, folded.marks);
    perSet.push({
      setId: set._id,
      personalRecord: headlineFromStamps(exerciseName, folded.stamps),
    });
  }
  for (const [id, calories] of totals) {
    const loggedAt = sets.filter((set) => set.sessionId === id).reduce((max, set) => Math.max(max, set.loggedAt), 0);
    await writeSessionCalories(ctx, stats, id as Id<"sessions">, calories, loggedAt);
  }
  const last = sets[sets.length - 1];
  const lastLoggedAt =
    stats.lastLoggedAt === null || (last && last.loggedAt > stats.lastLoggedAt)
      ? (last?.loggedAt ?? stats.lastLoggedAt)
      : stats.lastLoggedAt;
  await ctx.db.patch("exerciseStats", stats._id, {
    ...storedBests(current),
    setCount: stats.setCount + sets.length,
    lastLoggedAt,
    ready,
    phase: "walk",
  });
  if (announced) {
    return { headline: announced.headline, records: announced.records, perSet };
  }
  let headline: PersonalRecord | null = null;
  for (const item of perSet) {
    if (item.personalRecord) {
      headline = item.personalRecord;
    }
  }
  return { headline, records: headline ? [headline] : [], perSet };
}

async function announceFromMarks(
  ctx: MutationCtx,
  stats: Doc<"exerciseStats">,
  exerciseName: string,
  sets: InsertedSet[],
): Promise<RecordedSets> {
  const earliest = sets[0]?.loggedAt ?? 0;
  const bests = await bestsBefore(ctx, stats, earliest);
  const exclude = new Set(sets.map((set) => set._id));
  let current = bests;
  const totals = new Map<string, number>();
  const perSet: RecordedSets["perSet"] = [];
  for (const set of sets) {
    let before = totals.get(set.sessionId);
    if (before === undefined) {
      before = await caloriesBefore(
        ctx,
        stats.userId,
        stats.exerciseId,
        set.sessionId,
        earliest,
        exclude,
      );
    }
    const folded = absorbSet(exerciseName, current, before, judged(set));
    current = folded.bests;
    totals.set(set.sessionId, folded.sessionCalories);
    perSet.push({
      setId: set._id,
      personalRecord: headlineFromStamps(exerciseName, folded.stamps),
    });
  }
  const sessionId = sets[0]?.sessionId;
  const sameSession = sessionId !== undefined && sets.every((set) => set.sessionId === sessionId);
  if (sameSession) {
    const prior = await caloriesBefore(ctx, stats.userId, stats.exerciseId, sessionId, earliest, exclude);
    const announced = announcedRecords(
      exerciseName,
      sets.map((set) => pointOf(set)),
      comparisonPoints(bests, sessionId, prior),
    );
    return { headline: announced.headline, records: announced.records, perSet };
  }
  let headline: PersonalRecord | null = null;
  for (const item of perSet) {
    if (item.personalRecord) {
      headline = item.personalRecord;
    }
  }
  return { headline, records: headline ? [headline] : [], perSet };
}

async function announceFromScan(
  ctx: MutationCtx,
  userId: Id<"users">,
  exerciseId: Id<"exercises">,
  exerciseName: string,
  sets: InsertedSet[],
): Promise<RecordedSets> {
  const earliest = sets[0]?.loggedAt ?? 0;
  const earlier = await loadSetsBefore(ctx, userId, exerciseId, earliest);
  const previous = earlier
    .filter((set) => set.userId === userId && set.exerciseId === exerciseId)
    .map((set) => recordPoint(set));
  const announced = announcedRecords(
    exerciseName,
    sets.map((set) => pointOf(set)),
    previous,
  );
  const baseline = [...previous];
  const perSet: RecordedSets["perSet"] = [];
  for (const set of sets) {
    const point = pointOf(set);
    perSet.push({
      setId: set._id,
      personalRecord: announcedRecords(exerciseName, [point], baseline).headline,
    });
    baseline.push(point);
  }
  return { headline: announced.headline, records: announced.records, perSet };
}

async function historyIsOnly(
  ctx: MutationCtx,
  userId: Id<"users">,
  exerciseId: Id<"exercises">,
  created: InsertedSet[],
): Promise<boolean> {
  const ids = new Set(created.map((set) => set._id));
  const rows = await ctx.db
    .query("sets")
    .withIndex("by_user_exercise_and_logged", (q) => q.eq("userId", userId).eq("exerciseId", exerciseId))
    .take(ids.size + 1);
  if (rows.length !== ids.size) {
    return false;
  }
  return rows.every((row) => ids.has(row._id) && row.userId === userId && row.exerciseId === exerciseId);
}

async function bestsBefore(
  ctx: MutationCtx,
  stats: Doc<"exerciseStats">,
  before: number,
): Promise<Bests> {
  const bests = emptyBests();
  for (const metric of METRICS) {
    const mark = await ctx.db
      .query("recordMarks")
      .withIndex("by_metric", (q) =>
        q
          .eq("userId", stats.userId)
          .eq("exerciseId", stats.exerciseId)
          .eq("generation", stats.generation)
          .eq("metric", metric)
          .lt("loggedAt", before),
      )
      .order("desc")
      .first();
    if (!mark || mark.userId !== stats.userId || mark.exerciseId !== stats.exerciseId) {
      continue;
    }
    if (metric === "calories") {
      bests.calories = {
        sessionId: mark.sessionId,
        calories: mark.calories ?? 0,
        loggedAt: mark.loggedAt,
      };
      if (mark.otherSessionId && (mark.otherCalories ?? 0) > 0) {
        bests.secondCalories = {
          sessionId: mark.otherSessionId,
          calories: mark.otherCalories ?? 0,
          loggedAt: mark.loggedAt,
        };
      }
      continue;
    }
    const snap: BestSnap = {
      setId: mark.setId,
      sessionId: mark.sessionId,
      loggedAt: mark.loggedAt,
      reps: mark.reps,
      weightLb: mark.weightLb,
      epleyLb: mark.epleyLb,
      durationSec: mark.durationSec,
      distanceM: mark.distanceM,
    };
    if (metric === "weight") bests.weight = snap;
    if (metric === "epley") bests.epley = snap;
    if (metric === "reps") bests.reps = snap;
    if (metric === "duration") bests.duration = snap;
    if (metric === "distance") bests.distance = snap;
  }
  return bests;
}

async function caloriesBefore(
  ctx: MutationCtx,
  userId: Id<"users">,
  exerciseId: Id<"exercises">,
  sessionId: Id<"sessions">,
  before: number,
  exclude: Set<string>,
): Promise<number> {
  const sets = await ctx.db
    .query("sets")
    .withIndex("by_session_and_exercise", (q) => q.eq("sessionId", sessionId).eq("exerciseId", exerciseId))
    .take(500);
  let total = 0;
  for (const set of sets) {
    if (set.userId !== userId || set.loggedAt >= before || exclude.has(set._id)) {
      continue;
    }
    total += countableCalories(set);
  }
  return total;
}

async function readSessionCalories(
  ctx: ReadCtx,
  userId: Id<"users">,
  exerciseId: Id<"exercises">,
  generation: number,
  sessionId: Id<"sessions">,
): Promise<number> {
  const row = await ctx.db
    .query("exerciseSessionCalories")
    .withIndex("by_session", (q) =>
      q.eq("userId", userId).eq("exerciseId", exerciseId).eq("generation", generation).eq("sessionId", sessionId),
    )
    .unique();
  if (!row || row.userId !== userId) {
    return 0;
  }
  return row.calories;
}

async function writeSessionCalories(
  ctx: MutationCtx,
  stats: Doc<"exerciseStats">,
  sessionId: Id<"sessions">,
  calories: number,
  loggedAt: number,
): Promise<void> {
  const row = await ctx.db
    .query("exerciseSessionCalories")
    .withIndex("by_session", (q) =>
      q
        .eq("userId", stats.userId)
        .eq("exerciseId", stats.exerciseId)
        .eq("generation", stats.generation)
        .eq("sessionId", sessionId),
    )
    .unique();
  if (!row) {
    if (calories <= 0) {
      return;
    }
    await ctx.db.insert("exerciseSessionCalories", {
      userId: stats.userId,
      exerciseId: stats.exerciseId,
      sessionId,
      generation: stats.generation,
      calories,
      loggedAt,
    });
    return;
  }
  if (row.userId !== stats.userId || (row.calories === calories && row.loggedAt === loggedAt)) {
    return;
  }
  await ctx.db.patch("exerciseSessionCalories", row._id, { calories, loggedAt });
}

async function writeMarks(
  ctx: MutationCtx,
  stats: Doc<"exerciseStats">,
  marks: MarkDraft[],
): Promise<void> {
  for (const mark of marks) {
    await ctx.db.insert("recordMarks", {
      userId: stats.userId,
      exerciseId: stats.exerciseId,
      generation: stats.generation,
      metric: mark.metric,
      setId: mark.setId as Id<"sets">,
      sessionId: mark.sessionId as Id<"sessions">,
      loggedAt: mark.loggedAt,
      reps: mark.reps,
      weightLb: mark.weightLb,
      epleyLb: mark.epleyLb,
      durationSec: mark.durationSec,
      distanceM: mark.distanceM,
      calories: mark.calories,
      ...(mark.otherSessionId
        ? {
            otherSessionId: mark.otherSessionId as Id<"sessions">,
            otherCalories: mark.otherCalories ?? 0,
          }
        : {}),
    });
  }
}

async function writeStamps(
  ctx: MutationCtx,
  setId: Id<"sets">,
  existing: RecordStamp[] | undefined,
  stamps: RecordStamp[],
): Promise<void> {
  if (sameStamps(existing, stamps)) {
    return;
  }
  const set = await ctx.db.get("sets", setId);
  if (!set) {
    return;
  }
  await ctx.db.patch("sets", setId, { recordStamps: stamps });
}

function sameStamps(left: RecordStamp[] | undefined, right: RecordStamp[]): boolean {
  if (!left || left.length !== right.length) {
    return false;
  }
  return left.every((stamp, index) => {
    const other = right[index];
    return (
      other !== undefined &&
      stamp.kind === other.kind &&
      stamp.reps === other.reps &&
      stamp.weightLb === other.weightLb &&
      stamp.epleyLb === other.epleyLb &&
      stamp.durationSec === other.durationSec &&
      stamp.distanceM === other.distanceM &&
      stamp.calories === other.calories
    );
  });
}

async function continuePage(
  ctx: MutationCtx,
  stats: Doc<"exerciseStats">,
  cursor: string,
  patch: Omit<Partial<Doc<"exerciseStats">>, "_id" | "_creationTime">,
): Promise<void> {
  await ctx.db.patch("exerciseStats", stats._id, { ...patch, cursor, scheduledAt: Date.now() });
  await schedulePage(stats.userId, stats.exerciseId, stats.generation, cursor, ctx);
}

async function schedulePage(
  userId: Id<"users">,
  exerciseId: Id<"exercises">,
  generation: number,
  cursor: string | null,
  ctx: MutationCtx,
): Promise<void> {
  await ctx.scheduler.runAfter(0, internal.exerciseStats.rebuildPage, {
    userId,
    exerciseId,
    generation,
    cursor,
  });
}

function blankStats(userId: Id<"users">, exerciseId: Id<"exercises">, generation: number, now: number) {
  return {
    userId,
    exerciseId,
    setCount: 0,
    lastLoggedAt: null,
    ready: false,
    dirty: false,
    drop: false,
    generation,
    cursor: null,
    phase: "purge" as const,
    scheduledAt: now,
    ...storedBests(emptyBests()),
  };
}

function storedBests(bests: Bests) {
  return {
    bestWeight: storedSnap(bests.weight),
    bestEpley: storedSnap(bests.epley),
    bestReps: storedSnap(bests.reps),
    bestDuration: storedSnap(bests.duration),
    bestDistance: storedSnap(bests.distance),
    bestCalories: storedCalorie(bests.calories),
    secondCalories: storedCalorie(bests.secondCalories),
  };
}

function storedSnap(snap: BestSnap | null) {
  if (!snap) {
    return null;
  }
  return {
    setId: snap.setId as Id<"sets">,
    sessionId: snap.sessionId as Id<"sessions">,
    loggedAt: snap.loggedAt,
    reps: snap.reps,
    weightLb: snap.weightLb,
    epleyLb: snap.epleyLb,
    durationSec: snap.durationSec,
    distanceM: snap.distanceM,
  };
}

function storedCalorie(snap: CalorieSnap | null) {
  if (!snap) {
    return null;
  }
  return {
    sessionId: snap.sessionId as Id<"sessions">,
    calories: snap.calories,
    loggedAt: snap.loggedAt,
  };
}

function judged(set: InsertedSet | Doc<"sets">) {
  return {
    setId: set._id,
    sessionId: set.sessionId,
    loggedAt: set.loggedAt,
    reps: set.reps ?? null,
    weightLb: set.weightLb,
    durationSec: set.durationSec ?? null,
    distanceM: set.distanceM ?? null,
    calories: set.calories ?? null,
    setType: resolvedSetType(set.setType),
  };
}

function pointOf(set: InsertedSet) {
  return recordPoint({
    reps: set.reps,
    weightLb: set.weightLb,
    durationSec: set.durationSec,
    distanceM: set.distanceM,
    calories: set.calories,
    setType: set.setType,
    sessionId: set.sessionId,
  });
}

async function noteAddedSessions(ctx: MutationCtx, sets: InsertedSet[]): Promise<void> {
  const grouped = new Map<Id<"sessions">, number[]>();
  for (const set of sets) {
    const list = grouped.get(set.sessionId) ?? [];
    list.push(set.loggedAt);
    grouped.set(set.sessionId, list);
  }
  for (const [sessionId, loggedAts] of grouped) {
    await noteSetsAdded(ctx, sessionId, loggedAts);
  }
}
