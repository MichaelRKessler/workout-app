// Fictional workout history for one test account. Not for main.
// Run: npx convex run devSeed:seed '{"email":"nojunkemail95@gmail.com"}'
// Undo: npx convex run devSeed:unseed '{"email":"nojunkemail95@gmail.com"}'
// Everything it writes carries a "seed-demo-" client id, or is a seeded
// exercise or routine name, so unseed removes exactly what seed added.
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { requestRebuild } from "./lib/exerciseStats";

const TEST_EMAIL = "nojunkemail95@gmail.com";
const TAG = "seed-demo-";
const DAY = 24 * 60 * 60 * 1000;
const WEEKS = 6;

type Group =
  | "chest" | "back" | "shoulders" | "biceps" | "triceps"
  | "quads" | "hamstrings" | "glutes" | "core" | "cardio";

type Kind = "weighted" | "bodyweight" | "timed" | "cardio";

type ExerciseSpec = {
  name: string;
  group: Group;
  kind: Kind;
  // Working weight in week 1 and the weekly gain, in pounds.
  start: number;
  step: number;
  sets: number;
  reps: number;
  rest: number;
  warmup?: boolean;
};

const EXERCISES: ExerciseSpec[] = [
  { name: "Bench Press", group: "chest", kind: "weighted", start: 165, step: 5, sets: 4, reps: 6, rest: 150, warmup: true },
  { name: "Incline Dumbbell Press", group: "chest", kind: "weighted", start: 55, step: 2.5, sets: 3, reps: 10, rest: 90 },
  { name: "Overhead Press", group: "shoulders", kind: "weighted", start: 95, step: 2.5, sets: 3, reps: 8, rest: 120 },
  { name: "Lateral Raise", group: "shoulders", kind: "weighted", start: 20, step: 1, sets: 3, reps: 15, rest: 60 },
  { name: "Tricep Pushdown", group: "triceps", kind: "weighted", start: 50, step: 2.5, sets: 3, reps: 12, rest: 60 },
  { name: "Deadlift", group: "back", kind: "weighted", start: 255, step: 10, sets: 3, reps: 5, rest: 180, warmup: true },
  { name: "Pull-Up", group: "back", kind: "bodyweight", start: 0, step: 0, sets: 3, reps: 7, rest: 120 },
  { name: "Barbell Row", group: "back", kind: "weighted", start: 135, step: 5, sets: 3, reps: 8, rest: 120 },
  { name: "Barbell Curl", group: "biceps", kind: "weighted", start: 60, step: 2.5, sets: 3, reps: 10, rest: 60 },
  { name: "Back Squat", group: "quads", kind: "weighted", start: 205, step: 10, sets: 4, reps: 5, rest: 180, warmup: true },
  { name: "Romanian Deadlift", group: "hamstrings", kind: "weighted", start: 155, step: 5, sets: 3, reps: 8, rest: 120 },
  { name: "Hip Thrust", group: "glutes", kind: "weighted", start: 185, step: 10, sets: 3, reps: 10, rest: 90 },
  { name: "Plank", group: "core", kind: "timed", start: 0, step: 0, sets: 3, reps: 0, rest: 60 },
  { name: "Hanging Leg Raise", group: "core", kind: "bodyweight", start: 0, step: 0, sets: 3, reps: 10, rest: 60 },
  { name: "Rowing Machine", group: "cardio", kind: "cardio", start: 0, step: 0, sets: 1, reps: 0, rest: 0 },
];

const ROUTINES: Array<{ name: string; exercises: string[] }> = [
  { name: "Push Day", exercises: ["Bench Press", "Incline Dumbbell Press", "Overhead Press", "Lateral Raise", "Tricep Pushdown"] },
  { name: "Pull Day", exercises: ["Deadlift", "Pull-Up", "Barbell Row", "Barbell Curl"] },
  { name: "Leg Day", exercises: ["Back Squat", "Romanian Deadlift", "Hip Thrust", "Plank"] },
  { name: "Cardio + Core", exercises: ["Rowing Machine", "Plank", "Hanging Leg Raise"] },
];

// Day of week (0 = Monday) and start hour for each workout in a week.
const WEEK_PLAN: Array<{ day: number; hour: number; routine: string }> = [
  { day: 0, hour: 6.5, routine: "Push Day" },
  { day: 2, hour: 18, routine: "Pull Day" },
  { day: 4, hour: 6.5, routine: "Leg Day" },
  { day: 5, hour: 9, routine: "Cardio + Core" },
];

const NOTES = [
  "Felt strong today.",
  "Short on sleep, kept it moving.",
  "Left shoulder a little tight, went lighter on raises.",
  "New gym playlist helped.",
  "Busy gym, had to wait for the rack.",
];

// Small deterministic generator so a re-run after unseed gives the same history.
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function roundTo(value: number, step: number): number {
  return Math.round(value / step) * step;
}

async function findTestUser(ctx: MutationCtx, email: string): Promise<Id<"users">> {
  if (email !== TEST_EMAIL) {
    throw new Error(`devSeed only runs for ${TEST_EMAIL}`);
  }
  const users = await ctx.db
    .query("users")
    .withIndex("email", (q) => q.eq("email", email))
    .take(2);
  if (users.length !== 1) {
    throw new Error(`Expected one user for ${email}, found ${users.length}`);
  }
  return users[0]._id;
}

export const seed = internalMutation({
  args: { email: v.string() },
  returns: v.object({
    userId: v.id("users"),
    exercises: v.number(),
    routines: v.number(),
    sessions: v.number(),
    sets: v.number(),
    bodyEntries: v.number(),
  }),
  handler: async (ctx, args) => {
    const userId = await findTestUser(ctx, args.email);
    const already = await ctx.db
      .query("sessions")
      .withIndex("by_user_status_and_started", (q) => q.eq("userId", userId))
      .take(1);
    if (already.length > 0) {
      throw new Error("This account already has workouts. Run unseed first, or clear them by hand.");
    }

    const random = makeRandom(42);
    const now = Date.now();
    // Monday of the week six weeks before this one, local midnight-ish in UTC-4.
    const today = new Date(now);
    const mondayOffset = (today.getUTCDay() + 6) % 7;
    const thisMonday = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - mondayOffset) + 4 * 60 * 60 * 1000;
    const firstMonday = thisMonday - WEEKS * 7 * DAY;

    const exerciseIds = new Map<string, Id<"exercises">>();
    for (const spec of EXERCISES) {
      const id = await ctx.db.insert("exercises", {
        userId,
        name: spec.name,
        normalizedName: spec.name.toLocaleLowerCase(),
        createdAt: firstMonday - DAY,
        muscleGroup: spec.group,
        restSeconds: spec.rest,
      });
      exerciseIds.set(spec.name, id);
    }
    const specByName = new Map(EXERCISES.map((spec) => [spec.name, spec]));

    function target(spec: ExerciseSpec, week: number) {
      const id = exerciseIds.get(spec.name)!;
      switch (spec.kind) {
        case "weighted":
          return { exerciseId: id, targetSets: spec.sets, targetReps: spec.reps, targetWeightLb: spec.start + spec.step * week };
        case "bodyweight":
          return { exerciseId: id, targetSets: spec.sets, targetReps: spec.reps + Math.floor(week / 2) };
        case "timed":
          return { exerciseId: id, targetSets: spec.sets, targetDurationSec: 45 + week * 5 };
        case "cardio":
          return { exerciseId: id, targetSets: 1, targetDurationSec: 1200, targetDistanceM: 4500 + week * 100 };
      }
    }

    const routineIds = new Map<string, Id<"routines">>();
    for (const [index, routine] of ROUTINES.entries()) {
      const id = await ctx.db.insert("routines", {
        userId,
        name: routine.name,
        exercises: routine.exercises.map((name) => target(specByName.get(name)!, WEEKS)),
        sortIndex: index,
        createdAt: firstMonday - DAY,
        updatedAt: now,
      });
      routineIds.set(routine.name, id);
    }

    let sessionCount = 0;
    let setCount = 0;
    for (let week = 0; week < WEEKS; week++) {
      // Week 4 is a lighter deload week. One Saturday is skipped to look real.
      const deload = week === 3;
      for (const slot of WEEK_PLAN) {
        if (slot.routine === "Cardio + Core" && week === 1) {
          continue;
        }
        const startedAt = Math.round(firstMonday + (week * 7 + slot.day) * DAY + slot.hour * 60 * 60 * 1000 + random() * 20 * 60 * 1000);
        if (startedAt > now - 2 * 60 * 60 * 1000) {
          continue;
        }
        const routine = ROUTINES.find((r) => r.name === slot.routine)!;
        const plan = routine.exercises.map((name) => target(specByName.get(name)!, week));
        const note = random() < 0.25 ? NOTES[Math.floor(random() * NOTES.length)] : undefined;
        const sessionId = await ctx.db.insert("sessions", {
          userId,
          status: "completed",
          startedAt,
          completedAt: startedAt,
          clientId: `${TAG}session-${week}-${slot.day}`,
          planName: routine.name,
          routineId: routineIds.get(routine.name),
          plan,
          setCount: 0,
          ...(note ? { note } : {}),
        });
        sessionCount++;

        let clock = startedAt + 4 * 60 * 1000;
        let setIndex = 0;
        let lastSetAt = startedAt;
        const insertSet = async (exerciseId: Id<"exercises">, fields: {
          reps?: number; weightLb: number; durationSec?: number; distanceM?: number;
          calories?: number; rpe?: number; setType?: "warmup" | "working";
        }, restSec: number) => {
          await ctx.db.insert("sets", {
            userId,
            sessionId,
            exerciseId,
            loggedAt: clock,
            clientId: `${TAG}set-${week}-${slot.day}-${setIndex++}`,
            ...fields,
          });
          lastSetAt = clock;
          clock += Math.round((restSec + 40 + random() * 30) * 1000);
          setCount++;
        };

        for (const name of routine.exercises) {
          const spec = specByName.get(name)!;
          const exerciseId = exerciseIds.get(name)!;
          if (spec.kind === "weighted") {
            const working = roundTo((spec.start + spec.step * week) * (deload ? 0.85 : 1), 5);
            if (spec.warmup) {
              await insertSet(exerciseId, { reps: 8, weightLb: roundTo(working * 0.5, 5), setType: "warmup" }, 60);
              await insertSet(exerciseId, { reps: 4, weightLb: roundTo(working * 0.75, 5), setType: "warmup" }, 90);
            }
            for (let s = 0; s < spec.sets; s++) {
              // Last set sometimes falls a rep short, as real sets do.
              const reps = s === spec.sets - 1 && random() < 0.35 ? spec.reps - 1 : spec.reps;
              const rpe = deload ? 6.5 : Math.min(10, 7 + s * 0.5 + (random() < 0.3 ? 0.5 : 0));
              await insertSet(exerciseId, { reps, weightLb: working, rpe }, spec.rest);
            }
          } else if (spec.kind === "bodyweight") {
            const base = spec.reps + Math.floor(week / 2);
            for (let s = 0; s < spec.sets; s++) {
              await insertSet(exerciseId, { reps: Math.max(3, base - s), weightLb: 0 }, spec.rest);
            }
          } else if (spec.kind === "timed") {
            for (let s = 0; s < spec.sets; s++) {
              await insertSet(exerciseId, { durationSec: 45 + week * 5 - s * 5, weightLb: 0 }, spec.rest);
            }
          } else {
            const distanceM = 4500 + week * 100 + Math.round(random() * 150);
            await insertSet(exerciseId, { durationSec: 1200, distanceM, calories: Math.round(distanceM / 18), weightLb: 0 }, 120);
          }
        }
        await ctx.db.patch("sessions", sessionId, {
          completedAt: lastSetAt + 3 * 60 * 1000,
          setCount: setIndex,
          lastSetAt,
        });
      }
    }

    // Weekly morning weigh-ins, drifting down slowly.
    let bodyEntries = 0;
    for (let week = 0; week <= WEEKS; week++) {
      const loggedAt = firstMonday + week * 7 * DAY + 3 * 60 * 60 * 1000;
      if (loggedAt > now) {
        continue;
      }
      await ctx.db.insert("bodyEntries", {
        userId,
        loggedAt,
        weightLb: Math.round((186 - week * 0.6 + random() * 0.8) * 10) / 10,
        ...(week % 3 === 0 ? { waistCm: Math.round((89 - week * 0.3) * 10) / 10 } : {}),
        clientId: `${TAG}body-${week}`,
      });
      bodyEntries++;
    }

    // Personal records and all-time bests come from the app's own rebuild.
    for (const exerciseId of exerciseIds.values()) {
      await requestRebuild(ctx, userId, exerciseId);
    }

    return {
      userId,
      exercises: exerciseIds.size,
      routines: routineIds.size,
      sessions: sessionCount,
      sets: setCount,
      bodyEntries,
    };
  },
});

export const unseed = internalMutation({
  args: { email: v.string() },
  returns: v.object({
    sessions: v.number(),
    sets: v.number(),
    bodyEntries: v.number(),
    routines: v.number(),
    exercises: v.number(),
  }),
  handler: async (ctx, args) => {
    const userId = await findTestUser(ctx, args.email);
    const isSeed = (clientId: string | undefined) => clientId?.startsWith(TAG) ?? false;

    let sets = 0;
    const touched = new Set<Id<"exercises">>();
    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_user_status_and_started", (q) => q.eq("userId", userId))
      .collect();
    let sessionCount = 0;
    for (const session of sessions) {
      if (!isSeed(session.clientId)) {
        continue;
      }
      const sessionSets = await ctx.db
        .query("sets")
        .withIndex("by_session_and_exercise", (q) => q.eq("sessionId", session._id))
        .collect();
      for (const set of sessionSets) {
        touched.add(set.exerciseId);
        await ctx.db.delete("sets", set._id);
        sets++;
      }
      await ctx.db.delete("sessions", session._id);
      sessionCount++;
    }

    let bodyEntries = 0;
    const entries = await ctx.db
      .query("bodyEntries")
      .withIndex("by_user_and_logged", (q) => q.eq("userId", userId))
      .collect();
    for (const entry of entries) {
      if (isSeed(entry.clientId)) {
        await ctx.db.delete("bodyEntries", entry._id);
        bodyEntries++;
      }
    }

    const routineNames = new Set(ROUTINES.map((r) => r.name));
    let routines = 0;
    const userRoutines = await ctx.db
      .query("routines")
      .withIndex("by_user_and_sort", (q) => q.eq("userId", userId))
      .collect();
    for (const routine of userRoutines) {
      if (routineNames.has(routine.name)) {
        await ctx.db.delete("routines", routine._id);
        routines++;
      }
    }

    // A seeded exercise goes only when no sets of the person's own remain on it.
    let exercises = 0;
    for (const spec of EXERCISES) {
      const exercise = await ctx.db
        .query("exercises")
        .withIndex("by_user_and_normalized_name", (q) =>
          q.eq("userId", userId).eq("normalizedName", spec.name.toLocaleLowerCase()),
        )
        .unique();
      if (!exercise) {
        continue;
      }
      const remaining = await ctx.db
        .query("sets")
        .withIndex("by_user_exercise_and_logged", (q) =>
          q.eq("userId", userId).eq("exerciseId", exercise._id),
        )
        .take(1);
      if (remaining.length > 0) {
        await requestRebuild(ctx, userId, exercise._id);
        touched.delete(exercise._id);
        continue;
      }
      for (const row of await ctx.db
        .query("exerciseStats")
        .withIndex("by_user_and_exercise", (q) => q.eq("userId", userId).eq("exerciseId", exercise._id))
        .collect()) {
        await ctx.db.delete("exerciseStats", row._id);
      }
      for (const row of await ctx.db.query("recordMarks").withIndex("by_exercise", (q) => q.eq("exerciseId", exercise._id)).collect()) {
        await ctx.db.delete("recordMarks", row._id);
      }
      for (const row of await ctx.db
        .query("exerciseSessionCalories")
        .withIndex("by_exercise", (q) => q.eq("exerciseId", exercise._id))
        .collect()) {
        await ctx.db.delete("exerciseSessionCalories", row._id);
      }
      await ctx.db.delete("exercises", exercise._id);
      touched.delete(exercise._id);
      exercises++;
    }
    for (const exerciseId of touched) {
      await requestRebuild(ctx, userId, exerciseId);
    }

    return { sessions: sessionCount, sets, bodyEntries, routines, exercises };
  },
});
