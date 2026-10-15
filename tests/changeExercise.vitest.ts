/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";
import { api } from "../convex/_generated/api";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");

async function signIn(t: ReturnType<typeof convexTest>, name: string) {
  const email = `${name.toLowerCase().replace(/[^a-z0-9]+/g, ".")}.change@example.com`;
  const userId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("users", { name, email });
    await ctx.db.insert("allowedEmails", { email, createdAt: Date.now() });
    return id;
  });
  return t.withIdentity({ subject: `${userId}|${name}-session` });
}

describe("changing the exercise on a finished workout", () => {
  test("moves that workout's sets only, and the plan follows", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const asUser = await signIn(t, "Michael");
    const other = await signIn(t, "Someone else");
    const day = 24 * 60 * 60 * 1000;
    const earlier = await asUser.mutation(api.sessions.logPast, {
      startedAt: Date.now() - 2 * day,
      exercises: [{ name: "Chin up", sets: [{ reps: 5, weightLb: 0 }] }],
    });
    const later = await asUser.mutation(api.sessions.logPast, {
      startedAt: Date.now() - day,
      exercises: [
        { name: "Chin up", sets: [{ reps: 6, weightLb: 0 }, { reps: 5, weightLb: 0 }] },
        { name: "Dip", sets: [{ reps: 10, weightLb: 0 }] },
      ],
    });
    const before = await asUser.query(api.sessions.get, { sessionId: later.sessionId });
    const chinIds = (before?.sets ?? [])
      .filter((set) => set.exerciseName === "Chin up")
      .map((set) => set._id);
    expect(chinIds).toHaveLength(2);

    await expect(
      other.mutation(api.sets.changeExercise, { setIds: chinIds, exerciseName: "Pull up" }),
    ).rejects.toThrow(/not found/i);

    const changed = await asUser.mutation(api.sets.changeExercise, {
      setIds: chinIds,
      exerciseName: "Pull up",
    });
    expect(changed).toEqual({ exerciseName: "Pull up", merged: false });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const after = await asUser.query(api.sessions.get, { sessionId: later.sessionId });
    expect(after?.exercises.map((exercise) => exercise.name).sort()).toEqual(["Dip", "Pull up"]);
    const untouched = await asUser.query(api.sessions.get, { sessionId: earlier.sessionId });
    expect(untouched?.exercises.map((exercise) => exercise.name)).toEqual(["Chin up"]);

    // Back to an existing name joins that exercise instead of making a new one.
    await asUser.mutation(api.sets.changeExercise, { setIds: chinIds, exerciseName: "Chin up" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const library = await asUser.query(api.exercises.list, {});
    const chin = library.exercises.filter((exercise) => exercise.name === "Chin up");
    expect(chin).toHaveLength(1);

    const dipIds = (after?.sets ?? [])
      .filter((set) => set.exerciseName === "Dip")
      .map((set) => set._id);
    const joined = await asUser.mutation(api.sets.changeExercise, {
      setIds: dipIds,
      exerciseName: "chin up",
    });
    expect(joined).toEqual({ exerciseName: "Chin up", merged: true });
    await asUser.mutation(api.sets.changeExercise, { setIds: dipIds, exerciseName: "Dip" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const dipId = after?.sets.find((set) => set.exerciseName === "Dip")?._id;
    if (!dipId) {
      throw new Error("Expected a dip");
    }
    await expect(
      asUser.mutation(api.sets.changeExercise, {
        setIds: [chinIds[0]!, dipId],
        exerciseName: "Row",
      }),
    ).rejects.toThrow(/same exercise/i);
    vi.useRealTimers();
  });
});
