import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { runBackfill, runRebuildPage } from "./lib/exerciseStats";
import { auditExerciseStats, auditUserStats } from "./lib/statsAudit";

/**
 * One page of an exercise rebuild. Scheduled from a mutation that already
 * checked the owner, or from the backfill cron. There is no signed-in caller.
 * Every write is limited to the user id stored on that exercise.
 */
export const rebuildPage = internalMutation({
  args: {
    userId: v.id("users"),
    exerciseId: v.id("exercises"),
    generation: v.number(),
    cursor: v.union(v.string(), v.null()),
    // Optional so pages queued before steps existed still validate.
    step: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await runRebuildPage(ctx, args);
    return null;
  },
});

/**
 * Fills stats for exercises and set counts for workouts saved before those
 * fields existed. Idempotent: a ready exercise is left alone, and a session
 * that already has a count is left alone. The cron starts it; each tick
 * schedules the next page so a deploy does not need a manual backfill.
 */
export const backfillTick = internalMutation({
  args: { followUp: v.optional(v.boolean()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    await runBackfill(ctx, args.followUp === true);
    return null;
  },
});

const exerciseAudit = v.object({
  exerciseId: v.id("exercises"),
  name: v.union(v.string(), v.null()),
  checked: v.boolean(),
  reason: v.union(v.string(), v.null()),
  statsRows: v.number(),
  ready: v.union(v.boolean(), v.null()),
  dirty: v.union(v.boolean(), v.null()),
  drop: v.union(v.boolean(), v.null()),
  generation: v.union(v.number(), v.null()),
  step: v.union(v.number(), v.null()),
  phase: v.union(v.literal("purge"), v.literal("purgeCalories"), v.literal("walk"), v.null()),
  scheduledAt: v.union(v.number(), v.null()),
  setsRead: v.number(),
  documentsRead: v.number(),
  mismatches: v.array(v.string()),
});

/**
 * Read-only check of one exercise's stats against its sets, for the
 * dashboard or `npx convex run`. Internal: it takes any user id.
 */
export const auditExercise = internalQuery({
  args: { userId: v.id("users"), exerciseId: v.id("exercises") },
  returns: exerciseAudit,
  handler: async (ctx, args) => {
    return await auditExerciseStats(ctx, args.userId, args.exerciseId);
  },
});

/** One page of `auditExercise` over a user's exercises. Start with a null cursor. */
export const auditUser = internalQuery({
  args: { userId: v.id("users"), cursor: v.union(v.string(), v.null()) },
  returns: v.object({
    exercises: v.number(),
    clean: v.number(),
    flagged: v.array(exerciseAudit),
    continueCursor: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) => {
    return await auditUserStats(ctx, args.userId, args.cursor);
  },
});
