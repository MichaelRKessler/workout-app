import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import {
  BODY_TREND_SCAN,
  insertBodyEntry,
  presentBodyEntry,
  removeBodyEntry,
  updateBodyEntry,
} from "./lib/bodyEntries";
import { authedMutation, authedQuery } from "./lib/customFunctions";

const measureArgs = {
  weightLb: v.optional(v.number()),
  bodyFatPct: v.optional(v.number()),
  waistCm: v.optional(v.number()),
  chestCm: v.optional(v.number()),
  armCm: v.optional(v.number()),
  hipsCm: v.optional(v.number()),
  thighCm: v.optional(v.number()),
  note: v.optional(v.string()),
};

const entryValidator = v.object({
  _id: v.id("bodyEntries"),
  loggedAt: v.number(),
  weightLb: v.union(v.number(), v.null()),
  bodyFatPct: v.union(v.number(), v.null()),
  waistCm: v.union(v.number(), v.null()),
  chestCm: v.union(v.number(), v.null()),
  armCm: v.union(v.number(), v.null()),
  hipsCm: v.union(v.number(), v.null()),
  thighCm: v.union(v.number(), v.null()),
  note: v.union(v.string(), v.null()),
  clientId: v.union(v.string(), v.null()),
});

/** Latest entry, plus the recent weigh-ins for the trend line. */
export const summary = authedQuery({
  args: {},
  returns: v.object({
    latest: v.union(entryValidator, v.null()),
    weightTrend: v.array(
      v.object({
        entryId: v.id("bodyEntries"),
        loggedAt: v.number(),
        weightLb: v.number(),
      }),
    ),
    trendTruncated: v.boolean(),
  }),
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("bodyEntries")
      .withIndex("by_user_and_logged", (q) => q.eq("userId", ctx.userId))
      .order("desc")
      .take(BODY_TREND_SCAN + 1);
    const truncated = rows.length > BODY_TREND_SCAN;
    const page = truncated ? rows.slice(0, BODY_TREND_SCAN) : rows;
    const owned = page.filter((entry) => entry.userId === ctx.userId);
    const latest = owned[0];
    const weightTrend = owned
      .filter((entry): entry is typeof entry & { weightLb: number } => entry.weightLb !== undefined)
      .map((entry) => ({
        entryId: entry._id,
        loggedAt: entry.loggedAt,
        weightLb: entry.weightLb,
      }))
      .reverse();
    return {
      latest: latest ? presentBodyEntry(latest) : null,
      weightTrend,
      trendTruncated: truncated,
    };
  },
});

/** Newest entries first. */
export const list = authedQuery({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(entryValidator),
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("bodyEntries")
      .withIndex("by_user_and_logged", (q) => q.eq("userId", ctx.userId))
      .order("desc")
      .paginate(args.paginationOpts);
    return {
      ...result,
      page: result.page
        .filter((entry) => entry.userId === ctx.userId)
        .map((entry) => presentBodyEntry(entry)),
    };
  },
});

/** Saves a weigh-in or measurement. A repeated client id does not create a second row. */
export const save = authedMutation({
  args: {
    loggedAt: v.number(),
    clientId: v.optional(v.string()),
    ...measureArgs,
  },
  returns: v.id("bodyEntries"),
  handler: async (ctx, args) => {
    return await insertBodyEntry(ctx, ctx.userId, args);
  },
});

export const update = authedMutation({
  args: {
    entryId: v.id("bodyEntries"),
    loggedAt: v.number(),
    ...measureArgs,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const entryId: Id<"bodyEntries"> = args.entryId;
    await updateBodyEntry(ctx, ctx.userId, entryId, args);
    return null;
  },
});

export const remove = authedMutation({
  args: { entryId: v.id("bodyEntries") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await removeBodyEntry(ctx, ctx.userId, args.entryId);
    return null;
  },
});
