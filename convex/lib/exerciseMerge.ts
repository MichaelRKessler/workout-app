import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { invalidateExercises } from "./exerciseStats";
import { userError } from "./errors";
import { muscleGroupToCopy } from "./muscleGroup";
import { repointExerciseReferences } from "./routineRecords";

/** Sets moved in one transaction. A larger history continues in a later run. */
export const MERGE_BATCH = 40;

export type MergeBatchResult = {
  moved: number;
  done: boolean;
  name: string;
};

/**
 * Moves one batch of sets onto the kept exercise and repoints the workouts
 * those sets belong to. When nothing is left, copies rest and muscle group,
 * then deletes the merged exercise. Safe to run again: sets already moved
 * are no longer on the source, and a missing source means the merge finished.
 */
export async function applyMergeBatch(
  ctx: MutationCtx,
  userId: Id<"users">,
  fromId: Id<"exercises">,
  intoId: Id<"exercises">,
): Promise<MergeBatchResult> {
  if (fromId === intoId) {
    throw userError("Choose two different exercises");
  }
  const from = await ctx.db.get("exercises", fromId);
  const into = await ctx.db.get("exercises", intoId);
  // A missing source means this merge already finished. A source that belongs
  // to someone else is not ours to move.
  if (!from) {
    if (into && into.userId === userId) {
      return { moved: 0, done: true, name: into.name };
    }
    return { moved: 0, done: true, name: "" };
  }
  if (from.userId !== userId) {
    throw userError("Exercise not found");
  }
  if (!into || into.userId !== userId) {
    throw userError("Exercise not found");
  }

  const page = await ctx.db
    .query("sets")
    .withIndex("by_user_exercise_and_logged", (q) =>
      q.eq("userId", userId).eq("exerciseId", from._id),
    )
    .take(MERGE_BATCH);

  const sessionIds: Array<Id<"sessions">> = [];
  for (const set of page) {
    if (set.userId !== userId || set.exerciseId !== from._id) {
      throw userError("Exercise not found");
    }
    sessionIds.push(set.sessionId);
    await ctx.db.patch("sets", set._id, { exerciseId: into._id });
  }
  await repointExerciseReferences(ctx, userId, from._id, into._id, sessionIds);

  const remaining = await ctx.db
    .query("sets")
    .withIndex("by_user_exercise_and_logged", (q) =>
      q.eq("userId", userId).eq("exerciseId", from._id),
    )
    .take(1);
  if (remaining.length > 0) {
    await invalidateExercises(ctx, userId, [from._id, into._id]);
    return { moved: page.length, done: false, name: into.name };
  }

  if (into.restSeconds === undefined && from.restSeconds !== undefined) {
    await ctx.db.patch("exercises", into._id, { restSeconds: from.restSeconds });
  }
  const copiedMuscle = muscleGroupToCopy(into, from);
  if (copiedMuscle) {
    await ctx.db.patch("exercises", into._id, { muscleGroup: copiedMuscle });
  }
  await ctx.db.delete("exercises", from._id);
  await invalidateExercises(ctx, userId, [from._id, into._id]);
  return { moved: page.length, done: true, name: into.name };
}
