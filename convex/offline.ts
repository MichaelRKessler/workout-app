import { v } from "convex/values";
import { authedMutation } from "./lib/customFunctions";
import { acceptOfflineBatch } from "./lib/offlineSync";
import { personalRecordValidator } from "./lib/records";

const setResult = v.object({
  clientId: v.string(),
  revision: v.number(),
  status: v.union(v.literal("applied"), v.literal("rejected")),
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

const measureFields = {
  reps: v.optional(v.number()),
  weightLb: v.number(),
  durationSec: v.optional(v.number()),
  distanceM: v.optional(v.number()),
  rpe: v.optional(v.number()),
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
  },
  returns: v.object({
    sets: v.array(setResult),
    edits: v.array(editResult),
    deletes: v.array(deleteResult),
    actions: v.array(actionResult),
  }),
  handler: async (ctx, args) => {
    return await acceptOfflineBatch(ctx, ctx.userId, args);
  },
});
