import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { exerciseRecord } from "./exerciseFields";
import { userError } from "./errors";

export const DEFAULT_REST_SECONDS = 90;
export const MIN_REST_SECONDS = 15;
export const MAX_REST_SECONDS = 300;
/** One step everywhere rest is set: the rest bar, Settings and routines. */
export const REST_STEP_SECONDS = 30;

export function clampRestSeconds(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_REST_SECONDS;
  }
  const rounded = Math.round(value);
  if (rounded < MIN_REST_SECONDS) {
    return MIN_REST_SECONDS;
  }
  if (rounded > MAX_REST_SECONDS) {
    return MAX_REST_SECONDS;
  }
  return rounded;
}

/** Writes the account rest for one exercise. Null clears it back to the device default. */
export async function setExerciseRest(
  ctx: MutationCtx,
  userId: Id<"users">,
  exercise: Doc<"exercises">,
  restSeconds: number | null,
): Promise<void> {
  if (exercise.userId !== userId) {
    throw userError("Exercise not found");
  }
  const stored = restSeconds === null ? undefined : clampRestSeconds(restSeconds);
  if ((exercise.restSeconds ?? undefined) === stored) {
    return;
  }
  await ctx.db.replace(
    "exercises",
    exercise._id,
    exerciseRecord(exercise, { restSeconds: restSeconds === null ? null : stored }),
  );
}
