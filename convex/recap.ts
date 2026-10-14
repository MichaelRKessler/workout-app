import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { authedQuery } from "./lib/customFunctions";
import { buildRecap, recapValidator, type RecapSet } from "./lib/recap";
import { resolvedSetType } from "./lib/setType";
import { getOwnedSession } from "./lib/workouts";

// One person's whole history fits well inside a query's read limits for years
// of training. Past this, lifetime totals and badges are skipped rather than
// judged on part of the history.
const SET_SCAN = 12_000;
const SESSION_SCAN = 3_000;

export const forSession = authedQuery({
  args: {
    sessionId: v.string(),
    utcOffsetMinutes: v.number(),
  },
  returns: v.union(
    v.object({
      recap: recapValidator,
      exerciseNames: v.record(v.string(), v.string()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const sessionId = ctx.db.normalizeId("sessions", args.sessionId);
    if (sessionId === null) {
      return null;
    }
    const session = await getOwnedSession(ctx, ctx.userId, sessionId);
    if (!session || session.status !== "completed") {
      return null;
    }
    const offset = Number.isFinite(args.utcOffsetMinutes)
      ? Math.max(-14 * 60, Math.min(14 * 60, Math.round(args.utcOffsetMinutes)))
      : 0;

    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_user_status_and_started", (q) =>
        q.eq("userId", ctx.userId).eq("status", "completed").lte("startedAt", session.startedAt),
      )
      .order("desc")
      .take(SESSION_SCAN);
    const sessionIds = new Set<string>(sessions.map((item) => item._id));

    const rows = await ctx.db
      .query("sets")
      .withIndex("by_user_and_logged", (q) => q.eq("userId", ctx.userId))
      .order("desc")
      .take(SET_SCAN);
    const sets: RecapSet[] = [];
    for (const row of rows) {
      if (row.userId !== ctx.userId || !sessionIds.has(row.sessionId)) {
        continue;
      }
      sets.push({
        sessionId: row.sessionId,
        exerciseId: row.exerciseId,
        reps: row.reps ?? null,
        weightLb: row.weightLb,
        durationSec: row.durationSec ?? null,
        distanceM: row.distanceM ?? null,
        setType: resolvedSetType(row.setType),
        loggedAt: row.loggedAt,
      });
    }

    const recap = buildRecap({
      sessionId: session._id,
      sessions: sessions.map((item) => ({ _id: item._id, startedAt: item.startedAt })),
      sets,
      utcOffsetMinutes: offset,
      complete: rows.length < SET_SCAN && sessions.length < SESSION_SCAN,
    });
    if (!recap) {
      return null;
    }

    const wanted = new Set<string>();
    for (const item of recap.celebrations) {
      if ("exerciseId" in item) wanted.add(item.exerciseId);
    }
    for (const item of recap.highlights) {
      if ("exerciseId" in item) wanted.add(item.exerciseId);
      if (item.kind === "badgeProgress") {
        const exerciseId = item.badgeId.split(":")[1];
        if (exerciseId) wanted.add(exerciseId);
      }
    }
    for (const badge of recap.badges) {
      if (badge.exerciseId) wanted.add(badge.exerciseId);
    }
    const exerciseNames: Record<string, string> = {};
    await Promise.all(
      [...wanted].map(async (id) => {
        const exercise = await ctx.db.get("exercises", id as Id<"exercises">);
        if (exercise && exercise.userId === ctx.userId) {
          exerciseNames[id] = exercise.name;
        }
      }),
    );
    return { recap, exerciseNames };
  },
});
