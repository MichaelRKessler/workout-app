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
  // An emptied workout saved by earlier code can still hold a removed set's time.
  let last = session.setCount > 0 ? (session.lastSetAt ?? Number.NEGATIVE_INFINITY) : Number.NEGATIVE_INFINITY;
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
 * the remaining sets are scanned once. The session cap is 500. Sets in
 * `uncounted` were inserted in this mutation and are counted after it by
 * noteSetsAdded, so the scan leaves them out.
 */
export async function noteSetsRemoved(
  ctx: MutationCtx,
  sessionId: Id<"sessions">,
  loggedAts: number[],
  uncounted: ReadonlySet<Id<"sets">> = new Set(),
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
  const counted = sets.filter((set) => set.userId === session.userId && !uncounted.has(set._id));
  let last: number | null = null;
  for (const set of counted) {
    if (last === null || set.loggedAt > last) {
      last = set.loggedAt;
    }
  }
  await ctx.db.patch("sessions", sessionId, {
    setCount: counted.length,
    // An empty workout has no newest set, so the next set is not placed after a removed one.
    lastSetAt: last ?? undefined,
  });
}
