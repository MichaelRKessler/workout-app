/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");

function testBackend() {
  return convexTest(schema, modules);
}

async function signIn(t: ReturnType<typeof testBackend>, name: string) {
  const email = `${name.toLowerCase().replace(/[^a-z0-9]+/g, ".")}.stats@example.com`;
  const userId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("users", { name, email });
    await ctx.db.insert("allowedEmails", { email, createdAt: Date.now() });
    return id;
  });
  return { userId, asUser: t.withIdentity({ subject: `${userId}|${name}-session` }) };
}

async function drain(t: ReturnType<typeof testBackend>) {
  vi.useFakeTimers();
  try {
    await t.mutation(internal.exerciseStats.backfillTick, {});
    await t.finishAllScheduledFunctions(() => {
      vi.runAllTimers();
    });
  } finally {
    vi.useRealTimers();
  }
}

describe("exercise stats", () => {
  test("an append uses the stored best, and removing it restores the earlier one", async () => {
    const t = testBackend();
    const { asUser } = await signIn(t, "Michael");
    const sessionId = await asUser.mutation(api.sessions.start, {});
    const first = await asUser.mutation(api.sets.log, {
      sessionId,
      exerciseName: "bench press",
      reps: 5,
      weightLb: 135,
    });
    expect(first.personalRecord).toEqual(expect.objectContaining({ kind: "both", weightLb: 135 }));

    const raised = await asUser.mutation(api.sets.log, {
      sessionId,
      exerciseName: "bench press",
      reps: 5,
      weightLb: 185,
    });
    expect(raised.personalRecord).toEqual(expect.objectContaining({ kind: "both", weightLb: 185 }));

    const exerciseId = await t.run(async (ctx) => {
      const exercise = await ctx.db.query("exercises").first();
      return exercise?._id ?? null;
    });
    expect(exerciseId).not.toBeNull();
    const before = await asUser.query(api.exercises.detail, { exerciseId: exerciseId ?? "" });
    expect(before?.recordsComplete).toBe(true);
    expect(before?.bestWeight?.weightLb).toBe(185);

    await asUser.mutation(api.sets.remove, { setId: raised.setId });
    await drain(t);
    const after = await asUser.query(api.exercises.detail, { exerciseId: exerciseId ?? "" });
    expect(after?.recordsComplete).toBe(true);
    expect(after?.bestWeight?.weightLb).toBe(135);
  });

  test(
    "a best older than the newest 2000 sets still blocks a lighter record",
    async () => {
      const t = testBackend();
      const { userId, asUser } = await signIn(t, "Pat");
      const seeded = await t.run(async (ctx) => {
        const exerciseId = await ctx.db.insert("exercises", {
          userId,
          name: "Bench Press",
          normalizedName: "bench press",
          createdAt: 1,
        });
        const heavySession = await ctx.db.insert("sessions", {
          userId,
          status: "completed",
          startedAt: 1_000,
          completedAt: 2_000,
          setCount: 1,
          lastSetAt: 1_000,
        });
        const heavySetId = await ctx.db.insert("sets", {
          userId,
          sessionId: heavySession,
          exerciseId,
          reps: 5,
          weightLb: 315,
          loggedAt: 1_000,
        });
        const perSession = 250;
        const sessions = 8;
        for (let sessionIndex = 0; sessionIndex < sessions; sessionIndex += 1) {
          const startedAt = 10_000 + sessionIndex * 1_000;
          const sessionId = await ctx.db.insert("sessions", {
            userId,
            status: "completed",
            startedAt,
            completedAt: startedAt + 1,
            setCount: perSession,
            lastSetAt: startedAt + perSession,
          });
          for (let index = 0; index < perSession; index += 1) {
            await ctx.db.insert("sets", {
              userId,
              sessionId,
              exerciseId,
              reps: 8,
              weightLb: 135,
              loggedAt: startedAt + index + 1,
            });
          }
        }
        return { exerciseId, heavySetId };
      });

      await drain(t);

      const ready = await t.run(async (ctx) => {
        return await ctx.db
          .query("exerciseStats")
          .withIndex("by_user_and_exercise", (q) => q.eq("userId", userId).eq("exerciseId", seeded.exerciseId))
          .unique();
      });
      expect(ready?.ready).toBe(true);
      expect(ready?.setCount).toBe(2001);
      expect(ready?.bestWeight?.weightLb).toBe(315);

      await drain(t);
      const again = await t.run(async (ctx) => {
        return await ctx.db
          .query("exerciseStats")
          .withIndex("by_user_and_exercise", (q) => q.eq("userId", userId).eq("exerciseId", seeded.exerciseId))
          .unique();
      });
      expect(again?.setCount).toBe(2001);
      expect(again?.generation).toBe(ready?.generation);

      await t.mutation(internal.exerciseStats.rebuildPage, {
        userId,
        exerciseId: seeded.exerciseId,
        generation: (ready?.generation ?? 1) + 50,
        cursor: null,
      });
      const ignored = await t.run(async (ctx) => {
        return await ctx.db
          .query("exerciseStats")
          .withIndex("by_user_and_exercise", (q) => q.eq("userId", userId).eq("exerciseId", seeded.exerciseId))
          .unique();
      });
      expect(ignored?.setCount).toBe(2001);

      const sessionId = await asUser.mutation(api.sessions.start, {});
      const logged = await asUser.mutation(api.sets.log, {
        sessionId,
        exerciseName: "bench press",
        reps: 5,
        weightLb: 185,
      });
      expect(logged.personalRecord).toBeNull();

      const detail = await asUser.query(api.exercises.detail, { exerciseId: seeded.exerciseId });
      expect(detail?.recordsComplete).toBe(true);
      expect(detail?.bestWeight?.weightLb).toBe(315);
      expect(detail?.truncated).toBe(true);

      await asUser.mutation(api.sets.remove, { setId: seeded.heavySetId });
      await drain(t);
      const after = await asUser.query(api.exercises.detail, { exerciseId: seeded.exerciseId });
      expect(after?.recordsComplete).toBe(true);
      expect(after?.bestWeight?.weightLb).toBe(185);
    },
    60_000,
  );
});
