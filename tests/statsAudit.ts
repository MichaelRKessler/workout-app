import type { TestConvex } from "convex-test";
import { absorbSet, emptyBests, type MarkDraft } from "../convex/lib/recordBests";
import type { RecordStamp } from "../convex/lib/records";
import { resolvedSetType } from "../convex/lib/setType";
import type schema from "../convex/schema";

type Backend = TestConvex<typeof schema>;

/**
 * Recomputes every exercise's stats from its sets, the way a rebuild would,
 * and lists what the stored rows get wrong: stamps, bests, marks, and
 * session calorie totals.
 */
export async function audit(t: Backend): Promise<string[]> {
  return await t.run(async (ctx) => {
    const problems: string[] = [];
    const rows = await ctx.db.query("exerciseStats").collect();
    const exercises = await ctx.db.query("exercises").collect();
    for (const exercise of exercises) {
      const owned = rows.filter((row) => row.exerciseId === exercise._id);
      if (owned.length > 1) {
        problems.push(`${exercise.name}: ${owned.length} stats rows`);
      }
      const stats = owned[0];
      if (!stats || !exercise.userId) {
        continue;
      }
      if (!stats.ready) {
        problems.push(`${exercise.name}: not ready`);
        continue;
      }
      const userId = exercise.userId;
      const sets = await ctx.db
        .query("sets")
        .withIndex("by_user_exercise_and_logged", (q) => q.eq("userId", userId).eq("exerciseId", exercise._id))
        .order("asc")
        .collect();
      if (stats.setCount !== sets.length) {
        problems.push(`${exercise.name}: setCount ${stats.setCount}, expected ${sets.length}`);
      }
      const last = sets.length > 0 ? Math.max(...sets.map((set) => set.loggedAt)) : null;
      if (stats.lastLoggedAt !== last) {
        problems.push(`${exercise.name}: lastLoggedAt ${stats.lastLoggedAt}, expected ${last}`);
      }
      let bests = emptyBests();
      const sessionCalories = new Map<string, number>();
      const marks: MarkDraft[] = [];
      for (const set of sets) {
        const folded = absorbSet(exercise.name, bests, sessionCalories.get(set.sessionId) ?? 0, {
          setId: set._id,
          sessionId: set.sessionId,
          loggedAt: set.loggedAt,
          reps: set.reps ?? null,
          weightLb: set.weightLb,
          durationSec: set.durationSec ?? null,
          distanceM: set.distanceM ?? null,
          calories: set.calories ?? null,
          setType: resolvedSetType(set.setType),
        });
        bests = folded.bests;
        sessionCalories.set(set.sessionId, folded.sessionCalories);
        marks.push(...folded.marks);
        const stored = set.recordStamps === undefined ? "unjudged" : stampsKey(set.recordStamps);
        const expected = stampsKey(folded.stamps);
        if (stored !== expected) {
          problems.push(`${exercise.name} set ${describe(set)}: stamps ${stored}, expected ${expected}`);
        }
      }
      const compared: Array<[string, unknown, unknown]> = [
        ["bestWeight", stats.bestWeight?.setId ?? null, bests.weight?.setId ?? null],
        ["bestEpley", stats.bestEpley?.setId ?? null, bests.epley?.setId ?? null],
        ["bestReps", stats.bestReps?.setId ?? null, bests.reps?.setId ?? null],
        ["bestDuration", stats.bestDuration?.setId ?? null, bests.duration?.setId ?? null],
        ["bestDistance", stats.bestDistance?.setId ?? null, bests.distance?.setId ?? null],
        ["bestCalories", calorieKey(stats.bestCalories), calorieKey(bests.calories)],
        ["secondCalories", calorieKey(stats.secondCalories), calorieKey(bests.secondCalories)],
      ];
      for (const [field, stored, expected] of compared) {
        if (stored !== expected) {
          problems.push(`${exercise.name}: ${field} ${String(stored)}, expected ${String(expected)}`);
        }
      }
      const storedMarks = await ctx.db
        .query("recordMarks")
        .withIndex("by_exercise", (q) => q.eq("exerciseId", exercise._id))
        .collect();
      const staleMarks = storedMarks.filter((mark) => mark.generation !== stats.generation);
      if (staleMarks.length > 0) {
        problems.push(`${exercise.name}: ${staleMarks.length} marks from another generation`);
      }
      const markKeys = storedMarks
        .filter((mark) => mark.generation === stats.generation)
        .map((mark) => markKey(mark))
        .sort();
      const expectedMarks = marks.map((mark) => markKey(mark)).sort();
      if (JSON.stringify(markKeys) !== JSON.stringify(expectedMarks)) {
        problems.push(`${exercise.name}: marks ${markKeys.join(" ")}, expected ${expectedMarks.join(" ")}`);
      }
      const totals = await ctx.db
        .query("exerciseSessionCalories")
        .withIndex("by_exercise", (q) => q.eq("exerciseId", exercise._id))
        .collect();
      const storedTotals = totals
        .filter((row) => row.generation === stats.generation)
        .map((row) => `${row.sessionId}:${row.calories}`)
        .sort();
      const expectedTotals = [...sessionCalories]
        .filter(([, calories]) => calories > 0)
        .map(([sessionId, calories]) => `${sessionId}:${calories}`)
        .sort();
      if (JSON.stringify(storedTotals) !== JSON.stringify(expectedTotals)) {
        problems.push(`${exercise.name}: session calories ${storedTotals.join(" ")}, expected ${expectedTotals.join(" ")}`);
      }
    }
    return problems;
  });
}

function describe(set: {
  reps?: number;
  weightLb: number;
  durationSec?: number;
  distanceM?: number;
  calories?: number;
  setType?: string;
}): string {
  return [
    `${set.weightLb}x${set.reps ?? "-"}`,
    set.durationSec !== undefined ? `${set.durationSec}s` : null,
    set.distanceM !== undefined ? `${set.distanceM}m` : null,
    set.calories !== undefined ? `${set.calories}kcal` : null,
    set.setType ?? null,
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

function calorieKey(snap: { sessionId: string; calories: number } | null): string | null {
  return snap ? `${snap.sessionId}:${snap.calories}` : null;
}

/** The fields a rebuild must reproduce. A calorie mark's runner-up is left out. */
function markKey(mark: { metric: string; setId: string; calories: number | null }): string {
  return `${mark.metric}:${mark.setId}:${mark.calories ?? ""}`;
}
