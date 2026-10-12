import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { stampsOrScan } from "./exerciseStats";
import { achievedRecord, caloriesRecord, listRecords, type PersonalRecord, type RecordStamp } from "./records";
import type { SetType } from "./setType";
import { EXERCISE_RECORD_SCAN, recordPoint } from "./workouts";

type PerformedSet = {
  _id: Id<"sets">;
  exerciseId: Id<"exercises">;
  exerciseName: string;
  sessionId: string;
  reps: number | null;
  weightLb: number;
  durationSec: number | null;
  distanceM: number | null;
  calories: number | null;
  setType: SetType;
  loggedAt: number;
  recordStamps?: RecordStamp[];
};

/**
 * Records set by these sets, judged against earlier performances of the same
 * exercise. Later workouts are ignored, so a day keeps the records it earned
 * even after they are beaten. One line per exercise.
 */
export async function loadAchievedRecords(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  sets: PerformedSet[],
): Promise<PersonalRecord[]> {
  const ordered = [...sets].sort(
    (left, right) => left.loggedAt - right.loggedAt || left._id.localeCompare(right._id),
  );
  const byExercise = new Map<Id<"exercises">, PerformedSet[]>();
  const exerciseOrder: Array<Id<"exercises">> = [];
  for (const set of ordered) {
    const group = byExercise.get(set.exerciseId);
    if (group) {
      group.push(set);
    } else {
      byExercise.set(set.exerciseId, [set]);
      exerciseOrder.push(set.exerciseId);
    }
  }

  const grouped = await Promise.all(
    exerciseOrder.map(async (exerciseId) => {
      const created = byExercise.get(exerciseId);
      const first = created?.[0];
      if (!created || !first) {
        return [];
      }
      const createdPoints = created.map((set) =>
        recordPoint({ ...set, sessionId: set.sessionId }),
      );
      return await stampsOrScan(ctx, userId, exerciseId, first.exerciseName, created, async () => {
        const earlier = await ctx.db
          .query("sets")
          .withIndex("by_user_exercise_and_logged", (q) =>
            q.eq("userId", userId).eq("exerciseId", exerciseId).lt("loggedAt", first.loggedAt),
          )
          .order("desc")
          .take(EXERCISE_RECORD_SCAN);
        const previous: Array<ReturnType<typeof recordPoint>> = [];
        for (const set of earlier) {
          if (set.userId !== userId || set.exerciseId !== exerciseId) {
            continue;
          }
          previous.push(recordPoint(set));
        }
        return listRecords(
          achievedRecord(first.exerciseName, createdPoints, previous),
          caloriesRecord(first.exerciseName, createdPoints, previous),
        );
      });
    }),
  );
  return grouped.flat();
}
