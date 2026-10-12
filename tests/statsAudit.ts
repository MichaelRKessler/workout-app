import type { TestConvex } from "convex-test";
import type { GenericMutationCtx } from "convex/server";
import type { DataModel } from "../convex/_generated/dataModel";
import { auditExerciseStats } from "../convex/lib/statsAudit";
import type schema from "../convex/schema";

type Backend = TestConvex<typeof schema>;
type Ctx = GenericMutationCtx<DataModel>;

/** Tests read whole histories. The production check uses smaller limits. */
const NO_LIMIT = { sets: 1_000_000, rows: 1_000_000 };

/**
 * Recomputes every exercise's stats from its sets, the way a rebuild would,
 * and lists what the stored rows get wrong: stamps, bests, marks, session
 * calorie totals, rows that are still rebuilding or duplicated, rows left
 * behind by deleted exercises, and each workout's set count and newest set.
 * Run it once every scheduled function has finished.
 */
export async function audit(t: Backend): Promise<string[]> {
  return await t.run(async (ctx) => {
    const problems = await exerciseProblems(ctx, true);
    problems.push(...(await orphanProblems(ctx)));
    problems.push(...(await sessionProblems(ctx)));
    return problems;
  });
}

/**
 * What must hold between any two writes, with rebuilds still queued: at most
 * one stats row per exercise, every ready row right, and every workout's set
 * count and newest set right. Readers trust a ready row.
 */
export async function auditBetweenWrites(t: Backend): Promise<string[]> {
  return await t.run(async (ctx) => {
    const problems = await exerciseProblems(ctx, false);
    problems.push(...(await sessionProblems(ctx)));
    return problems;
  });
}

async function exerciseProblems(ctx: Ctx, settled: boolean): Promise<string[]> {
  const problems: string[] = [];
  const exercises = await ctx.db.query("exercises").collect();
  for (const exercise of exercises) {
    const result = await auditExerciseStats(ctx, exercise.userId, exercise._id, NO_LIMIT);
    if (!result.checked && (settled || result.reason !== "rebuilding")) {
      problems.push(`${exercise.name}: not checked, ${result.reason}`);
    }
    problems.push(...result.mismatches.map((mismatch) => `${exercise.name}: ${mismatch}`));
  }
  return problems;
}

/** Rows whose exercise is gone. A dropped exercise's rebuild deletes them. */
async function orphanProblems(ctx: Ctx): Promise<string[]> {
  const problems: string[] = [];
  const owners = new Map((await ctx.db.query("exercises").collect()).map((exercise) => [exercise._id, exercise.userId]));
  for (const row of await ctx.db.query("exerciseStats").collect()) {
    if (owners.get(row.exerciseId) !== row.userId) {
      problems.push(`stats row ${row._id} for missing exercise ${row.exerciseId}`);
    }
  }
  for (const mark of await ctx.db.query("recordMarks").collect()) {
    if (owners.get(mark.exerciseId) !== mark.userId) {
      problems.push(`mark ${mark._id} for missing exercise ${mark.exerciseId}`);
    }
  }
  for (const total of await ctx.db.query("exerciseSessionCalories").collect()) {
    if (owners.get(total.exerciseId) !== total.userId) {
      problems.push(`session calories ${total._id} for missing exercise ${total.exerciseId}`);
    }
  }
  return problems;
}

/** A workout's stored set count and newest set time, against its sets. */
async function sessionProblems(ctx: Ctx): Promise<string[]> {
  const problems: string[] = [];
  const sessions = await ctx.db.query("sessions").collect();
  const owners = new Map(sessions.map((session) => [session._id, session.userId]));
  for (const set of await ctx.db.query("sets").collect()) {
    if (owners.get(set.sessionId) !== set.userId) {
      problems.push(`set ${set._id} belongs to missing workout ${set.sessionId}`);
    }
  }
  for (const session of sessions) {
    if (session.setCount === undefined) {
      continue;
    }
    const sets = (
      await ctx.db
        .query("sets")
        .withIndex("by_session_and_exercise", (q) => q.eq("sessionId", session._id))
        .collect()
    ).filter((set) => set.userId === session.userId);
    if (session.setCount !== sets.length) {
      problems.push(`workout ${session._id}: setCount ${session.setCount}, expected ${sets.length}`);
    }
    // An empty workout has no lastSetAt.
    const newest = sets.length > 0 ? Math.max(...sets.map((set) => set.loggedAt)) : undefined;
    if (session.lastSetAt !== newest) {
      problems.push(`workout ${session._id}: lastSetAt ${session.lastSetAt}, expected ${newest}`);
    }
  }
  return problems;
}
