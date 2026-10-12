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
  if (into.mergingInto !== undefined) {
    throw userError(`${into.name} is still being merged. Try again when it finishes.`);
  }
  if (from.mergingInto !== undefined && from.mergingInto !== into._id) {
    throw userError(`${from.name} is still being merged. Try again when it finishes.`);
  }
  if (await isMergeTarget(ctx, from._id)) {
    throw userError(`Sets are still moving onto ${from.name}. Try again when that finishes.`);
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
    if (from.mergingInto !== into._id) {
      await ctx.db.patch("exercises", from._id, { mergingInto: into._id });
    }
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

async function isMergeTarget(ctx: MutationCtx, exerciseId: Id<"exercises">): Promise<boolean> {
  const source = await ctx.db
    .query("exercises")
    .withIndex("by_merging_into", (q) => q.eq("mergingInto", exerciseId))
    .first();
  return source !== null;
}

/**
 * A running merge whose kept exercise is gone can't finish. Leave the sets
 * that haven't moved on the source and clear its merge state, so the library
 * shows it as a normal exercise again and it can be merged once more.
 */
export async function stopMergeIfTargetGone(
  ctx: MutationCtx,
  userId: Id<"users">,
  fromId: Id<"exercises">,
  intoId: Id<"exercises">,
): Promise<boolean> {
  const into = await ctx.db.get("exercises", intoId);
  if (into && into.userId === userId) {
    return false;
  }
  const from = await ctx.db.get("exercises", fromId);
  if (from && from.userId === userId) {
    if (from.mergingInto !== undefined) {
      await ctx.db.patch("exercises", from._id, { mergingInto: undefined });
    }
    await invalidateExercises(ctx, userId, [from._id]);
  }
  return true;
}
