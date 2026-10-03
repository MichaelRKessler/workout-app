import { v } from "convex/values";
import { authedQuery } from "./lib/customFunctions";

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
