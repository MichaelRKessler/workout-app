import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import {
  accessStatus,
  approveRequest,
  createAccessRequest,
  denyRequest,
  grantEmail,
  listAllowedEmails,
  listPendingRequests,
  parseEmail,
  recordSignInAccess,
  removeAllowedEmail,
  upsertAllowedEmail,
  ADMIN_EMAIL,
} from "./lib/accessControl";
import {
  adminMutation,
  adminQuery,
  signedInMutation,
  signedInQuery,
} from "./lib/customFunctions";

const requestValidator = v.union(
  v.object({
    status: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("denied"),
    ),
    note: v.union(v.string(), v.null()),
  }),
  v.null(),
);

const statusValidator = v.object({
  email: v.union(v.string(), v.null()),
  name: v.union(v.string(), v.null()),
  allowed: v.boolean(),
  isAdmin: v.boolean(),
  request: requestValidator,
});

const allowedEmailValidator = v.object({
  email: v.string(),
  isAdmin: v.boolean(),
});

const pendingRequestValidator = v.object({
  _id: v.id("accessRequests"),
  email: v.string(),
  note: v.union(v.string(), v.null()),
  createdAt: v.number(),
});

export const myStatus = signedInQuery({
  args: {},
  returns: statusValidator,
  handler: async (ctx) => {
    return await accessStatus(ctx, { email: ctx.email, name: ctx.name });
  },
});

export const requestAccess = signedInMutation({
  args: { note: v.optional(v.string()) },
  returns: v.object({
    status: v.literal("pending"),
    alreadyRequested: v.boolean(),
  }),
  handler: async (ctx, args) => {
    return await createAccessRequest(ctx, ctx.email, args.note);
  },
});

export const listAllowed = adminQuery({
  args: {},
  returns: v.array(allowedEmailValidator),
  handler: async (ctx) => {
    return await listAllowedEmails(ctx);
  },
});

export const listPending = adminQuery({
  args: {},
  returns: v.array(pendingRequestValidator),
  handler: async (ctx) => {
    return await listPendingRequests(ctx);
  },
});

export const addEmail = adminMutation({
  args: { email: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await grantEmail(ctx, parseEmail(args.email));
    return null;
  },
});

export const removeEmail = adminMutation({
  args: { email: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await removeAllowedEmail(ctx, args.email);
    return null;
  },
});

export const approve = adminMutation({
  args: { requestId: v.id("accessRequests") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await approveRequest(ctx, args.requestId);
    return null;
  },
});

export const deny = adminMutation({
  args: { requestId: v.id("accessRequests") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await denyRequest(ctx, args.requestId);
    return null;
  },
});

export const ensureAdmin = adminMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    await upsertAllowedEmail(ctx, ADMIN_EMAIL);
    return null;
  },
});

/** Same writes as the Convex Auth sign-in callback. Not callable from clients. */
export const recordSignIn = internalMutation({
  args: {
    userId: v.id("users"),
    email: v.union(v.string(), v.null()),
  },
  returns: v.object({ allowed: v.boolean() }),
  handler: async (ctx, args) => {
    return await recordSignInAccess(ctx, args);
  },
});
