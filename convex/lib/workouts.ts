import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { formatExerciseName } from "./exerciseName";

const MAX_SETS_PER_SESSION = 500;

/** One confirmed voice list, and one Undo of that list. */
export const MAX_SETS_PER_BATCH = 30;

export async function getOwnedSession(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  sessionId: Id<"sessions">,
) {
  const session = await ctx.db.get("sessions", sessionId);
  if (!session || session.userId !== userId) {
    return null;
  }
  return session;
}

export async function getOrCreateExercise(
  ctx: MutationCtx,
  userId: Id<"users">,
  rawName: string,
): Promise<Id<"exercises">> {
  const formatted = formatExerciseName(rawName);
  if (!formatted) {
    throw new Error("Exercise name must be 1 to 80 characters");
  }

  const existing = await ctx.db
    .query("exercises")
    .withIndex("by_user_and_normalized_name", (q) =>
      q.eq("userId", userId).eq("normalizedName", formatted.normalizedName),
    )
    .unique();

  if (existing) {
    return existing._id;
  }

  return await ctx.db.insert("exercises", {
    userId,
    name: formatted.name,
    normalizedName: formatted.normalizedName,
    createdAt: Date.now(),
  });
}

export function assertReps(reps: number): number {
  if (!Number.isInteger(reps) || reps < 1 || reps > 999) {
    throw new Error("Reps must be a whole number from 1 to 999");
  }
  return reps;
}

export function assertWeightLb(weightLb: number): number {
  if (!Number.isFinite(weightLb) || weightLb < 0 || weightLb > 2000) {
    throw new Error("Weight must be between 0 and 2000 lb");
  }
  return Math.round(weightLb * 100) / 100;
}

export async function requireOpenSession(
  ctx: MutationCtx,
  userId: Id<"users">,
  sessionId: Id<"sessions">,
) {
  const session = await getOwnedSession(ctx, userId, sessionId);
  if (!session) {
    throw new Error("Workout not found");
  }
  if (session.status !== "open") {
    throw new Error("This workout is already finished");
  }
  return session;
}

export async function assertSessionCanAcceptSets(
  ctx: MutationCtx,
  sessionId: Id<"sessions">,
  adding: number,
): Promise<void> {
  if (adding < 1) {
    throw new Error("Add at least one set");
  }
  const existing = await ctx.db
    .query("sets")
    .withIndex("by_session_and_exercise", (q) => q.eq("sessionId", sessionId))
    .take(MAX_SETS_PER_SESSION);
  if (existing.length + adding > MAX_SETS_PER_SESSION) {
    throw new Error("This workout already has 500 sets");
  }
}
