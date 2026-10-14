/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");

function testBackend() {
  return convexTest(schema, modules);
}

async function signIn(t: ReturnType<typeof testBackend>, name: string) {
  const email = `${name.toLowerCase()}.spelling@example.com`;
  const userId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("users", { name, email });
    await ctx.db.insert("allowedEmails", { email, createdAt: Date.now() });
    return id;
  });
  return { userId, asUser: t.withIdentity({ subject: `${userId}|${name}-session` }) };
}

/** An exercise saved before spelling variants matched, under its old key. */
async function insertLegacy(
  t: ReturnType<typeof testBackend>,
  userId: Id<"users">,
  sessionId: Id<"sessions">,
  name: string,
  sets: number,
) {
  return await t.run(async (ctx) => {
    const exerciseId = await ctx.db.insert("exercises", {
      userId,
      name,
      normalizedName: name.toLowerCase(),
      createdAt: Date.now(),
    });
    for (let index = 0; index < sets; index += 1) {
      await ctx.db.insert("sets", {
        userId,
        sessionId,
        exerciseId,
        reps: 10,
        weightLb: 0,
        loggedAt: Date.now() + index,
      });
    }
    return exerciseId;
  });
}

describe("spelling variants", () => {
  test("a set logged under another spelling joins the existing exercise", async () => {
    const t = testBackend();
    const { asUser } = await signIn(t, "Mike");
    const sessionId = await asUser.mutation(api.sessions.start, {});
    for (const exerciseName of ["Sit-ups", "Sit ups", "situp", "SIT-UP"]) {
      await asUser.mutation(api.sets.log, { sessionId, exerciseName, reps: 10, weightLb: 0 });
    }
    const library = await asUser.query(api.exercises.list, {});
    expect(library.exercises.map((exercise) => exercise.name)).toEqual(["Sit-ups"]);
    const previous = await asUser.query(api.sets.recentForExercise, { exerciseName: "sit ups" });
    expect(previous?.exerciseName).toBe("Sit-ups");
    expect(previous?.sets).toHaveLength(4);
  });

  test("an exercise saved under its old key still matches before the cleanup", async () => {
    const t = testBackend();
    const { userId, asUser } = await signIn(t, "Mike");
    const sessionId = await asUser.mutation(api.sessions.start, {});
    const legacyId = await insertLegacy(t, userId, sessionId, "Chin-up", 2);
    await asUser.mutation(api.sets.log, { sessionId, exerciseName: "chin-up", reps: 5, weightLb: 0 });
    await asUser.mutation(api.sets.log, { sessionId, exerciseName: "Chin ups", reps: 5, weightLb: 0 });
    const library = await asUser.query(api.exercises.list, {});
    expect(library.exercises.map((exercise) => exercise._id)).toEqual([legacyId]);
  });

  test("the cleanup merges old duplicates into the spelling with the most sets", async () => {
    const t = testBackend();
    const { userId, asUser } = await signIn(t, "Mike");
    const other = await signIn(t, "Other");
    const sessionId = await asUser.mutation(api.sessions.start, {});
    const otherSession = await other.asUser.mutation(api.sessions.start, {});
    await insertLegacy(t, userId, sessionId, "Sit ups", 3);
    const situps = await insertLegacy(t, userId, sessionId, "Sit-ups", 24);
    await insertLegacy(t, userId, sessionId, "Chin ups", 3);
    const chinup = await insertLegacy(t, userId, sessionId, "Chin-up", 10);
    const dips = await insertLegacy(t, userId, sessionId, "Dips", 4);
    const othersSitups = await insertLegacy(t, other.userId, otherSession, "Sit ups", 1);

    const plan = await t.query(internal.exercises.spellingVariants, {});
    const mine = plan.find((report) => report.userId === userId);
    expect(mine?.groups.map((group) => [group.keep.name, group.merge.map((item) => item.name)])).toEqual(
      expect.arrayContaining([
        ["Sit-ups", ["Sit ups"]],
        ["Chin-up", ["Chin ups"]],
      ]),
    );
    expect(mine?.groups).toHaveLength(2);
    expect(await asUser.query(api.exercises.list, {})).toMatchObject({
      exercises: expect.arrayContaining([expect.objectContaining({ name: "Sit ups" })]),
    });

    vi.useFakeTimers();
    try {
      await t.mutation(internal.exercises.mergeSpellingVariants, {});
      await t.finishAllScheduledFunctions(() => {
        vi.runAllTimers();
      });
    } finally {
      vi.useRealTimers();
    }

    const library = await asUser.query(api.exercises.list, {});
    expect(library.exercises.map((exercise) => exercise.name).sort()).toEqual([
      "Chin-up",
      "Dips",
      "Sit-ups",
    ]);
    const counts = await t.run(async (ctx) => {
      const count = async (exerciseId: Id<"exercises">) =>
        (
          await ctx.db
            .query("sets")
            .withIndex("by_user_exercise_and_logged", (q) =>
              q.eq("userId", userId).eq("exerciseId", exerciseId),
            )
            .collect()
        ).length;
      const keys = await Promise.all(
        [situps, chinup, dips, othersSitups].map(
          async (exerciseId) => (await ctx.db.get("exercises", exerciseId))?.normalizedName,
        ),
      );
      return { situps: await count(situps), chinup: await count(chinup), keys };
    });
    expect(counts).toEqual({ situps: 27, chinup: 13, keys: ["situp", "chinup", "dip", "situp"] });

    // The other person's exercise was rekeyed but nothing of theirs moved.
    const theirs = await other.asUser.query(api.exercises.list, {});
    expect(theirs.exercises.map((exercise) => exercise.name)).toEqual(["Sit ups"]);

    // Running it again has nothing left to do.
    expect(await t.query(internal.exercises.spellingVariants, {})).toEqual([]);
  });
});
