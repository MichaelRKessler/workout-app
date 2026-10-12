import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { runBackfill, runRebuildPage } from "./lib/exerciseStats";

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
