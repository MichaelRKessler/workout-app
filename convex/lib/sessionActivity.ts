import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

type SessionActivity = {
  _id: Id<"sessions">;
  setCount?: number;
  lastSetAt?: number;
};

/**
 * Newest set time on a workout. Stored on sessions saved after this shipped.
 * Older workouts still scan, and that scan is capped at the set limit.
 */
export async function newestLoggedAt(
  ctx: QueryCtx | MutationCtx,
  session: SessionActivity,
): Promise<number | null> {
  if (session.setCount !== undefined) {
    if (session.setCount <= 0) {
      return null;
    }
    if (session.lastSetAt !== undefined) {
      return session.lastSetAt;
    }
  }
  const sets = await ctx.db
    .query("sets")
    .withIndex("by_session_and_exercise", (q) => q.eq("sessionId", session._id))
    .take(500);
  let newest: number | null = null;
  for (const set of sets) {
    if (newest === null || set.loggedAt > newest) {
      newest = set.loggedAt;
    }
  }
  return newest;
}

/** Keeps the stored count in step with sets just inserted. No-op until backfill. */
export async function noteSetsAdded(
  ctx: MutationCtx,
  sessionId: Id<"sessions">,
  loggedAts: number[],
): Promise<void> {
  if (loggedAts.length === 0) {
    return;
  }
  const session = await ctx.db.get("sessions", sessionId);
  if (!session || session.userId === undefined || session.setCount === undefined) {
    return;
  }
  let last = session.lastSetAt ?? Number.NEGATIVE_INFINITY;
  for (const loggedAt of loggedAts) {
    if (loggedAt > last) {
      last = loggedAt;
    }
  }
  await ctx.db.patch("sessions", sessionId, {
    setCount: session.setCount + loggedAts.length,
    ...(Number.isFinite(last) ? { lastSetAt: last } : {}),
  });
}

/**
 * Drops removed sets from the stored count. If the newest set was removed,
 * the remaining sets are scanned once. The session cap is 500.
 */
export async function noteSetsRemoved(
  ctx: MutationCtx,
  sessionId: Id<"sessions">,
  loggedAts: number[],
): Promise<void> {
  if (loggedAts.length === 0) {
    return;
  }
  const session = await ctx.db.get("sessions", sessionId);
  if (!session || session.setCount === undefined) {
    return;
  }
  const removedNewest =
    session.lastSetAt !== undefined && loggedAts.some((loggedAt) => loggedAt >= session.lastSetAt!);
  if (!removedNewest) {
    await ctx.db.patch("sessions", sessionId, {
      setCount: Math.max(0, session.setCount - loggedAts.length),
    });
    return;
  }
  const sets = await ctx.db
    .query("sets")
    .withIndex("by_session_and_exercise", (q) => q.eq("sessionId", sessionId))
    .take(500);
  let last: number | null = null;
  for (const set of sets) {
    if (set.userId !== session.userId) {
      continue;
    }
    if (last === null || set.loggedAt > last) {
      last = set.loggedAt;
    }
  }
  await ctx.db.patch("sessions", sessionId, {
    setCount: sets.filter((set) => set.userId === session.userId).length,
    ...(last !== null ? { lastSetAt: last } : {}),
  });
}
