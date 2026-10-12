import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { authedMutation } from "./lib/customFunctions";
import { REMOVAL_TTL_MS, acceptOfflineBatch } from "./lib/offlineSync";
import { personalRecordValidator } from "./lib/records";
import { setTypeValidator } from "./lib/setTypeValidator";

const setResult = v.object({
  clientId: v.string(),
  revision: v.number(),
  // "removed" means the set was deleted, here or on another device, and this
  // client id will not be saved again. An older phone treats it as applied.
  status: v.union(v.literal("applied"), v.literal("rejected"), v.literal("removed")),
  setId: v.union(v.id("sets"), v.null()),
  sessionId: v.union(v.id("sessions"), v.null()),
  personalRecord: v.union(personalRecordValidator, v.null()),
  message: v.union(v.string(), v.null()),
});

const editResult = v.object({
  editId: v.string(),
  status: v.union(v.literal("applied"), v.literal("rejected")),
  personalRecord: v.union(personalRecordValidator, v.null()),
  message: v.union(v.string(), v.null()),
});

const deleteResult = v.object({
  deleteId: v.string(),
  status: v.union(v.literal("applied"), v.literal("rejected")),
  message: v.union(v.string(), v.null()),
});

const actionResult = v.object({
  actionId: v.string(),
  status: v.union(v.literal("applied"), v.literal("rejected")),
  sessionId: v.union(v.id("sessions"), v.null()),
  message: v.union(v.string(), v.null()),
});

const bodyResult = v.object({
  clientId: v.string(),
  status: v.union(v.literal("applied"), v.literal("rejected")),
  entryId: v.union(v.id("bodyEntries"), v.null()),
  message: v.union(v.string(), v.null()),
});

const bodyInput = {
  clientId: v.string(),
  loggedAt: v.number(),
  weightLb: v.optional(v.number()),
  bodyFatPct: v.optional(v.number()),
  waistCm: v.optional(v.number()),
  chestCm: v.optional(v.number()),
  armCm: v.optional(v.number()),
  hipsCm: v.optional(v.number()),
  thighCm: v.optional(v.number()),
  note: v.optional(v.string()),
};

const measureFields = {
  reps: v.optional(v.number()),
  weightLb: v.number(),
  durationSec: v.optional(v.number()),
  distanceM: v.optional(v.number()),
  calories: v.optional(v.number()),
  rpe: v.optional(v.number()),
  // Omitted on a retry means working for a new set, and "leave it" for an edit.
  setType: v.optional(setTypeValidator),
};

/**
 * Applies a phone's queued workout changes. Safe to retry: each set's client
 * id matches at most one saved set for this user.
 */
export const accept = authedMutation({
  args: {
    sets: v.array(
      v.object({
        clientId: v.string(),
        revision: v.number(),
        removed: v.boolean(),
        placement: v.union(v.literal("open"), v.literal("completed")),
        sessionId: v.optional(v.id("sessions")),
        sessionClientId: v.string(),
        sessionStartedAt: v.number(),
        exerciseName: v.string(),
        loggedAt: v.number(),
        note: v.optional(v.string()),
        supersetId: v.optional(v.string()),
        ...measureFields,
      }),
    ),
    edits: v.array(
      v.object({
        editId: v.string(),
        setId: v.id("sets"),
        ...measureFields,
      }),
    ),
    deletes: v.array(
      v.object({
        deleteId: v.string(),
        setId: v.id("sets"),
      }),
    ),
    actions: v.array(
      v.object({
        actionId: v.string(),
        kind: v.union(v.literal("complete"), v.literal("discard"), v.literal("keepGoing")),
        sessionId: v.optional(v.id("sessions")),
        sessionClientId: v.string(),
        note: v.optional(v.string()),
        requestedAt: v.number(),
      }),
    ),
    // Optional so a phone that queued only sets before body entries existed still syncs.
    body: v.optional(v.array(v.object(bodyInput))),
    // The phone's clock at send time, sent by the older client. The server
    // shifts item times by the difference, which also counts delivery delay.
    clientNow: v.optional(v.number()),
    // Server time minus phone time, measured by the phone on a quick round
    // trip. Used instead of clientNow because a late delivery does not change it.
    clockOffsetMs: v.optional(v.number()),
  },
  returns: v.object({
    sets: v.array(setResult),
    edits: v.array(editResult),
    deletes: v.array(deleteResult),
    actions: v.array(actionResult),
    body: v.array(bodyResult),
    // Lets the phone measure its clock from a quick reply.
    serverNow: v.number(),
  }),
  handler: async (ctx, args) => {
    return await acceptOfflineBatch(ctx, ctx.userId, args);
  },
});

/** Server time, so a phone with no clock reading can take one before it sends queued times. */
export const serverTime = authedMutation({
  args: {},
  returns: v.number(),
  handler: async () => {
    return Date.now();
  },
});

const EXPIRE_PAGE = 200;

/**
 * Forget removed client ids after a while. A phone that stays offline longer
 * than that could bring a removed set back, which is rarer than the table
 * growing forever.
 */
export const expireRemovals = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const cutoff = Date.now() - REMOVAL_TTL_MS;
    const stale = await ctx.db
      .query("removedClientIds")
      .withIndex("by_removed_at", (q) => q.lt("removedAt", cutoff))
      .take(EXPIRE_PAGE);
    for (const row of stale) {
      await ctx.db.delete("removedClientIds", row._id);
    }
    if (stale.length === EXPIRE_PAGE) {
      await ctx.scheduler.runAfter(0, internal.offline.expireRemovals, {});
    }
    return stale.length;
  },
});
