/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");

async function signIn(t: ReturnType<typeof convexTest>) {
  const email = "lifter.user@example.com";
  const userId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("users", { name: "Lifter", email });
    await ctx.db.insert("allowedEmails", { email, createdAt: Date.now() });
    return id;
  });
  return t.withIdentity({ subject: `${userId}|lifter-session` });
}

test("Next up follows the routine used last, then wraps to the first", async () => {
  const t = convexTest(schema, modules);
  const asUser = await signIn(t);
  expect(await asUser.query(api.routines.nextUp, {})).toBeNull();

  const push = await asUser.mutation(api.routines.create, { name: "Push", exercises: [{ name: "Bench press" }] });
  const pull = await asUser.mutation(api.routines.create, { name: "Pull", exercises: [{ name: "Row" }] });
  expect((await asUser.query(api.routines.nextUp, {}))?._id).toBe(push);

  for (const [routineId, next] of [
    [push, pull],
    [pull, push],
  ] as const) {
    const started = await asUser.mutation(api.routines.begin, { routineId });
    await asUser.mutation(api.sets.log, { sessionId: started.sessionId, exerciseName: "Plank", durationSec: 30 });
    await asUser.mutation(api.sessions.complete, { sessionId: started.sessionId });
    expect((await asUser.query(api.routines.nextUp, {}))?._id).toBe(next);
  }
});

test("the exercise list carries when each was last done and its best", async () => {
  const t = convexTest(schema, modules);
  const asUser = await signIn(t);
  const sessionId = await asUser.mutation(api.sessions.start, {});
  await asUser.mutation(api.sets.log, { sessionId, exerciseName: "Bench press", reps: 8, weightLb: 185 });
  await asUser.mutation(api.sets.log, { sessionId, exerciseName: "Bench press", reps: 5, weightLb: 200 });
  const page = await asUser.query(api.exercises.browse, { paginationOpts: { numItems: 10, cursor: null } });
  const bench = page.page.find((item) => item.name === "Bench press");
  expect(bench?.lastLoggedAt).toBeTypeOf("number");
  if (bench?.best) {
    expect(bench.best.epleyLb).toBeGreaterThan(200);
  }
});
