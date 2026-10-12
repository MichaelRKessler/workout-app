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
  if ((from.pendingPlanScans ?? 0) > 0) {
    throw userError(`Workouts that used ${from.name} are still being updated. Try again when that finishes.`);
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

/**
 * A merge that stops before it finishes, such as when the person loses
 * access, leaves the source as a normal exercise so it can be merged again.
 */
export async function clearMergeMarker(
  ctx: MutationCtx,
  userId: Id<"users">,
  fromId: Id<"exercises">,
): Promise<void> {
  const from = await ctx.db.get("exercises", fromId);
  if (from && from.userId === userId && from.mergingInto !== undefined) {
    await ctx.db.patch("exercises", from._id, { mergingInto: undefined });
  }
}

/** Counts a finished-plan scan on the kept exercise until it ends. */
export async function adjustPlanScans(
  ctx: MutationCtx,
  exerciseId: Id<"exercises">,
  delta: 1 | -1,
): Promise<void> {
  const exercise = await ctx.db.get("exercises", exerciseId);
  if (!exercise) {
    return;
  }
  const next = Math.max(0, (exercise.pendingPlanScans ?? 0) + delta);
  await ctx.db.patch("exercises", exercise._id, {
    pendingPlanScans: next > 0 ? next : undefined,
  });
}
