import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { assertDayWindow } from "./lib/dayWindow";
import { userError } from "./lib/errors";
import { exerciseNameKey } from "./lib/exerciseName";
import { authedQuery } from "./lib/customFunctions";

/** Days one call may check. The phone asks again for the rest. */
export const MAX_IMPORT_CHECK_DAYS = 40;
const SET_SCAN_PER_DAY = 400;
const BODY_SCAN_PER_DAY = 20;

const bodyValuesValidator = v.object({
  weightLb: v.union(v.number(), v.null()),
  bodyFatPct: v.union(v.number(), v.null()),
  waistCm: v.union(v.number(), v.null()),
  chestCm: v.union(v.number(), v.null()),
  armCm: v.union(v.number(), v.null()),
  hipsCm: v.union(v.number(), v.null()),
  thighCm: v.union(v.number(), v.null()),
});

/**
 * What is already logged on the days a file covers, so an import can skip it:
 * the exercises with sets that day (by spelling key) and that day's body entries.
 */
export const existingDays = authedQuery({
  args: {
    days: v.array(v.object({ key: v.string(), start: v.number(), end: v.number() })),
  },
  returns: v.array(
    v.object({
      key: v.string(),
      exerciseKeys: v.array(v.string()),
      body: v.array(bodyValuesValidator),
    }),
  ),
  handler: async (ctx, args) => {
    if (args.days.length > MAX_IMPORT_CHECK_DAYS) {
      throw userError(`Check up to ${MAX_IMPORT_CHECK_DAYS} days at a time`);
    }
    const names = new Map<Id<"exercises">, string | null>();
    const result = [];
    for (const day of args.days) {
      assertDayWindow(day.start, day.end);
      const sets = await ctx.db
        .query("sets")
        .withIndex("by_user_and_logged", (q) =>
          q.eq("userId", ctx.userId).gte("loggedAt", day.start).lt("loggedAt", day.end),
        )
        .take(SET_SCAN_PER_DAY);
      const exerciseKeys = new Set<string>();
      for (const set of sets) {
        if (!names.has(set.exerciseId)) {
          const exercise = await ctx.db.get("exercises", set.exerciseId);
          names.set(
            set.exerciseId,
            exercise && exercise.userId === ctx.userId ? exerciseNameKey(exercise.name) : null,
          );
        }
        const key = names.get(set.exerciseId);
        if (key) {
          exerciseKeys.add(key);
        }
      }
      const entries = await ctx.db
        .query("bodyEntries")
        .withIndex("by_user_and_logged", (q) =>
          q.eq("userId", ctx.userId).gte("loggedAt", day.start).lt("loggedAt", day.end),
        )
        .take(BODY_SCAN_PER_DAY);
      result.push({
        key: day.key,
        exerciseKeys: [...exerciseKeys],
        body: entries.map((entry) => ({
          weightLb: entry.weightLb ?? null,
          bodyFatPct: entry.bodyFatPct ?? null,
          waistCm: entry.waistCm ?? null,
          chestCm: entry.chestCm ?? null,
          armCm: entry.armCm ?? null,
          hipsCm: entry.hipsCm ?? null,
          thighCm: entry.thighCm ?? null,
        })),
      });
    }
    return result;
  },
});
