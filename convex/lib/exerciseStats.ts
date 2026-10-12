import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  absorbPrimary,
  absorbSet,
  bestsFromStored,
  comparisonPoints,
  countableCalories,
  emptyBests,
  headlineFromStamps,
  judgedSet,
  type BestSnap,
  type Bests,
  type CalorieSnap,
  type MarkDraft,
  type MarkMetric,
} from "./recordBests";
import { announcedRecords, recordAfterEdit, recordsFromStamps, type PersonalRecord, type RecordStamp } from "./records";
import { noteSetsAdded } from "./sessionActivity";
import type { SetType } from "./setType";
import { loadSetsBefore, recordPoint } from "./workouts";

const SET_PAGE = 40;
const PURGE_PAGE = 60;
const STALL_MS = 2 * 60 * 1000;
const BACKFILL_EXERCISES = 5;
const BACKFILL_SESSIONS = 4;
const LIBRARY_CAP = 100;
const STALLED_PAGE = 8;
const DUPLICATE_SCAN = 8;
const IN_PLACE_SETS = 30;
const SESSION_SETS = 500;
const RECORD_RULES = 2;

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
type StatsPatch = Omit<Partial<Doc<"exerciseStats">>, "_id" | "_creationTime">;

/**
 * The stats row for readers. Earlier code could leave two rows for one
 * exercise. Readers treat that as no stats and scan the sets until a write
 * settles the rows.
 */
export async function findExerciseStats(
  ctx: ReadCtx,
  userId: Id<"users">,
  exerciseId: Id<"exercises">,
): Promise<Doc<"exerciseStats"> | null> {
  const rows = await ctx.db
    .query("exerciseStats")
    .withIndex("by_user_and_exercise", (q) => q.eq("userId", userId).eq("exerciseId", exerciseId))
    .take(2);
  const stats = rows[0];
  if (rows.length !== 1 || !stats || stats.userId !== userId || stats.exerciseId !== exerciseId) {
    return null;
  }
  return stats;
}

/**
 * The stats row for writers. Extra rows are deleted, and the one kept is
 * rebuilt under a generation neither row used, since both rows wrote marks
 * and session calories under their own generations. A row whose untimed
 * distance best was kept under the old rules is rebuilt once, because a
 * later timed set at that distance may have set the time to beat.
 */
async function settledStats(
  ctx: MutationCtx,
  userId: Id<"users">,
  exerciseId: Id<"exercises">,
): Promise<Doc<"exerciseStats"> | null> {
  const rows = await ctx.db
    .query("exerciseStats")
    .withIndex("by_user_and_exercise", (q) => q.eq("userId", userId).eq("exerciseId", exerciseId))
    .take(DUPLICATE_SCAN);
  const [stats, ...extras] = rows;
  if (!stats || stats.userId !== userId || stats.exerciseId !== exerciseId) {
    return null;
  }
  if (extras.length === 0) {
    const oldRules =
      stats.ready &&
      !stats.drop &&
      (stats.recordRules ?? 1) < RECORD_RULES &&
      stats.bestDistance !== null &&
      stats.bestDistance.durationSec === null;
    if (!oldRules) {
      return stats;
    }
    await schedulePage(ctx, stats, {
      generation: stats.generation + 1,
      phase: "purge",
      cursor: null,
      ready: false,
      dirty: false,
      drop: false,
    });
    return await ctx.db.get("exerciseStats", stats._id);
  }
  for (const extra of extras) {
    await ctx.db.delete("exerciseStats", extra._id);
  }
  await schedulePage(ctx, stats, {
    ...storedBests(emptyBests()),
    generation: Math.max(...rows.map((row) => row.generation)) + 1,
    phase: "purge",
    cursor: null,
    ready: false,
    dirty: false,
    drop: false,
    setCount: 0,
    lastLoggedAt: null,
  });
  return await ctx.db.get("exerciseStats", stats._id);
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
 * in place, and so does a past set that changes nothing later sets were
 * judged against. Any other past set, or history that is not ready yet,
 * keeps today's scan for the announcement and schedules a rebuild.
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
  // Callers pass sets in the order they inserted them, and the sort is stable,
  // so sets at the same time keep that order. It is the order a rebuild walks
  // them by creation time. Convex ids are not in creation order.
  const sorted = [...created].sort((left, right) => left.loggedAt - right.loggedAt);
  await noteAddedSessions(ctx, sorted);
  const stats = await settledStats(ctx, userId, exerciseId);
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
    if (!(await insertInPlace(ctx, stats, exerciseName, sorted))) {
      await requestRebuild(ctx, userId, exerciseId, earliest);
    }
    return announced;
  }
  // Only a missing row starts fresh. A row that is still rebuilding picks
  // these sets up below, from a later page or by starting over, so no second
  // row appears.
  if (!stats && (await historyIsOnly(ctx, userId, exerciseId, sorted))) {
    return await commitFresh(ctx, userId, exerciseId, exerciseName, sorted);
  }
  const announced = await announceFromScan(ctx, userId, exerciseId, exerciseName, sorted);
  await requestRebuild(ctx, userId, exerciseId, earliest);
  return announced;
}

/**
 * Announces an edit. The latest set can be judged from marks. History is
 * rebuilt unless the edit leaves it alone. Call it after the set is saved:
 * the stamps written here replace the ones the save dropped.
 */
export async function recordEditedSet(
  ctx: MutationCtx,
  userId: Id<"users">,
  exerciseName: string,
  set: Doc<"sets">,
  after: ReturnType<typeof recordPoint>,
): Promise<PersonalRecord | null> {
  const { exerciseId, loggedAt, sessionId } = set;
  const before = recordPoint(set);
  const stats = await settledStats(ctx, userId, exerciseId);
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
        .filter((row) => row.userId === userId && row.exerciseId === exerciseId)
        .map((row) => recordPoint(row)),
    );
  }
  if (!(stats?.ready && !stats.drop && (await editInPlace(ctx, stats, exerciseName, set, after)))) {
    await requestRebuild(ctx, userId, exerciseId, loggedAt);
  }
  return personalRecord;
}

/**
 * Stats after sets were deleted. Sets that left the bests alone come off the
 * count in place. Anything else rebuilds that exercise's history, and so does
 * a large delete such as a long workout, since each set takes a few lookups.
 */
export async function recordRemovedSets(
  ctx: MutationCtx,
  userId: Id<"users">,
  removed: Array<Doc<"sets">>,
): Promise<void> {
  const inPlace = removed.length <= IN_PLACE_SETS;
  const byExercise = new Map<Id<"exercises">, Array<Doc<"sets">>>();
  for (const set of removed) {
    if (set.userId !== userId) {
      continue;
    }
    const list = byExercise.get(set.exerciseId) ?? [];
    list.push(set);
    byExercise.set(set.exerciseId, list);
  }
  for (const [exerciseId, sets] of byExercise) {
    const exercise = await ctx.db.get("exercises", exerciseId);
    const stats = await settledStats(ctx, userId, exerciseId);
    if (
      inPlace &&
      exercise?.userId === userId &&
      stats?.ready &&
      !stats.drop &&
      (await removeInPlace(ctx, stats, sets))
    ) {
      continue;
    }
    await requestRebuild(ctx, userId, exerciseId, Math.min(...sets.map((set) => set.loggedAt)));
  }
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

/**
 * Rebuilds an exercise's history after a change at `loggedAt`, or at an
 * unknown time when it is left out. A rebuild already running starts over
 * only when it has walked past that time.
 */
export async function requestRebuild(
  ctx: MutationCtx,
  userId: Id<"users">,
  exerciseId: Id<"exercises">,
  loggedAt?: number,
): Promise<void> {
  const exercise = await ctx.db.get("exercises", exerciseId);
  const stats = await settledStats(ctx, userId, exerciseId);
  const missing = !exercise || exercise.userId !== userId;
  if (missing) {
    if (!stats) {
      return;
    }
    await schedulePage(ctx, stats, {
      drop: true,
      ready: false,
      dirty: false,
      phase: "purge",
      cursor: null,
    });
    return;
  }
  if (!stats) {
    await ctx.db.insert("exerciseStats", { ...blankStats(userId, exerciseId, 1, Date.now()), step: 1 });
    await queuePage(ctx, { userId, exerciseId, generation: 1, cursor: null, step: 1 });
    return;
  }
  if (stats.ready) {
    await schedulePage(ctx, stats, {
      generation: stats.generation + 1,
      phase: "purge",
      cursor: null,
      ready: false,
      dirty: false,
      drop: false,
    });
    return;
  }
  if (!stats.dirty && !rebuildWillRead(stats, loggedAt)) {
    await ctx.db.patch("exerciseStats", stats._id, { dirty: true });
  }
}

/**
 * Whether a running rebuild will still read a change at this time. Pages
 * walk sets oldest first from a cursor, so a set written after the last one
 * walked is read by a later page. Nothing is walked before the walk phase.
 */
function rebuildWillRead(stats: Doc<"exerciseStats">, loggedAt: number | undefined): boolean {
  if (loggedAt === undefined || stats.drop) {
    return false;
  }
  if (stats.phase !== "walk" || stats.cursor === null) {
    return true;
  }
  return stats.walkedThrough !== undefined && loggedAt > stats.walkedThrough;
}

export async function runRebuildPage(
  ctx: MutationCtx,
  args: {
    userId: Id<"users">;
    exerciseId: Id<"exercises">;
    generation: number;
    cursor: string | null;
    step?: number;
  },
): Promise<void> {
  const stats = await settledStats(ctx, args.userId, args.exerciseId);
  // Every phase starts at a null cursor, so the step is what tells a page
  // apart from a duplicate or late copy. Running one twice would fold every
  // set in again.
  if (
    !stats ||
    stats.ready ||
    stats.generation !== args.generation ||
    (stats.cursor ?? null) !== (args.cursor ?? null) ||
    (stats.step ?? 0) !== (args.step ?? 0)
  ) {
    return;
  }
  const exercise = await ctx.db.get("exercises", args.exerciseId);
  if (exercise && exercise.userId !== args.userId) {
    return;
  }
  if (!exercise && !stats.drop) {
    await schedulePage(ctx, stats, {
      drop: true,
      ready: false,
      phase: "purge",
      cursor: null,
    });
    return;
  }
  if (stats.drop && stats.phase === "walk") {
    await schedulePage(ctx, stats, { phase: "purge", cursor: null });
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
      const existing = await settledStats(ctx, exercise.userId, exercise._id);
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

/**
 * Requeues rebuilds whose page has waited too long, oldest first, so rows that
 * keep failing move to the back instead of hiding the rest. The copy reuses
 * the row's step: if the first page was only slow, the later one does nothing.
 */
async function resumeStalled(ctx: MutationCtx, now: number): Promise<void> {
  const rows = await ctx.db
    .query("exerciseStats")
    .withIndex("by_ready_and_scheduled", (q) => q.eq("ready", false).lte("scheduledAt", now - STALL_MS))
    .take(STALLED_PAGE);
  for (const stats of rows) {
    await ctx.db.patch("exerciseStats", stats._id, { scheduledAt: now });
    await queuePage(ctx, {
      userId: stats.userId,
      exerciseId: stats.exerciseId,
      generation: stats.generation,
      cursor: stats.cursor,
      step: stats.step ?? 0,
    });
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
  await schedulePage(ctx, stats, { phase: "purgeCalories", cursor: null });
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
  await schedulePage(ctx, stats, {
    phase: "walk",
    cursor: null,
    setCount: 0,
    lastLoggedAt: null,
    ...storedBests(emptyBests()),
  });
}

async function walkSets(
  ctx: MutationCtx,
  stats: Doc<"exerciseStats">,
  cursor: string | null,
): Promise<void> {
  const exercise = await ctx.db.get("exercises", stats.exerciseId);
  if (!exercise || exercise.userId !== stats.userId) {
    await schedulePage(ctx, stats, { drop: true, phase: "purge", cursor: null });
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
    const folded = absorbSet(exercise.name, bests, before, judgedSet(set));
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
    await continuePage(ctx, stats, page.continueCursor, {
      ...patch,
      walkedThrough: page.page[page.page.length - 1]?.loggedAt ?? stats.walkedThrough,
    });
    return;
  }
  if (stats.dirty) {
    await schedulePage(ctx, stats, {
      ...storedBests(emptyBests()),
      generation: stats.generation + 1,
      phase: "purge",
      cursor: null,
      ready: false,
      dirty: false,
      drop: false,
      setCount: 0,
      lastLoggedAt: null,
    });
    return;
  }
  await ctx.db.patch("exerciseStats", stats._id, {
    ...patch,
    ready: true,
    dirty: false,
    cursor: null,
    phase: "walk",
    walkedThrough: undefined,
    recordRules: RECORD_RULES,
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
    const folded = absorbSet(exerciseName, current, before, judgedSet(set));
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
  // A row that reaches an append passed the check in settledStats, so its
  // comparison is current and stays current with this fold.
  await ctx.db.patch("exerciseStats", stats._id, {
    ...storedBests(current),
    setCount: stats.setCount + sets.length,
    lastLoggedAt,
    ready,
    phase: "walk",
    recordRules: RECORD_RULES,
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
    const folded = absorbSet(exerciseName, current, before, judgedSet(set));
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

/**
 * A past set that is no record at its own time, and adds no calories that
 * count, changes nothing a later set was judged against. It needs only its
 * empty stamps and the count. Anything else may change later stamps.
 */
async function insertInPlace(
  ctx: MutationCtx,
  stats: Doc<"exerciseStats">,
  exerciseName: string,
  sets: InsertedSet[],
): Promise<boolean> {
  if (sets.length > IN_PLACE_SETS || sets.some((set) => countableCalories(set) > 0)) {
    return false;
  }
  for (const set of sets) {
    // Marks at the set's own time are left out, so this best is never higher
    // than the one a rebuild compares with. At worst a set rebuilds needlessly.
    const bests = await bestsBefore(ctx, stats, set.loggedAt);
    if (movesBests(absorbPrimary(exerciseName, bests, judgedSet(set)))) {
      return false;
    }
  }
  let lastLoggedAt = stats.lastLoggedAt;
  for (const set of sets) {
    await writeStamps(ctx, set._id, undefined, []);
    if (lastLoggedAt === null || set.loggedAt > lastLoggedAt) {
      lastLoggedAt = set.loggedAt;
    }
  }
  await ctx.db.patch("exerciseStats", stats._id, {
    setCount: stats.setCount + sets.length,
    lastLoggedAt,
  });
  return true;
}

/**
 * An edit leaves history alone when only RPE changed, or when the old values
 * were no record and held no best, the calories that count are unchanged,
 * and the new values are no record at the set's own time. When nothing was
 * logged after the set, new values that are a record fold in the way an
 * append does.
 */
async function editInPlace(
  ctx: MutationCtx,
  stats: Doc<"exerciseStats">,
  exerciseName: string,
  set: Doc<"sets">,
  after: ReturnType<typeof recordPoint>,
): Promise<boolean> {
  if (set.recordStamps !== undefined && sameMeasures(recordPoint(set), after)) {
    await writeStamps(ctx, set._id, undefined, set.recordStamps);
    return true;
  }
  if (
    countableCalories(set) !== countableCalories(after) ||
    !(await leftBestsAlone(ctx, stats, set))
  ) {
    return false;
  }
  const fromHere = await ctx.db
    .query("sets")
    .withIndex("by_user_exercise_and_logged", (q) =>
      q.eq("userId", stats.userId).eq("exerciseId", stats.exerciseId).gte("loggedAt", set.loggedAt),
    )
    .take(2);
  const latest = fromHere.length === 1 && fromHere[0]?._id === set._id;
  // The old values moved no best, so for the latest set the stored bests are
  // the bests before it.
  const bests = latest ? bestsFromStored(stats) : await bestsBefore(ctx, stats, set.loggedAt);
  const folded = absorbPrimary(exerciseName, bests, {
    setId: set._id,
    sessionId: set.sessionId,
    loggedAt: set.loggedAt,
    reps: after.reps,
    weightLb: after.weightLb,
    durationSec: after.durationSec,
    distanceM: after.distanceM,
    calories: after.calories,
    setType: after.setType,
  });
  const moved = movesBests(folded);
  if (moved && !latest) {
    return false;
  }
  await writeStamps(ctx, set._id, undefined, folded.stamps);
  if (moved) {
    await writeMarks(ctx, stats, folded.marks);
    await ctx.db.patch("exerciseStats", stats._id, storedBests(folded.bests));
  }
  return true;
}

/**
 * Takes deleted sets off the count when they left the bests alone. Their
 * calories come off their session's total when that session was never the
 * calorie record, which a calorie stamp on one of its sets would show, and
 * is not the best or second best now. Lowering such a session cannot change
 * what a later session had to beat.
 */
async function removeInPlace(
  ctx: MutationCtx,
  stats: Doc<"exerciseStats">,
  sets: Array<Doc<"sets">>,
): Promise<boolean> {
  if (stats.setCount < sets.length) {
    return false;
  }
  for (const set of sets) {
    if (!(await leftBestsAlone(ctx, stats, set))) {
      return false;
    }
  }
  const removedCalories = new Map<Id<"sessions">, number>();
  for (const set of sets) {
    const calories = countableCalories(set);
    if (calories > 0) {
      removedCalories.set(set.sessionId, (removedCalories.get(set.sessionId) ?? 0) + calories);
    }
  }
  const totals: Array<{ row: Doc<"exerciseSessionCalories">; calories: number }> = [];
  for (const [sessionId, calories] of removedCalories) {
    if (
      stats.bestCalories?.sessionId === sessionId ||
      stats.secondCalories?.sessionId === sessionId
    ) {
      return false;
    }
    const rest = await ctx.db
      .query("sets")
      .withIndex("by_session_and_exercise", (q) =>
        q.eq("sessionId", sessionId).eq("exerciseId", stats.exerciseId),
      )
      .take(SESSION_SETS + 1);
    if (
      rest.length > SESSION_SETS ||
      rest.some(
        (row) =>
          row.recordStamps === undefined ||
          row.recordStamps.some((stamp) => stamp.kind === "calories"),
      )
    ) {
      return false;
    }
    const row = await sessionCaloriesRow(ctx, stats, sessionId);
    if (!row || row.calories < calories) {
      return false;
    }
    totals.push({ row, calories: row.calories - calories });
  }
  for (const { row, calories } of totals) {
    if (calories > 0) {
      await ctx.db.patch("exerciseSessionCalories", row._id, { calories });
    } else {
      await ctx.db.delete("exerciseSessionCalories", row._id);
    }
  }
  const previous = stats.lastLoggedAt;
  let lastLoggedAt = previous;
  if (previous === null || sets.some((set) => set.loggedAt >= previous)) {
    const newest = await ctx.db
      .query("sets")
      .withIndex("by_user_exercise_and_logged", (q) =>
        q.eq("userId", stats.userId).eq("exerciseId", stats.exerciseId),
      )
      .order("desc")
      .take(1);
    lastLoggedAt = newest[0]?.loggedAt ?? null;
  }
  await ctx.db.patch("exerciseStats", stats._id, {
    setCount: stats.setCount - sets.length,
    lastLoggedAt,
  });
  return true;
}

/**
 * Whether a set left the bests alone when it was judged: it has no record
 * stamp, and no stored best or mark names it. A mark without a stamp is a
 * timed distance set that set the time to beat. Calorie bests name sessions,
 * so callers check those.
 */
async function leftBestsAlone(
  ctx: MutationCtx,
  stats: Doc<"exerciseStats">,
  set: Doc<"sets">,
): Promise<boolean> {
  if (set.recordStamps === undefined || set.recordStamps.length > 0) {
    return false;
  }
  const held = [stats.bestWeight, stats.bestEpley, stats.bestReps, stats.bestDuration, stats.bestDistance];
  if (held.some((best) => best?.setId === set._id)) {
    return false;
  }
  for (const metric of METRICS) {
    const marks = await ctx.db
      .query("recordMarks")
      .withIndex("by_metric", (q) =>
        q
          .eq("userId", stats.userId)
          .eq("exerciseId", stats.exerciseId)
          .eq("generation", stats.generation)
          .eq("metric", metric)
          .eq("loggedAt", set.loggedAt),
      )
      .take(DUPLICATE_SCAN);
    if (marks.length === DUPLICATE_SCAN || marks.some((mark) => mark.setId === set._id)) {
      return false;
    }
  }
  return true;
}

function movesBests(folded: { stamps: RecordStamp[]; marks: MarkDraft[] }): boolean {
  return folded.stamps.length > 0 || folded.marks.length > 0;
}

function sameMeasures(
  left: ReturnType<typeof recordPoint>,
  right: ReturnType<typeof recordPoint>,
): boolean {
  return (
    left.reps === right.reps &&
    left.weightLb === right.weightLb &&
    left.durationSec === right.durationSec &&
    left.distanceM === right.distanceM &&
    left.calories === right.calories &&
    left.setType === right.setType
  );
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

async function sessionCaloriesRow(
  ctx: ReadCtx,
  stats: Doc<"exerciseStats">,
  sessionId: Id<"sessions">,
): Promise<Doc<"exerciseSessionCalories"> | null> {
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
  return row && row.userId === stats.userId ? row : null;
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
  patch: StatsPatch,
): Promise<void> {
  await schedulePage(ctx, stats, { ...patch, cursor });
}

/** Saves the row and queues its next page under a new step. */
async function schedulePage(
  ctx: MutationCtx,
  stats: Doc<"exerciseStats">,
  patch: StatsPatch & { cursor: string | null },
): Promise<void> {
  const step = (stats.step ?? 0) + 1;
  await ctx.db.patch("exerciseStats", stats._id, { ...patch, step, scheduledAt: Date.now() });
  await queuePage(ctx, {
    userId: stats.userId,
    exerciseId: stats.exerciseId,
    generation: patch.generation ?? stats.generation,
    cursor: patch.cursor,
    step,
  });
}

async function queuePage(
  ctx: MutationCtx,
  page: {
    userId: Id<"users">;
    exerciseId: Id<"exercises">;
    generation: number;
    cursor: string | null;
    step: number;
  },
): Promise<void> {
  await ctx.scheduler.runAfter(0, internal.exerciseStats.rebuildPage, page);
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
    step: 0,
    recordRules: RECORD_RULES,
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
