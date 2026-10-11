import { v } from "convex/values";
import { authedMutation, authedQuery } from "./lib/customFunctions";

const weightUnit = v.union(v.literal("lb"), v.literal("kg"));

export const viewer = authedQuery({
  args: {},
  returns: v.union(
    v.object({
      name: v.union(v.string(), v.null()),
      email: v.union(v.string(), v.null()),
    }),
    v.null(),
  ),
  handler: async (ctx) => {
    const user = await ctx.db.get("users", ctx.userId);
    if (!user) {
      return null;
    }
    return {
      name: user.name ?? null,
      email: user.email ?? null,
    };
  },
});

/** Missing row means pounds, which is how every existing weight was stored. */
export const preferences = authedQuery({
  args: {},
  returns: v.object({
    weightUnit,
  }),
  handler: async (ctx) => {
    const row = await ctx.db
      .query("preferences")
      .withIndex("by_user", (q) => q.eq("userId", ctx.userId))
      .unique();
    return { weightUnit: row?.weightUnit ?? "lb" };
  },
});

export const setWeightUnit = authedMutation({
  args: { weightUnit },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("preferences")
      .withIndex("by_user", (q) => q.eq("userId", ctx.userId))
      .unique();
    if (existing) {
      if (existing.userId !== ctx.userId) {
        throw new Error("Not authenticated");
      }
      await ctx.db.patch("preferences", existing._id, { weightUnit: args.weightUnit });
    } else {
      await ctx.db.insert("preferences", {
        userId: ctx.userId,
        weightUnit: args.weightUnit,
      });
    }
    return null;
  },
});
