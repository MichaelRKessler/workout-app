import {
  customCtx,
  customMutation,
  customQuery,
} from "convex-helpers/server/customFunctions";
import { mutation, query } from "../_generated/server";
import { normalizeEmail, requireAdmin, requireAllowedUser } from "./accessControl";
import { requireUserId } from "./auth";

async function signedInViewer(ctx: Parameters<typeof requireUserId>[0]) {
  const userId = await requireUserId(ctx);
  const user = await ctx.db.get("users", userId);
  return {
    userId,
    email: user?.email ? normalizeEmail(user.email) : null,
    name: user?.name ?? null,
  };
}

/** Signed in, but not necessarily on the allow list. */
export const signedInQuery = customQuery(
  query,
  customCtx(async (ctx) => {
    return await signedInViewer(ctx);
  }),
);

export const signedInMutation = customMutation(
  mutation,
  customCtx(async (ctx) => {
    return await signedInViewer(ctx);
  }),
);

/** Signed in and on the allow list. Workout data uses these. */
export const authedQuery = customQuery(
  query,
  customCtx(async (ctx) => {
    return await requireAllowedUser(ctx);
  }),
);

export const authedMutation = customMutation(
  mutation,
  customCtx(async (ctx) => {
    return await requireAllowedUser(ctx);
  }),
);

export const adminQuery = customQuery(
  query,
  customCtx(async (ctx) => {
    return await requireAdmin(ctx);
  }),
);

export const adminMutation = customMutation(
  mutation,
  customCtx(async (ctx) => {
    return await requireAdmin(ctx);
  }),
);
