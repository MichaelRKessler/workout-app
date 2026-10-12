import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import {
  absorbSet,
  emptyBests,
  judgedSet,
  type BestSnap,
  type Bests,
  type CalorieSnap,
  type MarkDraft,
} from "./recordBests";
import type { RecordStamp } from "./records";

/** Sets read for one exercise. A longer history is reported as not checked. */
export const AUDIT_SETS = 4_000;
/** Record marks, and session calorie totals, read for one exercise. */
export const AUDIT_ROWS = 2_000;
const DUPLICATE_SCAN = 8;
const MAX_MISMATCHES = 50;
/** Exercises in one page of a user audit. */
const USER_PAGE = 10;
/** A user audit page stops after the exercise that reads past this many documents. */
const USER_READ_BUDGET = 4_000;

type AuditedSet = Pick<
  Doc<"sets">,
  | "_id"
  | "sessionId"
  | "loggedAt"
  | "reps"
  | "weightLb"
  | "durationSec"
  | "distanceM"
  | "calories"
  | "setType"
  | "recordStamps"
>;

export type StatsReplay = {
  bests: Bests;
  setCount: number;
  lastLoggedAt: number | null;
  /** Stamps for each set, in the order given. */
  stamps: RecordStamp[][];
  marks: MarkDraft[];
  sessionCalories: Map<string, number>;
};

export type ExerciseAudit = {
  exerciseId: Id<"exercises">;
  name: string | null;
  /** False when the row could not be compared: see `reason`. */
  checked: boolean;
  reason: string | null;
  statsRows: number;
  ready: boolean | null;
  dirty: boolean | null;
  drop: boolean | null;
  generation: number | null;
  step: number | null;
  phase: Doc<"exerciseStats">["phase"] | null;
  scheduledAt: number | null;
  setsRead: number;
  documentsRead: number;
  mismatches: string[];
};

export type UserAudit = {
  exercises: number;
  clean: number;
  /** Exercises with mismatches, or that could not be checked. */
  flagged: ExerciseAudit[];
  /** Pass back to read the next page. Null when every exercise was read. */
  continueCursor: string | null;
};

/**
 * What a rebuild stores for these sets: the fold walkSets runs page by page,
 * with session calorie totals kept here instead of in rows. Sets must be in
 * the order the rebuild walks them: by loggedAt, then by when they were saved.
 */
export function replayHistory(exerciseName: string, sets: AuditedSet[]): StatsReplay {
  let bests = emptyBests();
  const sessionCalories = new Map<string, number>();
  const marks: MarkDraft[] = [];
  const stamps: RecordStamp[][] = [];
  let lastLoggedAt: number | null = null;
  for (const set of sets) {
    const folded = absorbSet(exerciseName, bests, sessionCalories.get(set.sessionId) ?? 0, judgedSet(set));
    bests = folded.bests;
    sessionCalories.set(set.sessionId, folded.sessionCalories);
    marks.push(...folded.marks);
    stamps.push(folded.stamps);
    if (lastLoggedAt === null || set.loggedAt > lastLoggedAt) {
      lastLoggedAt = set.loggedAt;
    }
  }
  return { bests, setCount: sets.length, lastLoggedAt, stamps, marks, sessionCalories };
}

/**
 * Where a ready stats row, its marks, its session calorie totals, and its
 * sets' stamps differ from a replay of the sets. Sets must be in walk order.
 * Marks and totals may include other generations, which a finished rebuild
 * has purged.
 */
export function statsMismatches(stored: {
  exerciseName: string;
  row: Doc<"exerciseStats">;
  sets: AuditedSet[];
  marks: Array<Doc<"recordMarks">>;
  totals: Array<Doc<"exerciseSessionCalories">>;
}): string[] {
  const { row, sets } = stored;
  const replay = replayHistory(stored.exerciseName, sets);
  const problems: string[] = [];
  if (row.dirty || row.drop) {
    problems.push(`ready row is marked ${row.drop ? "drop" : "dirty"}`);
  }
  if (row.setCount !== replay.setCount) {
    problems.push(`setCount ${row.setCount}, expected ${replay.setCount}`);
  }
  if (row.lastLoggedAt !== replay.lastLoggedAt) {
    problems.push(`lastLoggedAt ${row.lastLoggedAt}, expected ${replay.lastLoggedAt}`);
  }
  sets.forEach((set, index) => {
    const saved = set.recordStamps === undefined ? "unjudged" : stampsKey(set.recordStamps);
    const expected = stampsKey(replay.stamps[index] ?? []);
    if (saved !== expected) {
      problems.push(`set ${set._id} (${describeSet(set)}): stamps ${saved}, expected ${expected}`);
    }
  });
  const compared: Array<[string, string | null, string | null]> = [
    ["bestWeight", snapKey(row.bestWeight), snapKey(replay.bests.weight)],
    ["bestEpley", snapKey(row.bestEpley), snapKey(replay.bests.epley)],
    ["bestReps", snapKey(row.bestReps), snapKey(replay.bests.reps)],
    ["bestDuration", snapKey(row.bestDuration), snapKey(replay.bests.duration)],
    ["bestDistance", snapKey(row.bestDistance), snapKey(replay.bests.distance)],
    ["bestCalories", calorieKey(row.bestCalories), calorieKey(replay.bests.calories)],
    ["secondCalories", calorieKey(row.secondCalories), calorieKey(replay.bests.secondCalories)],
  ];
  for (const [field, saved, expected] of compared) {
    if (saved !== expected) {
      problems.push(`${field} ${String(saved)}, expected ${String(expected)}`);
    }
  }

  const staleMarks = stored.marks.filter((mark) => mark.generation !== row.generation);
  if (staleMarks.length > 0) {
    problems.push(`${staleMarks.length} marks from another generation`);
  }
  const markKeys = stored.marks
    .filter((mark) => mark.generation === row.generation)
    .map((mark) => markKey(mark))
    .sort();
  const expectedMarks = replay.marks.map((mark) => markKey(mark)).sort();
  if (markKeys.join(" ") !== expectedMarks.join(" ")) {
    problems.push(`marks ${markKeys.join(" ")}, expected ${expectedMarks.join(" ")}`);
  }

  const staleTotals = stored.totals.filter((total) => total.generation !== row.generation);
  if (staleTotals.length > 0) {
    problems.push(`${staleTotals.length} session calorie totals from another generation`);
  }
  const current = stored.totals.filter((total) => total.generation === row.generation);
  // Writers read a session's total with unique(), which throws on a second row.
  const sessions = new Set(current.map((total) => total.sessionId));
  if (sessions.size !== current.length) {
    problems.push(`${current.length - sessions.size} extra session calorie totals`);
  }
  const totalKeys = current.map((total) => `${total.sessionId}:${total.calories}`).sort();
  const expectedTotals = [...replay.sessionCalories]
    .filter(([, calories]) => calories > 0)
    .map(([sessionId, calories]) => `${sessionId}:${calories}`)
    .sort();
  if (totalKeys.join(" ") !== expectedTotals.join(" ")) {
    problems.push(`session calories ${totalKeys.join(" ")}, expected ${expectedTotals.join(" ")}`);
  }
  return problems;
}

/**
 * Recomputes one exercise's stats from its sets and lists what the stored
 * rows get wrong. Reads at most `limits.sets` sets and `limits.rows` marks
 * and calorie totals; a longer history is reported as not checked. A row
 * that is still rebuilding is not compared.
 */
export async function auditExerciseStats(
  ctx: QueryCtx,
  userId: Id<"users">,
  exerciseId: Id<"exercises">,
  limits: { sets: number; rows: number } = { sets: AUDIT_SETS, rows: AUDIT_ROWS },
): Promise<ExerciseAudit> {
  const exercise = await ctx.db.get("exercises", exerciseId);
  const rows = await ctx.db
    .query("exerciseStats")
    .withIndex("by_user_and_exercise", (q) => q.eq("userId", userId).eq("exerciseId", exerciseId))
    .take(DUPLICATE_SCAN);
  const row = rows[0] ?? null;
  const result: ExerciseAudit = {
    exerciseId,
    name: exercise && exercise.userId === userId ? exercise.name : null,
    checked: false,
    reason: null,
    statsRows: rows.length,
    ready: row?.ready ?? null,
    dirty: row?.dirty ?? null,
    drop: row?.drop ?? null,
    generation: row?.generation ?? null,
    step: row?.step ?? null,
    phase: row?.phase ?? null,
    scheduledAt: row?.scheduledAt ?? null,
    setsRead: 0,
    documentsRead: 1 + rows.length,
    mismatches: [],
  };
  if (!exercise || exercise.userId !== userId) {
    return { ...result, reason: "exercise not found" };
  }
  if (rows.length > 1) {
    return {
      ...result,
      checked: true,
      mismatches: [`${rows.length} stats rows; readers ignore them until a write keeps one`],
    };
  }

  const sets = await ctx.db
    .query("sets")
    .withIndex("by_user_exercise_and_logged", (q) => q.eq("userId", userId).eq("exerciseId", exerciseId))
    .order("asc")
    .take(limits.sets + 1);
  result.setsRead = sets.length;
  result.documentsRead += sets.length;
  if (sets.length > limits.sets) {
    return { ...result, reason: "too many sets" };
  }
  if (!row) {
    return {
      ...result,
      checked: true,
      mismatches: sets.length > 0 ? [`no stats row for ${sets.length} sets`] : [],
    };
  }
  if (!row.ready) {
    return { ...result, reason: "rebuilding" };
  }

  const marks = await ctx.db
    .query("recordMarks")
    .withIndex("by_exercise", (q) => q.eq("exerciseId", exerciseId))
    .take(limits.rows + 1);
  const totals = await ctx.db
    .query("exerciseSessionCalories")
    .withIndex("by_exercise", (q) => q.eq("exerciseId", exerciseId))
    .take(limits.rows + 1);
  result.documentsRead += marks.length + totals.length;
  if (marks.length > limits.rows || totals.length > limits.rows) {
    return { ...result, reason: "too many marks" };
  }
  const mismatches = statsMismatches({
    exerciseName: exercise.name,
    row,
    sets,
    marks: marks.filter((mark) => mark.userId === userId),
    totals: totals.filter((total) => total.userId === userId),
  });
  if (mismatches.length > MAX_MISMATCHES) {
    const more = mismatches.length - MAX_MISMATCHES;
    mismatches.splice(MAX_MISMATCHES, more, `${more} more mismatches`);
  }
  return { ...result, checked: true, mismatches };
}

/**
 * One page of a user's exercises, by name. A page stops early once it has
 * read about 4,000 documents, so it stays well under a query's read limit.
 */
export async function auditUserStats(
  ctx: QueryCtx,
  userId: Id<"users">,
  cursor: string | null,
): Promise<UserAudit> {
  const exercises = await ctx.db
    .query("exercises")
    .withIndex("by_user_and_normalized_name", (q) => {
      const mine = q.eq("userId", userId);
      return cursor === null ? mine : mine.gt("normalizedName", cursor);
    })
    .take(USER_PAGE + 1);
  const flagged: ExerciseAudit[] = [];
  let read = 0;
  let audited = 0;
  let clean = 0;
  for (const exercise of exercises.slice(0, USER_PAGE)) {
    if (audited > 0 && read >= USER_READ_BUDGET) {
      break;
    }
    const result = await auditExerciseStats(ctx, userId, exercise._id);
    audited += 1;
    read += result.documentsRead;
    if (result.checked && result.mismatches.length === 0) {
      clean += 1;
    } else {
      flagged.push(result);
    }
  }
  const last = exercises[audited - 1];
  return {
    exercises: audited,
    clean,
    flagged,
    continueCursor: exercises.length > audited && last ? last.normalizedName : null,
  };
}

function describeSet(set: AuditedSet): string {
  return [
    `${set.weightLb}x${set.reps ?? "-"}`,
    set.durationSec !== undefined ? `${set.durationSec}s` : null,
    set.distanceM !== undefined ? `${set.distanceM}m` : null,
    set.calories !== undefined ? `${set.calories}kcal` : null,
    set.setType ?? null,
    `at ${set.loggedAt}`,
  ]
    .filter((part) => part !== null)
    .join(" ");
}

function stampsKey(stamps: RecordStamp[]): string {
  return JSON.stringify(
    stamps.map((stamp) => [
      stamp.kind,
      stamp.reps,
      stamp.weightLb,
      stamp.epleyLb,
      stamp.durationSec,
      stamp.distanceM,
      stamp.calories,
    ]),
  );
}

function snapKey(snap: BestSnap | null): string | null {
  if (!snap) {
    return null;
  }
  return JSON.stringify([
    snap.setId,
    snap.sessionId,
    snap.loggedAt,
    snap.reps,
    snap.weightLb,
    snap.epleyLb,
    snap.durationSec,
    snap.distanceM,
  ]);
}

function calorieKey(snap: CalorieSnap | null): string | null {
  return snap ? `${snap.sessionId}:${snap.calories}` : null;
}

/** The fields a rebuild reproduces, including a calorie mark's runner-up. */
function markKey(mark: {
  metric: string;
  setId: string;
  sessionId: string;
  loggedAt: number;
  reps: number | null;
  weightLb: number;
  durationSec: number | null;
  distanceM: number | null;
  calories: number | null;
  otherSessionId?: string | null;
  otherCalories?: number | null;
}): string {
  const runnerUp = mark.otherSessionId ? `${mark.otherSessionId}:${mark.otherCalories ?? 0}` : "";
  return [
    mark.metric,
    mark.setId,
    mark.sessionId,
    mark.loggedAt,
    mark.reps ?? "",
    mark.weightLb,
    mark.durationSec ?? "",
    mark.distanceM ?? "",
    mark.calories ?? "",
    runnerUp,
  ].join(":");
}
