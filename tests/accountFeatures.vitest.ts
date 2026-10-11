/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import { weekRange } from "../convex/lib/week";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");

function testBackend() {
  return convexTest(schema, modules);
}

async function signIn(t: ReturnType<typeof testBackend>, name: string) {
  const email = `${name.toLowerCase().replace(/[^a-z0-9]+/g, ".")}.features@example.com`;
  const userId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("users", { name, email });
    await ctx.db.insert("allowedEmails", { email, createdAt: Date.now() });
    return id;
  });
  return { userId, asUser: t.withIdentity({ subject: `${userId}|${name}-session` }) };
}

describe("set types, suggestions, and per-exercise rest", () => {
  test("an omitted set type reads as working and can be cleared", async () => {
    const t = testBackend();
    const { userId, asUser } = await signIn(t, "Michael");
    const sessionId = await asUser.mutation(api.sessions.start, {});
    const saved = await asUser.mutation(api.sets.log, {
      sessionId,
      exerciseName: "bench press",
      reps: 8,
      weightLb: 135,
      setType: "warmup",
    });
    const [warm] = await asUser.query(api.sets.listForSession, { sessionId });
    expect(warm?.setType).toBe("warmup");
    await asUser.mutation(api.sets.update, {
      setId: saved.setId,
      reps: 8,
      weightLb: 135,
      setType: "working",
    });
    const stored = await t.run(async (ctx) => ctx.db.get("sets", saved.setId));
    expect(stored?.setType).toBeUndefined();
    expect(stored?.userId).toBe(userId);
    const [after] = await asUser.query(api.sets.listForSession, { sessionId });
    expect(after?.setType).toBe("working");
  });

  test("warm-ups leave the weekly total and volume, and a drop set is not a record", async () => {
    const t = testBackend();
    const { asUser } = await signIn(t, "Michael");
    const sessionId = await asUser.mutation(api.sessions.start, {});
    const warm = await asUser.mutation(api.sets.log, {
      sessionId,
      exerciseName: "squat",
      reps: 5,
      weightLb: 135,
      setType: "warmup",
    });
    expect(warm.personalRecord).toBeNull();
    const drop = await asUser.mutation(api.sets.log, {
      sessionId,
      exerciseName: "squat",
      reps: 8,
      weightLb: 95,
      setType: "drop",
    });
    expect(drop.personalRecord).toBeNull();
    const work = await asUser.mutation(api.sets.log, {
      sessionId,
      exerciseName: "squat",
      reps: 5,
      weightLb: 185,
      setType: "working",
    });
    expect(work.personalRecord).toMatchObject({ kind: "both", weightLb: 185 });
    await asUser.mutation(api.sessions.complete, { sessionId });
    const week = weekRange(Date.now(), 1);
    const summary = await asUser.query(api.sessions.weeklySummary, {
      weekStarts: week.weekStarts,
      weekEndsAt: week.weekEndsAt,
    });
    expect(summary.workouts).toBe(1);
    expect(summary.sets).toBe(2);
    expect(summary.volumeLb).toBe(5 * 185 + 8 * 95);
    expect(summary.muscles).toEqual([{ group: "quads", sets: 2 }]);
  });

  test("suggestions default on, and rest stays on the owning account", async () => {
    const t = testBackend();
    const michael = await signIn(t, "Michael");
    const other = await signIn(t, "Other");
    expect(await michael.asUser.query(api.users.preferences, {})).toMatchObject({
      suggestNextWeight: true,
      progressionIncrementLb: null,
    });
    await michael.asUser.mutation(api.users.setProgression, {
      suggestNextWeight: false,
      progressionIncrementLb: 2.5,
    });
    expect(await michael.asUser.query(api.users.preferences, {})).toMatchObject({
      suggestNextWeight: false,
      progressionIncrementLb: 2.5,
    });
    await michael.asUser.mutation(api.users.setProgression, {
      suggestNextWeight: false,
      progressionIncrementLb: null,
    });
    const cleared = await michael.asUser.query(api.users.preferences, {});
    expect(cleared.progressionIncrementLb).toBeNull();
    expect(cleared.suggestNextWeight).toBe(false);

    await michael.asUser.mutation(api.exercises.setRest, { name: "Squat", restSeconds: 180 });
    expect(await michael.asUser.query(api.exercises.restForName, { name: " squat " })).toBe(180);
    expect(await other.asUser.query(api.exercises.restForName, { name: "squat" })).toBeNull();
    const listed = await michael.asUser.query(api.exercises.list, {});
    expect(listed.exercises[0]).toMatchObject({ name: "Squat", restSeconds: 180 });

    await michael.asUser.mutation(api.routines.create, {
      name: "Legs",
      exercises: [{ name: "Squat", targetSets: 3, targetReps: 5, restSeconds: 90 }],
    });
    const [routine] = await michael.asUser.query(api.routines.list, {});
    expect(routine?.exercises[0]?.restSeconds).toBe(90);
    await michael.asUser.mutation(api.routines.update, {
      routineId: routine!._id,
      name: "Legs",
      exercises: [
        {
          exerciseId: routine!.exercises[0]!.exerciseId,
          name: "Squat",
          targetSets: 3,
          targetReps: 5,
          restSeconds: null,
        },
      ],
    });
    expect(
      (await michael.asUser.query(api.routines.list, {}))[0]?.exercises[0]?.restSeconds,
    ).toBeNull();
  });

  test("merging keeps the destination rest, and copies one when the destination has none", async () => {
    const t = testBackend();
    const { asUser } = await signIn(t, "Michael");
    await asUser.mutation(api.exercises.setRest, { name: "Bench press", restSeconds: 120 });
    await asUser.mutation(api.exercises.setRest, { name: "Flat bench", restSeconds: 60 });
    const listed = await asUser.query(api.exercises.list, {});
    const bench = listed.exercises.find((exercise) => exercise.name === "Bench press");
    const flat = listed.exercises.find((exercise) => exercise.name === "Flat bench");
    if (!bench || !flat) {
      throw new Error("Expected both exercises");
    }
    await asUser.mutation(api.exercises.merge, { fromId: flat._id, intoId: bench._id });
    expect(await asUser.query(api.exercises.restForName, { name: "Bench press" })).toBe(120);

    await asUser.mutation(api.exercises.setRest, { name: "Incline", restSeconds: 150 });
    const again = await asUser.query(api.exercises.list, {});
    const incline = again.exercises.find((exercise) => exercise.name === "Incline");
    const kept = again.exercises.find((exercise) => exercise.name === "Bench press");
    if (!incline || !kept) {
      throw new Error("Expected incline and bench");
    }
    await asUser.mutation(api.exercises.setRest, { name: "Bench press", restSeconds: null });
    await asUser.mutation(api.exercises.merge, { fromId: incline._id, intoId: kept._id });
    expect(await asUser.query(api.exercises.restForName, { name: "Bench press" })).toBe(150);
  });
});
