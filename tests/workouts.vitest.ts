/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");

function testBackend() {
  return convexTest(schema, modules);
}

async function signIn(t: ReturnType<typeof testBackend>, name: string) {
  const userId = await t.run(async (ctx) => {
    return await ctx.db.insert("users", { name });
  });
  return t.withIdentity({ subject: `${userId}|${name}-session` });
}

describe("workout log", () => {
  test("saves sets for new and existing exercises and reads them back", async () => {
    const asUser = await signIn(testBackend(), "Michael");
    const sessionId = await asUser.mutation(api.sessions.start, {});
    await asUser.mutation(api.sets.log, {
      sessionId,
      exerciseName: "  Push-ups ",
      reps: 15,
      weightLb: 0,
    });
    await asUser.mutation(api.sets.log, {
      sessionId,
      exerciseName: "bench press",
      reps: 8,
      weightLb: 135,
    });
    await asUser.mutation(api.sets.log, {
      sessionId,
      exerciseName: "Bench press",
      reps: 6,
      weightLb: 155.5,
    });

    const open = await asUser.query(api.sessions.getOpen, {});
    const logged = await asUser.query(api.sets.listForSession, { sessionId });
    expect(open?._id).toBe(sessionId);
    expect(logged.map((set) => set.exerciseName)).toEqual([
      "Push-ups",
      "bench press",
      "bench press",
    ]);
    expect(logged[2]?.weightLb).toBe(155.5);

    await asUser.mutation(api.sessions.complete, { sessionId });

    const history = await asUser.query(api.sessions.listHistory, {
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(history.page).toHaveLength(1);
    const bench = history.page[0]?.exercises.find(
      (exercise) => exercise.name === "bench press",
    );
    expect(bench?.setCount).toBe(2);
    expect(history.page[0]?.exercises.some((exercise) => exercise.name === "Push-ups")).toBe(
      true,
    );

    const detail = await asUser.query(api.sessions.get, { sessionId });
    expect(detail?.status).toBe("completed");
    expect(detail?.sets).toHaveLength(3);
    expect(await asUser.query(api.sessions.getOpen, {})).toBeNull();
  });

  test("does not show another person's workout", async () => {
    const t = testBackend();
    const owner = await signIn(t, "Michael");
    const sessionId = await owner.mutation(api.sessions.start, {});
    await owner.mutation(api.sets.log, {
      sessionId,
      exerciseName: "Push-ups",
      reps: 10,
      weightLb: 0,
    });
    await owner.mutation(api.sessions.complete, { sessionId });
    const [logged] = await owner.query(api.sets.listForSession, { sessionId });
    if (!logged) {
      throw new Error("Expected a logged set");
    }

    const other = await signIn(t, "Someone else");
    expect(await other.query(api.sessions.get, { sessionId })).toBeNull();
    const history = await other.query(api.sessions.listHistory, {
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(history.page).toHaveLength(0);
    await expect(
      other.mutation(api.sets.remove, { setId: logged._id }),
    ).rejects.toThrow("Set not found");
  });

  test("requires sign-in", async () => {
    const t = convexTest(schema, modules);
    await expect(t.mutation(api.sessions.start, {})).rejects.toThrow(
      "Not authenticated",
    );
  });
});
