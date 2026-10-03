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
  }).index("by_user_status_and_started", ["userId", "status", "startedAt"]),
  sets: defineTable({
    userId: v.id("users"),
    sessionId: v.id("sessions"),
    exerciseId: v.id("exercises"),
    reps: v.number(),
    weightLb: v.number(),
    order: v.number(),
    loggedAt: v.number(),
  }).index("by_session_and_exercise", ["sessionId", "exerciseId"]),
});
