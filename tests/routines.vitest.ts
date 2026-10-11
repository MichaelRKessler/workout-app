/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");

function testBackend() {
  return convexTest(schema, modules);
}

async function signIn(
  t: ReturnType<typeof testBackend>,
  name: string,
  options?: { allow?: boolean },
) {
  const email = `${name.toLowerCase().replace(/[^a-z0-9]+/g, ".")}.user@example.com`;
  const userId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("users", { name, email });
    if (options?.allow !== false) {
      await ctx.db.insert("allowedEmails", {
        email,
        createdAt: Date.now(),
      });
    }
    return id;
  });
  return {
    userId,
    email,
    asUser: t.withIdentity({ subject: `${userId}|${name}-session` }),
  };
}

async function finishWorkout(
  t: ReturnType<typeof testBackend>,
  asUser: Awaited<ReturnType<typeof signIn>>["asUser"],
  sets: Array<{
    exerciseName: string;
    reps?: number;
    weightLb: number;
    durationSec?: number;
    distanceM?: number;
    loggedAt?: number;
  }>,
) {
  const sessionId = await asUser.mutation(api.sessions.start, {});
  for (const set of sets) {
    const saved = await asUser.mutation(api.sets.log, {
      sessionId,
      exerciseName: set.exerciseName,
      weightLb: set.weightLb,
      ...(set.reps !== undefined ? { reps: set.reps } : {}),
      ...(set.durationSec !== undefined ? { durationSec: set.durationSec } : {}),
      ...(set.distanceM !== undefined ? { distanceM: set.distanceM } : {}),
    });
    if (set.loggedAt !== undefined) {
      await t.run(async (ctx) => {
        await ctx.db.patch("sets", saved.setId, { loggedAt: set.loggedAt });
      });
    }
  }
  await asUser.mutation(api.sessions.complete, { sessionId });
  return sessionId;
}

describe("saved routines", () => {
  test("rejects a signed-out caller and a signed-in email that is not allowed", async () => {
    const t = testBackend();
    await expect(t.query(api.routines.list, {})).rejects.toThrow("Not authenticated");
    const blocked = await signIn(t, "Blocked", { allow: false });
    await expect(blocked.asUser.query(api.routines.list, {})).rejects.toThrow(
      "don't have access",
    );
    await expect(
      blocked.asUser.mutation(api.routines.create, {
        name: "Push day",
        exercises: [{ name: "Bench press" }],
      }),
    ).rejects.toThrow("don't have access");
  });

  test("saves, renames, reorders, and deletes only the owner's routines", async () => {
    const t = testBackend();
    const michael = await signIn(t, "Michael");
    const other = await signIn(t, "Someone else");

    const push = await michael.asUser.mutation(api.routines.create, {
      name: "  Push   day ",
      exercises: [
        { name: "Bench press", targetSets: 3, targetReps: 10, targetWeightLb: 135 },
        { name: "Push-ups", targetSets: 3, targetReps: 15, targetWeightLb: 0 },
      ],
    });
    const legs = await michael.asUser.mutation(api.routines.create, {
      name: "Leg day",
      exercises: [{ name: "Squat", targetSets: 5, targetReps: 5, targetWeightLb: 225 }],
    });

    const listed = await michael.asUser.query(api.routines.list, {});
    expect(listed.map((routine) => routine.name)).toEqual(["Push day", "Leg day"]);
    expect(listed[0]?.exercises[0]).toMatchObject({
      name: "Bench press",
      targetSets: 3,
      targetReps: 10,
      targetWeightLb: 135,
    });

    await michael.asUser.mutation(api.routines.reorder, { routineIds: [legs, push] });
    expect(
      (await michael.asUser.query(api.routines.list, {})).map((routine) => routine.name),
    ).toEqual(["Leg day", "Push day"]);

    const benchId = listed[0]?.exercises[0]?.exerciseId;
    if (!benchId) {
      throw new Error("Expected bench press");
    }
    await michael.asUser.mutation(api.exercises.rename, {
      exerciseId: benchId,
      name: "Flat bench",
    });
    const renamed = await michael.asUser.query(api.routines.get, { routineId: push });
    expect(renamed?.exercises[0]).toMatchObject({
      exerciseId: benchId,
      name: "Flat bench",
    });

    expect(await other.asUser.query(api.routines.list, {})).toEqual([]);
    expect(await other.asUser.query(api.routines.get, { routineId: push })).toBeNull();
    await expect(
      other.asUser.mutation(api.routines.update, {
        routineId: push,
        name: "Stolen",
        exercises: [{ name: "Curl" }],
      }),
    ).rejects.toThrow("Routine not found");
    await expect(
      other.asUser.mutation(api.routines.remove, { routineId: push }),
    ).rejects.toThrow("Routine not found");

    await michael.asUser.mutation(api.routines.remove, { routineId: push });
    expect(await michael.asUser.query(api.routines.get, { routineId: push })).toBeNull();
    expect(await michael.asUser.query(api.routines.list, {})).toHaveLength(1);
  });

  test("starting a routine while a workout is open does not create a second one", async () => {
    const t = testBackend();
    const { asUser } = await signIn(t, "Michael");
    const openId = await asUser.mutation(api.sessions.start, {});
    const routineId = await asUser.mutation(api.routines.create, {
      name: "Push day",
      exercises: [{ name: "Bench press", targetSets: 3, targetReps: 10, targetWeightLb: 135 }],
    });

    const blocked = await asUser.mutation(api.routines.begin, { routineId });
    expect(blocked).toEqual({ status: "alreadyOpen", sessionId: openId });
    const stillOpen = await asUser.query(api.sessions.getOpen, {});
    expect(stillOpen?._id).toBe(openId);
    expect(stillOpen?.plan).toEqual([]);
    expect(stillOpen?.routineId).toBeNull();

    await asUser.mutation(api.sessions.discard, { sessionId: openId });
    const started = await asUser.mutation(api.routines.begin, { routineId });
    expect(started.status).toBe("started");
    if (started.status !== "started") {
      return;
    }
    const workout = await asUser.query(api.sessions.getOpen, {});
    expect(workout?._id).toBe(started.sessionId);
    expect(workout?.planName).toBe("Push day");
    expect(workout?.routineId).toBe(routineId);
    expect(workout?.plan).toMatchObject([
      {
        name: "Bench press",
        targetSets: 3,
        targetReps: 10,
        targetWeightLb: 135,
        skipped: false,
      },
    ]);

    const again = await asUser.mutation(api.routines.begin, { routineId });
    expect(again).toEqual({ status: "alreadyOpen", sessionId: started.sessionId });
    expect((await asUser.query(api.sessions.getOpen, {}))?._id).toBe(started.sessionId);
  });

  test("repeat copies exercises without saving a routine, and leaves an open workout alone", async () => {
    const t = testBackend();
    const { asUser } = await signIn(t, "Michael");
    const finished = await finishWorkout(t, asUser, [
      { exerciseName: "Squat", reps: 5, weightLb: 225, loggedAt: 1_000 },
      { exerciseName: "Squat", reps: 5, weightLb: 225, loggedAt: 2_000 },
      { exerciseName: "Plank", weightLb: 0, durationSec: 60, loggedAt: 3_000 },
    ]);

    const openId = await asUser.mutation(api.sessions.start, {});
    const blocked = await asUser.mutation(api.sessions.repeat, { sessionIds: [finished] });
    expect(blocked).toEqual({ status: "alreadyOpen", sessionId: openId });
    expect((await asUser.query(api.sessions.getOpen, {}))?.plan).toEqual([]);

    await asUser.mutation(api.sessions.discard, { sessionId: openId });
    const started = await asUser.mutation(api.sessions.repeat, { sessionIds: [finished] });
    expect(started.status).toBe("started");
    const workout = await asUser.query(api.sessions.getOpen, {});
    expect(workout?.routineId).toBeNull();
    expect(workout?.planName).toBeNull();
    expect(workout?.plan.map((item) => item.name)).toEqual(["Squat", "Plank"]);
    expect(workout?.plan[0]).toMatchObject({
      targetSets: 2,
      targetReps: 5,
      targetWeightLb: 225,
    });
    expect(workout?.plan[1]).toMatchObject({ targetSets: 1, targetDurationSec: 60 });
    expect(await asUser.query(api.routines.list, {})).toEqual([]);
  });

  test("save as routine keeps a uniform target and only a count when sets differ", async () => {
    const t = testBackend();
    const { asUser } = await signIn(t, "Michael");
    const morning = await finishWorkout(t, asUser, [
      { exerciseName: "Bench press", reps: 10, weightLb: 135, loggedAt: 1_000 },
      { exerciseName: "Bench press", reps: 10, weightLb: 135, loggedAt: 2_000 },
      { exerciseName: "Bench press", reps: 8, weightLb: 155, loggedAt: 3_000 },
    ]);
    const evening = await finishWorkout(t, asUser, [
      { exerciseName: "Row", weightLb: 0, distanceM: 2000, durationSec: 480, loggedAt: 4_000 },
    ]);

    const mixed = await asUser.mutation(api.routines.createFromSessions, {
      name: "Sunday",
      sessionIds: [evening, morning],
    });
    const routine = await asUser.query(api.routines.get, { routineId: mixed });
    expect(routine?.exercises.map((exercise) => exercise.name)).toEqual(["Bench press", "Row"]);
    expect(routine?.exercises[0]).toMatchObject({ targetSets: 3 });
    expect(routine?.exercises[0]?.targetReps).toBeNull();
    expect(routine?.exercises[0]?.targetWeightLb).toBeNull();
    expect(routine?.exercises[1]).toMatchObject({
      targetSets: 1,
      targetDistanceM: 2000,
      targetDurationSec: 480,
    });
  });

  test("merging exercises rewrites routines and the open plan", async () => {
    const t = testBackend();
    const { asUser } = await signIn(t, "Michael");
    const routineId = await asUser.mutation(api.routines.create, {
      name: "Push day",
      exercises: [
        { name: "Bench press", targetSets: 3, targetReps: 10, targetWeightLb: 135 },
        { name: "Flat bench", targetSets: 3, targetReps: 8, targetWeightLb: 155 },
      ],
    });
    const before = await asUser.query(api.routines.get, { routineId });
    const kept = before?.exercises[0];
    const dropped = before?.exercises[1];
    if (!kept || !dropped) {
      throw new Error("Expected two exercises");
    }

    const started = await asUser.mutation(api.routines.begin, { routineId });
    expect(started.status).toBe("started");
    await asUser.mutation(api.exercises.merge, {
      fromId: dropped.exerciseId,
      intoId: kept.exerciseId,
    });

    const after = await asUser.query(api.routines.get, { routineId });
    expect(after?.exercises).toMatchObject([
      {
        exerciseId: kept.exerciseId,
        name: "Bench press",
        targetReps: 10,
        targetWeightLb: 135,
      },
    ]);
    const open = await asUser.query(api.sessions.getOpen, {});
    expect(open?.plan.map((item) => item.exerciseId)).toEqual([kept.exerciseId]);
    expect(open?.plan[0]?.targetReps).toBe(10);
  });

  test("an older open session without a plan still loads", async () => {
    const t = testBackend();
    const { userId, asUser } = await signIn(t, "Michael");
    await t.run(async (ctx) => {
      await ctx.db.insert("sessions", {
        userId,
        status: "open",
        startedAt: Date.now(),
      });
    });
    const open = await asUser.query(api.sessions.getOpen, {});
    expect(open?.plan).toEqual([]);
    expect(open?.planName).toBeNull();
    expect(open?.routineId).toBeNull();
  });

  test("a superset survives begin and repeat, and a lone label is dropped", async () => {
    const t = testBackend();
    const { asUser } = await signIn(t, "Michael");
    const routineId = await asUser.mutation(api.routines.create, {
      name: "Arms",
      exercises: [
        { name: "Curl", targetSets: 3, targetReps: 12, supersetId: "arms" },
        { name: "Pushdown", targetSets: 3, targetReps: 12, supersetId: "arms" },
        { name: "Shrug", supersetId: "alone" },
      ],
    });
    const saved = await asUser.query(api.routines.get, { routineId });
    expect(saved?.exercises.map((exercise) => exercise.supersetId)).toEqual(["arms", "arms", null]);

    const started = await asUser.mutation(api.routines.begin, { routineId });
    expect(started.status).toBe("started");
    const open = await asUser.query(api.sessions.getOpen, {});
    expect(open?.plan.map((item) => [item.name, item.supersetId])).toEqual([
      ["Curl", "arms"],
      ["Pushdown", "arms"],
      ["Shrug", null],
    ]);
    if (!open) {
      throw new Error("Expected an open workout");
    }
    await asUser.mutation(api.sets.log, {
      sessionId: open._id,
      exerciseName: "Curl",
      reps: 12,
      weightLb: 30,
    });
    await asUser.mutation(api.sets.log, {
      sessionId: open._id,
      exerciseName: "Pushdown",
      reps: 12,
      weightLb: 50,
    });
    await asUser.mutation(api.sessions.complete, { sessionId: open._id });

    const again = await asUser.mutation(api.sessions.repeat, { sessionIds: [open._id] });
    expect(again.status).toBe("started");
    const repeated = await asUser.query(api.sessions.getOpen, {});
    const grouped = (repeated?.plan ?? []).filter((item) => item.name !== "Shrug");
    expect(grouped.map((item) => item.name)).toEqual(["Curl", "Pushdown"]);
    expect(grouped[0]?.supersetId).toBeTruthy();
    expect(grouped[0]?.supersetId).toBe(grouped[1]?.supersetId);
  });
});
