import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  ...authTables,
  exercises: defineTable({
    userId: v.id("users"),
    name: v.string(),
    normalizedName: v.string(),
    createdAt: v.number(),
  }).index("by_user_and_normalized_name", ["userId", "normalizedName"]),
  sessions: defineTable({
    userId: v.id("users"),
    status: v.union(v.literal("open"), v.literal("completed")),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
    // Set when someone answers "Still working out?" with Keep going.
    // Older sessions omit it, which is valid.
    resumedAt: v.optional(v.number()),
    // Optional so workouts saved before notes existed still validate.
    note: v.optional(v.string()),
    // Set when a phone logs a workout before the server has seen it.
    // Older sessions omit it, which is valid.
    clientId: v.optional(v.string()),
  })
    .index("by_user_status_and_started", ["userId", "status", "startedAt"])
    .index("by_status", ["status"])
    .index("by_user_and_client_id", ["userId", "clientId"]),
  sets: defineTable({
    userId: v.id("users"),
    sessionId: v.id("sessions"),
    exerciseId: v.id("exercises"),
    // Optional for timed and distance sets. Older sets always have it.
    reps: v.optional(v.number()),
    // Always pounds. Older sets are pounds and stay pounds.
    weightLb: v.number(),
    durationSec: v.optional(v.number()),
    distanceM: v.optional(v.number()),
    rpe: v.optional(v.number()),
    // Unused. Optional so sets saved before we stopped writing it still validate.
    order: v.optional(v.number()),
    loggedAt: v.number(),
    // Phone-generated id so a retry after a dropped connection cannot insert
    // the same set twice. Older sets omit it, which is valid.
    clientId: v.optional(v.string()),
    clientRevision: v.optional(v.number()),
  })
    .index("by_session_and_exercise", ["sessionId", "exerciseId"])
    .index("by_user_and_client_id", ["userId", "clientId"])
    // loggedAt is already on every set. This replaces a user+exercise index
    // that sorted by creation time: a workout logged today for last month
    // must sort by when the set was performed.
    .index("by_user_exercise_and_logged", ["userId", "exerciseId", "loggedAt"]),
  preferences: defineTable({
    userId: v.id("users"),
    weightUnit: v.union(v.literal("lb"), v.literal("kg")),
  }).index("by_user", ["userId"]),
  allowedEmails: defineTable({
    email: v.string(),
    createdAt: v.number(),
  })
    .index("by_email", ["email"])
    .index("by_created", ["createdAt"]),
  accessRequests: defineTable({
    email: v.string(),
    note: v.optional(v.string()),
    status: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("denied"),
    ),
    createdAt: v.number(),
    resolvedAt: v.optional(v.number()),
  })
    .index("by_email_and_status", ["email", "status"])
    .index("by_status", ["status"]),
  // Written at Google sign-in. Enforcement uses the allow list, so an
  // approval applies without another sign-in.
  signInFlags: defineTable({
    userId: v.id("users"),
    email: v.union(v.string(), v.null()),
    allowed: v.boolean(),
    updatedAt: v.number(),
  }).index("by_user", ["userId"]),
});
