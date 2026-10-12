/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");
const HOUR = 60 * 60 * 1000;

function testBackend() {
  return convexTest(schema, modules);
}

async function signIn(t: ReturnType<typeof testBackend>, name: string) {
  const email = `${name.toLowerCase().replace(/[^a-z0-9]+/g, ".")}.records@example.com`;
  const userId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("users", { name, email });
    await ctx.db.insert("allowedEmails", { email, createdAt: Date.now() });
    return id;
  });
  return t.withIdentity({ subject: `${userId}|${name}-session` });
}

describe("personal records follow the set's own time", () => {
  test("a past workout can be a record even when a later workout is heavier", async () => {
    const t = testBackend();
    const asUser = await signIn(t, "Michael");
    const later = Date.UTC(2026, 0, 10, 16, 0, 0);
    const earlier = Date.UTC(2024, 5, 15, 16, 0, 0);

    await asUser.mutation(api.sessions.logPast, {
      startedAt: later,
      exercises: [{ name: "bench press", sets: [{ reps: 5, weightLb: 200 }] }],
    });
    const past = await asUser.mutation(api.sessions.logPast, {
      startedAt: earlier,
      exercises: [{ name: "bench press", sets: [{ reps: 5, weightLb: 135 }] }],
    });
    expect(past.personalRecords).toEqual([
      expect.objectContaining({ exerciseName: "bench press", kind: "both", weightLb: 135 }),
    ]);

    const day = await asUser.query(api.sessions.listDay, {
      startedFrom: earlier - HOUR,
      startedUntil: earlier + HOUR,
    });
    expect(day.personalRecords).toEqual([
      expect.objectContaining({ exerciseName: "bench press", kind: "both", weightLb: 135 }),
    ]);

    const added = await asUser.mutation(api.sets.log, {
      sessionId: past.sessionId,
      exerciseName: "bench press",
      reps: 5,
      weightLb: 150,
    });
    expect(added.personalRecord).toEqual(
      expect.objectContaining({ exerciseName: "bench press", weightLb: 150 }),
    );
  });

  test("fixing RPE on the current best does not announce it again", async () => {
    const t = testBackend();
    const asUser = await signIn(t, "Michael");
    const sessionId = await asUser.mutation(api.sessions.start, {});
    const saved = await asUser.mutation(api.sets.log, {
      sessionId,
      exerciseName: "bench press",
      reps: 5,
      weightLb: 200,
    });
    await asUser.mutation(api.sessions.complete, { sessionId });

    const same = await asUser.mutation(api.sets.update, {
      setId: saved.setId,
      reps: 5,
      weightLb: 200,
      rpe: 9,
    });
    expect(same).toBeNull();

    const raised = await asUser.mutation(api.sets.update, {
      setId: saved.setId,
      reps: 5,
      weightLb: 225,
    });
    expect(raised).toEqual(expect.objectContaining({ kind: "both", weightLb: 225 }));
  });
});
