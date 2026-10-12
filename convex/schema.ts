import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { recordStampValidator } from "./lib/records";

const effortSnap = v.object({
  setId: v.id("sets"),
  sessionId: v.id("sessions"),
  loggedAt: v.number(),
  reps: v.union(v.number(), v.null()),
  weightLb: v.number(),
  epleyLb: v.union(v.number(), v.null()),
  durationSec: v.union(v.number(), v.null()),
  distanceM: v.union(v.number(), v.null()),
});

const calorieSnap = v.object({
  sessionId: v.id("sessions"),
  calories: v.number(),
  loggedAt: v.number(),
});

export default defineSchema({
  ...authTables,
  exercises: defineTable({
    userId: v.id("users"),
    name: v.string(),
    normalizedName: v.string(),
    createdAt: v.number(),
    // Optional so exercises saved before per-exercise rest still validate.
    // Absent means the device rest default.
    restSeconds: v.optional(v.number()),
    // Optional so exercises saved before muscle groups still validate.
    // Absent means the name's suggestion, which the person can override.
    muscleGroup: v.optional(
      v.union(
        v.literal("chest"),
        v.literal("back"),
        v.literal("shoulders"),
        v.literal("biceps"),
        v.literal("triceps"),
        v.literal("quads"),
        v.literal("hamstrings"),
        v.literal("glutes"),
        v.literal("core"),
        v.literal("cardio"),
        v.literal("other"),
      ),
    ),
  })
    .index("by_user_and_normalized_name", ["userId", "normalizedName"])
    // Exercises with their own rest, listed in Settings so they can be reset.
    .index("by_user_and_rest", ["userId", "restSeconds"]),
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
    // The phone's own start time for that client id, before clock correction.
    // Later batches of a past workout match on it. Older sessions omit it, which is valid.
    clientStartedAt: v.optional(v.number()),
    // Present when this workout was started from a routine or a repeat.
    // Older sessions omit these, which is valid.
    planName: v.optional(v.string()),
    routineId: v.optional(v.id("routines")),
    plan: v.optional(
      v.array(
        v.object({
          exerciseId: v.id("exercises"),
          targetSets: v.optional(v.number()),
          targetReps: v.optional(v.number()),
          targetWeightLb: v.optional(v.number()),
          targetDurationSec: v.optional(v.number()),
          targetDistanceM: v.optional(v.number()),
          // Optional so workouts saved before calories still validate.
          targetCalories: v.optional(v.number()),
          skipped: v.optional(v.boolean()),
          // Optional so workouts saved before supersets still validate.
          // Shared by adjacent exercises. Absent means this exercise stands alone.
          supersetId: v.optional(v.string()),
        }),
      ),
    ),
    // Optional so workouts saved before stored activity still validate.
    // Absent means unknown. Zero with no lastSetAt means a known empty workout.
    setCount: v.optional(v.number()),
    lastSetAt: v.optional(v.number()),
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
    // Optional so sets saved before calories still validate. Whole kcal.
    calories: v.optional(v.number()),
    rpe: v.optional(v.number()),
    // Unused. Optional so sets saved before we stopped writing it still validate.
    order: v.optional(v.number()),
    loggedAt: v.number(),
    // Phone-generated id so a retry after a dropped connection cannot insert
    // the same set twice. Older sets omit it, which is valid.
    clientId: v.optional(v.string()),
    clientRevision: v.optional(v.number()),
    // Optional so sets saved before set types still validate. Absent means working.
    setType: v.optional(
      v.union(
        v.literal("warmup"),
        v.literal("working"),
        v.literal("drop"),
        v.literal("failure"),
      ),
    ),
    // Optional so sets saved before stamps still validate.
    // Absent means not judged yet. An empty array was judged and was not a record.
    recordStamps: v.optional(v.array(recordStampValidator)),
  })
    .index("by_session_and_exercise", ["sessionId", "exerciseId"])
    .index("by_user_and_client_id", ["userId", "clientId"])
    // loggedAt is already on every set. This replaces a user+exercise index
    // that sorted by creation time: a workout logged today for last month
    // must sort by when the set was performed.
    .index("by_user_exercise_and_logged", ["userId", "exerciseId", "loggedAt"])
    // Every set for one person, oldest first. Export pages through this.
    .index("by_user_and_logged", ["userId", "loggedAt"]),
  routines: defineTable({
    userId: v.id("users"),
    name: v.string(),
    exercises: v.array(
      v.object({
        exerciseId: v.id("exercises"),
        targetSets: v.optional(v.number()),
        targetReps: v.optional(v.number()),
        targetWeightLb: v.optional(v.number()),
        targetDurationSec: v.optional(v.number()),
        targetDistanceM: v.optional(v.number()),
        // Optional so routines saved before calories still validate.
        targetCalories: v.optional(v.number()),
        // Optional so routines saved before supersets still validate.
        supersetId: v.optional(v.string()),
      }),
    ),
    sortIndex: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_user_and_sort", ["userId", "sortIndex"]),
  preferences: defineTable({
    userId: v.id("users"),
    weightUnit: v.union(v.literal("lb"), v.literal("kg")),
    // Optional so preference rows saved before suggestions still validate.
    // Absent means suggestions are on, with the unit's default increment.
    suggestNextWeight: v.optional(v.boolean()),
    progressionIncrementLb: v.optional(v.number()),
    // Optional so preference rows saved before length units still validate.
    // Absent follows the weight unit: inches with pounds, centimeters with kilograms.
    lengthUnit: v.optional(v.union(v.literal("in"), v.literal("cm"))),
  }).index("by_user", ["userId"]),
  bodyEntries: defineTable({
    userId: v.id("users"),
    loggedAt: v.number(),
    // Pounds, same as set weights. Absent when this entry is measurements only.
    weightLb: v.optional(v.number()),
    bodyFatPct: v.optional(v.number()),
    // Centimeters. Absent fields were not measured that day.
    waistCm: v.optional(v.number()),
    chestCm: v.optional(v.number()),
    armCm: v.optional(v.number()),
    hipsCm: v.optional(v.number()),
    thighCm: v.optional(v.number()),
    note: v.optional(v.string()),
    // Phone-generated id so a retry cannot insert the same entry twice.
    clientId: v.optional(v.string()),
  })
    .index("by_user_and_logged", ["userId", "loggedAt"])
    .index("by_user_and_client_id", ["userId", "clientId"]),
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
  // A set removed by client id. A later sync of an older revision must not
  // insert it again. The table is new, so every row has all of these fields.
  removedClientIds: defineTable({
    userId: v.id("users"),
    clientId: v.string(),
    removedAt: v.number(),
  })
    .index("by_user_and_client_id", ["userId", "clientId"])
    .index("by_removed_at", ["removedAt"]),
  // All-time bests for one exercise. New table, so existing documents are untouched.
  // `ready` is false while a paginated rebuild is walking history.
  exerciseStats: defineTable({
    userId: v.id("users"),
    exerciseId: v.id("exercises"),
    setCount: v.number(),
    lastLoggedAt: v.union(v.number(), v.null()),
    ready: v.boolean(),
    dirty: v.boolean(),
    drop: v.boolean(),
    generation: v.number(),
    cursor: v.union(v.string(), v.null()),
    phase: v.union(v.literal("purge"), v.literal("purgeCalories"), v.literal("walk")),
    scheduledAt: v.union(v.number(), v.null()),
    // Bumped each time a rebuild page is scheduled. A page only runs while its
    // step is current. Rows written before this field read as step 0.
    step: v.optional(v.number()),
    // loggedAt of the last set the running rebuild has walked. A later page
    // reads any change after it, so that change does not restart the rebuild.
    walkedThrough: v.optional(v.number()),
    // Version of the record rules the bests were built with. Absent is 1,
    // from before a timed set could take an untimed distance best's place.
    recordRules: v.optional(v.number()),
    bestWeight: v.union(effortSnap, v.null()),
    bestEpley: v.union(effortSnap, v.null()),
    bestReps: v.union(effortSnap, v.null()),
    bestDuration: v.union(effortSnap, v.null()),
    bestDistance: v.union(effortSnap, v.null()),
    bestCalories: v.union(calorieSnap, v.null()),
    secondCalories: v.union(calorieSnap, v.null()),
  })
    .index("by_user_and_exercise", ["userId", "exerciseId"])
    .index("by_ready_and_scheduled", ["ready", "scheduledAt"]),
  // Monotonic personal records. The latest mark before a time is the best then.
  recordMarks: defineTable({
    userId: v.id("users"),
    exerciseId: v.id("exercises"),
    generation: v.number(),
    metric: v.union(
      v.literal("weight"),
      v.literal("epley"),
      v.literal("reps"),
      v.literal("duration"),
      v.literal("distance"),
      v.literal("calories"),
    ),
    setId: v.id("sets"),
    sessionId: v.id("sessions"),
    loggedAt: v.number(),
    reps: v.union(v.number(), v.null()),
    weightLb: v.number(),
    epleyLb: v.union(v.number(), v.null()),
    durationSec: v.union(v.number(), v.null()),
    distanceM: v.union(v.number(), v.null()),
    calories: v.union(v.number(), v.null()),
    otherSessionId: v.optional(v.id("sessions")),
    otherCalories: v.optional(v.number()),
  })
    .index("by_metric", ["userId", "exerciseId", "generation", "metric", "loggedAt"])
    .index("by_exercise", ["exerciseId"]),
  // Calorie records are session totals, not per-set. One row per session per generation.
  exerciseSessionCalories: defineTable({
    userId: v.id("users"),
    exerciseId: v.id("exercises"),
    sessionId: v.id("sessions"),
    generation: v.number(),
    calories: v.number(),
    loggedAt: v.number(),
  })
    .index("by_session", ["userId", "exerciseId", "generation", "sessionId"])
    .index("by_exercise", ["exerciseId"]),
  // One row. The cron walks exercises and sessions until this says both are done.
  statsBackfill: defineTable({
    key: v.literal("main"),
    exerciseCursor: v.union(v.string(), v.null()),
    exercisesDone: v.boolean(),
    sessionCursor: v.union(v.string(), v.null()),
    sessionsDone: v.boolean(),
    runningUntil: v.number(),
  }).index("by_key", ["key"]),
});
