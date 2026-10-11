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
  const email = `${name.toLowerCase().replace(/[^a-z0-9]+/g, ".")}.user@example.com`;
  const userId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("users", { name, email });
    await ctx.db.insert("allowedEmails", {
      email,
      createdAt: Date.now(),
    });
    return id;
  });
  return { userId, asUser: t.withIdentity({ subject: `${userId}|${name}-session` }) };
}

describe("units, notes, and multi-exercise saves", () => {
  test("a missing preference is pounds, and another person keeps their own", async () => {
    const t = testBackend();
    const michael = await signIn(t, "Michael");
    const other = await signIn(t, "Other");
    expect(await michael.asUser.query(api.users.preferences, {})).toEqual({ weightUnit: "lb", suggestNextWeight: true, progressionIncrementLb: null, lengthUnit: "in" });
    await michael.asUser.mutation(api.users.setWeightUnit, { weightUnit: "kg" });
    expect(await michael.asUser.query(api.users.preferences, {})).toEqual({ weightUnit: "kg", suggestNextWeight: true, progressionIncrementLb: null, lengthUnit: "cm" });
    expect(await other.asUser.query(api.users.preferences, {})).toEqual({ weightUnit: "lb", suggestNextWeight: true, progressionIncrementLb: null, lengthUnit: "in" });
    await michael.asUser.mutation(api.users.setWeightUnit, { weightUnit: "kg" });
    expect(await michael.asUser.query(api.users.preferences, {})).toEqual({ weightUnit: "kg", suggestNextWeight: true, progressionIncrementLb: null, lengthUnit: "cm" });
  });

  test("one confirmation saves every exercise and the note, or none of them", async () => {
    const t = testBackend();
    const { asUser } = await signIn(t, "Michael");
    const sessionId = await asUser.mutation(api.sessions.start, {});
    await expect(
      asUser.mutation(api.sets.logWorkout, {
        sessionId,
        note: "felt good",
        exercises: [
          { exerciseName: "bench press", sets: [{ reps: 5, weightLb: 135 }] },
          { exerciseName: "   ", sets: [{ reps: 5, weightLb: 100 }] },
        ],
      }),
    ).rejects.toThrow(/80 characters/);
    expect(await asUser.query(api.sets.listForSession, { sessionId })).toEqual([]);
    expect((await asUser.query(api.sessions.getOpen, {}))?.note).toBeNull();

    const saved = await asUser.mutation(api.sets.logWorkout, {
      sessionId,
      note: "felt good",
      exercises: [
        { exerciseName: "bench press", sets: [{ reps: 5, weightLb: 135, rpe: 8 }] },
        { exerciseName: "plank", sets: [{ weightLb: 0, durationSec: 60 }] },
        { exerciseName: "row", sets: [{ weightLb: 0, distanceM: 2000, durationSec: 480 }] },
      ],
    });
    expect(saved.setIds).toHaveLength(3);
    const sets = await asUser.query(api.sets.listForSession, { sessionId });
    expect(sets.map((set) => set.exerciseName)).toEqual(["bench press", "plank", "row"]);
    expect(sets[1]).toMatchObject({ reps: null, durationSec: 60, distanceM: null, weightLb: 0 });
    expect(sets[2]).toMatchObject({ reps: null, distanceM: 2000, durationSec: 480 });
    expect(sets[0]?.rpe).toBe(8);
    expect((await asUser.query(api.sessions.getOpen, {}))?.note).toBe("felt good");

    await asUser.mutation(api.sessions.complete, { sessionId });
    const finished = await asUser.query(api.sessions.get, { sessionId });
    expect(finished?.note).toBe("felt good");
    await asUser.mutation(api.sessions.setNote, { sessionId, note: "  revised  " });
    expect((await asUser.query(api.sessions.get, { sessionId }))?.note).toBe("revised");

    const week = weekRange(Date.now(), 1);
    const summary = await asUser.query(api.sessions.weeklySummary, {
      weekStarts: week.weekStarts,
      weekEndsAt: week.weekEndsAt,
    });
    expect(summary.sets).toBe(3);
    expect(summary.volumeLb).toBe(675);
  });

  test("a set saved before the new fields still reads", async () => {
    const t = testBackend();
    const { userId, asUser } = await signIn(t, "Michael");
    const sessionId = await asUser.mutation(api.sessions.start, {});
    await t.run(async (ctx) => {
      const exerciseId = await ctx.db.insert("exercises", {
        userId,
        name: "bench press",
        normalizedName: "bench press",
        createdAt: 1,
      });
      await ctx.db.insert("sets", {
        userId,
        sessionId,
        exerciseId,
        reps: 5,
        weightLb: 135,
        loggedAt: 1,
      });
    });
    const [set] = await asUser.query(api.sets.listForSession, { sessionId });
    expect(set).toMatchObject({
      reps: 5,
      weightLb: 135,
      durationSec: null,
      distanceM: null,
      rpe: null,
    });
  });
});

describe("rename and merge", () => {
  test("renaming onto another exercise waits, then a merge moves every set", async () => {
    const t = testBackend();
    const { asUser } = await signIn(t, "Michael");
    const other = await signIn(t, "Other");
    const sessionId = await asUser.mutation(api.sessions.start, {});
    await asUser.mutation(api.sets.log, {
      sessionId,
      exerciseName: "bench press",
      reps: 5,
      weightLb: 135,
    });
    await asUser.mutation(api.sets.log, {
      sessionId,
      exerciseName: "benchpress",
      reps: 3,
      weightLb: 185,
    });

    const library = await asUser.query(api.exercises.list, {});
    const kept = library.exercises.find((exercise) => exercise.name === "bench press");
    const extra = library.exercises.find((exercise) => exercise.name === "benchpress");
    if (!kept || !extra) {
      throw new Error("expected both exercises");
    }

    const renamed = await asUser.mutation(api.exercises.rename, {
      exerciseId: kept._id,
      name: "Bench Press",
    });
    expect(renamed).toEqual({ status: "renamed", name: "Bench Press" });

    const conflict = await asUser.mutation(api.exercises.rename, {
      exerciseId: extra._id,
      name: "bench press",
    });
    expect(conflict).toMatchObject({
      status: "conflict",
      intoId: kept._id,
      fromName: "benchpress",
      setCount: 1,
      setCountCapped: false,
    });
    const stillTwo = await asUser.query(api.exercises.list, {});
    expect(stillTwo.exercises).toHaveLength(2);
    expect(stillTwo.exercises.map((exercise) => exercise.name)).toEqual(
      expect.arrayContaining(["Bench Press", "benchpress"]),
    );

    await expect(
      other.asUser.mutation(api.exercises.merge, { fromId: extra._id, intoId: kept._id }),
    ).rejects.toThrow(/not found/i);
    await expect(
      other.asUser.mutation(api.exercises.rename, { exerciseId: extra._id, name: "nope" }),
    ).rejects.toThrow(/not found/i);

    const merged = await asUser.mutation(api.exercises.merge, {
      fromId: extra._id,
      intoId: kept._id,
    });
    expect(merged).toEqual({ moved: 1, name: "Bench Press" });
    const after = await asUser.query(api.exercises.list, {});
    expect(after.exercises.map((exercise) => exercise.name)).toEqual(["Bench Press"]);

    const detail = await asUser.query(api.exercises.detail, { exerciseId: kept._id });
    expect(detail?.bestWeight?.weightLb).toBe(185);
    const page = await asUser.query(api.exercises.browse, {
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(page.page).toEqual([
      expect.objectContaining({ name: "Bench Press", setCount: 2, setCountCapped: false }),
    ]);
    const history = await asUser.query(api.exercises.history, {
      exerciseId: kept._id,
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(history.page.map((set) => set.weightLb).sort()).toEqual([135, 185]);
  });
});
