/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");

async function signIn(t: ReturnType<typeof convexTest>, name: string) {
  const email = `${name.toLowerCase()}.user@example.com`;
  const userId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("users", { name, email });
    await ctx.db.insert("allowedEmails", { email, createdAt: Date.now() });
    return id;
  });
  return t.withIdentity({ subject: `${userId}|${name}-session` });
}

async function lift(
  asUser: Awaited<ReturnType<typeof signIn>>,
  sets: Array<{ reps: number; weightLb: number }>,
) {
  const sessionId = await asUser.mutation(api.sessions.start, {});
  for (const set of sets) {
    await asUser.mutation(api.sets.log, { sessionId, exerciseName: "Back Squat", ...set });
  }
  await asUser.mutation(api.sessions.complete, { sessionId });
  return sessionId;
}

describe("workout recap", () => {
  test("celebrates more reps at a load and names the exercise", async () => {
    const t = convexTest(schema, modules);
    const asUser = await signIn(t, "Lifter");
    await lift(asUser, [
      { reps: 5, weightLb: 225 },
      { reps: 5, weightLb: 225 },
    ]);
    const second = await lift(asUser, [
      { reps: 7, weightLb: 225 },
      { reps: 5, weightLb: 225 },
    ]);

    const result = await asUser.query(api.recap.forSession, { sessionId: second, utcOffsetMinutes: 0 });
    expect(result?.recap.confetti).toBe(true);
    const reps = result?.recap.celebrations.find((item) => item.kind === "repsAtWeight");
    expect(reps).toMatchObject({ weightLb: 225, reps: 7, previousReps: 5 });
    if (reps && "exerciseId" in reps) {
      expect(result?.exerciseNames[reps.exerciseId]).toBe("Back Squat");
    }
  });

  test("returns nothing for another person's workout or an open one", async () => {
    const t = convexTest(schema, modules);
    const owner = await signIn(t, "Owner");
    const other = await signIn(t, "Other");
    const done = await lift(owner, [{ reps: 5, weightLb: 135 }]);
    expect(await other.query(api.recap.forSession, { sessionId: done, utcOffsetMinutes: 0 })).toBeNull();

    const open = await owner.mutation(api.sessions.start, {});
    expect(await owner.query(api.recap.forSession, { sessionId: open, utcOffsetMinutes: 0 })).toBeNull();
    expect(await owner.query(api.recap.forSession, { sessionId: "nope", utcOffsetMinutes: 0 })).toBeNull();
  });
});
