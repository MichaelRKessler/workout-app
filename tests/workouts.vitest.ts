/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { STALE_END_MARGIN_MS } from "../convex/lib/sessionTiming";
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

  test("an empty open workout can be discarded, and one with sets cannot", async () => {
    const t = testBackend();
    const asUser = await signIn(t, "Michael");
    const emptyId = await asUser.mutation(api.sessions.start, {});
    await asUser.mutation(api.sessions.discard, { sessionId: emptyId });
    expect(await asUser.query(api.sessions.getOpen, {})).toBeNull();

    const sessionId = await asUser.mutation(api.sessions.start, {});
    await asUser.mutation(api.sets.log, {
      sessionId,
      exerciseName: "Squat",
      reps: 5,
      weightLb: 225,
    });
    await expect(
      asUser.mutation(api.sessions.discard, { sessionId }),
    ).rejects.toThrow("Finish it instead");

    const other = await signIn(t, "Someone else");
    await expect(
      other.mutation(api.sessions.discard, { sessionId }),
    ).rejects.toThrow("Workout not found");

    await asUser.mutation(api.sessions.complete, { sessionId });
    await expect(
      asUser.mutation(api.sessions.discard, { sessionId }),
    ).rejects.toThrow("already finished");
  });

  test("requires sign-in", async () => {
    const t = convexTest(schema, modules);
    await expect(t.mutation(api.sessions.start, {})).rejects.toThrow(
      "Not authenticated",
    );
  });
});

const HOUR = 60 * 60 * 1000;

async function ageWorkout(
  t: ReturnType<typeof testBackend>,
  sessionId: Id<"sessions">,
  startedAt: number,
  loggedAt: number | null,
) {
  await t.run(async (ctx) => {
    await ctx.db.patch("sessions", sessionId, { startedAt });
    if (loggedAt === null) {
      return;
    }
    const sets = await ctx.db
      .query("sets")
      .withIndex("by_session_and_exercise", (q) => q.eq("sessionId", sessionId))
      .take(500);
    for (const set of sets) {
      await ctx.db.patch("sets", set._id, { loggedAt });
    }
  });
}

describe("saving and undoing a set list", () => {
  test("logMany writes every set or none, without an order field", async () => {
    const t = testBackend();
    const asUser = await signIn(t, "Michael");
    const sessionId = await asUser.mutation(api.sessions.start, {});

    await expect(
      asUser.mutation(api.sets.logMany, {
        sessionId,
        exerciseName: "squat",
        sets: [
          { reps: 5, weightLb: 100 },
          { reps: 0, weightLb: 100 },
        ],
      }),
    ).rejects.toThrow("Reps must be a whole number");
    expect(await asUser.query(api.sets.listForSession, { sessionId })).toHaveLength(0);

    await expect(
      asUser.mutation(api.sets.logMany, {
        sessionId,
        exerciseName: "   ",
        sets: [{ reps: 5, weightLb: 100 }],
      }),
    ).rejects.toThrow("Exercise name");
    expect(await asUser.query(api.sets.listForSession, { sessionId })).toHaveLength(0);

    const ids = await asUser.mutation(api.sets.logMany, {
      sessionId,
      exerciseName: "bench press",
      sets: [
        { reps: 10, weightLb: 135 },
        { reps: 8, weightLb: 155.555 },
        { reps: 6, weightLb: 165 },
      ],
    });
    expect(ids).toHaveLength(3);

    const listed = await asUser.query(api.sets.listForSession, { sessionId });
    expect(listed.map((set) => [set.reps, set.weightLb])).toEqual([
      [10, 135],
      [8, 155.56],
      [6, 165],
    ]);
    const stored = await t.run(async (ctx) => {
      return await Promise.all(ids.map(async (id) => await ctx.db.get("sets", id)));
    });
    expect(stored.map((set) => set?.order)).toEqual([undefined, undefined, undefined]);
    const times = stored.map((set) => set?.loggedAt ?? 0);
    expect(times[1]).toBe((times[0] ?? 0) + 1);
    expect(times[2]).toBe((times[0] ?? 0) + 2);

    const singleId = await asUser.mutation(api.sets.log, {
      sessionId,
      exerciseName: "bench press",
      reps: 4,
      weightLb: 175,
    });
    const single = await t.run(async (ctx) => await ctx.db.get("sets", singleId));
    expect(single?.order).toBeUndefined();

    await expect(
      t.mutation(api.sets.logMany, {
        sessionId,
        exerciseName: "bench press",
        sets: [{ reps: 5, weightLb: 100 }],
      }),
    ).rejects.toThrow("Not authenticated");
    await expect(
      t.mutation(api.sessions.keepGoing, { sessionId }),
    ).rejects.toThrow("Not authenticated");
    await expect(
      t.mutation(api.sets.removeMany, { setIds: ids }),
    ).rejects.toThrow("Not authenticated");

    const open = await asUser.query(api.sessions.getOpen, {});
    expect(open?.lastSetAt).toBe(single?.loggedAt);
    expect(open?.resumedAt).toBeNull();
  });

  test("a batch that would pass 500 sets saves nothing", async () => {
    const t = testBackend();
    const asUser = await signIn(t, "Michael");
    const sessionId = await asUser.mutation(api.sessions.start, {});
    await t.run(async (ctx) => {
      const session = await ctx.db.get("sessions", sessionId);
      if (!session) {
        throw new Error("Expected the open workout");
      }
      const exerciseId = await ctx.db.insert("exercises", {
        userId: session.userId,
        name: "squat",
        normalizedName: "squat",
        createdAt: 1,
      });
      for (let index = 0; index < 499; index += 1) {
        await ctx.db.insert("sets", {
          userId: session.userId,
          sessionId,
          exerciseId,
          reps: 5,
          weightLb: 100,
          order: index + 1,
          loggedAt: index + 1,
        });
      }
    });

    await expect(
      asUser.mutation(api.sets.logMany, {
        sessionId,
        exerciseName: "squat",
        sets: [
          { reps: 5, weightLb: 100 },
          { reps: 5, weightLb: 110 },
        ],
      }),
    ).rejects.toThrow("This workout already has 500 sets");
    expect(await asUser.query(api.sets.listForSession, { sessionId })).toHaveLength(499);

    await asUser.mutation(api.sets.log, {
      sessionId,
      exerciseName: "squat",
      reps: 3,
      weightLb: 115,
    });
    expect(await asUser.query(api.sets.listForSession, { sessionId })).toHaveLength(500);
    await expect(
      asUser.mutation(api.sets.log, {
        sessionId,
        exerciseName: "squat",
        reps: 3,
        weightLb: 115,
      }),
    ).rejects.toThrow("This workout already has 500 sets");
  });

  test("an old set document that still has order can be read", async () => {
    const t = testBackend();
    const asUser = await signIn(t, "Michael");
    const sessionId = await asUser.mutation(api.sessions.start, {});
    await t.run(async (ctx) => {
      const session = await ctx.db.get("sessions", sessionId);
      if (!session) {
        throw new Error("Expected the open workout");
      }
      const exerciseId = await ctx.db.insert("exercises", {
        userId: session.userId,
        name: "row",
        normalizedName: "row",
        createdAt: 1,
      });
      await ctx.db.insert("sets", {
        userId: session.userId,
        sessionId,
        exerciseId,
        reps: 12,
        weightLb: 70,
        order: 4,
        loggedAt: 50,
      });
    });
    await asUser.mutation(api.sets.log, {
      sessionId,
      exerciseName: "row",
      reps: 10,
      weightLb: 75,
    });

    const listed = await asUser.query(api.sets.listForSession, { sessionId });
    expect(listed.map((set) => set.reps)).toEqual([12, 10]);
    const legacy = await t.run(async (ctx) => {
      const sets = await ctx.db
        .query("sets")
        .withIndex("by_session_and_exercise", (q) => q.eq("sessionId", sessionId))
        .take(10);
      return sets.find((set) => set.reps === 12);
    });
    expect(legacy?.order).toBe(4);
  });

  test("removeMany deletes every set or none", async () => {
    const t = testBackend();
    const asUser = await signIn(t, "Michael");
    const sessionId = await asUser.mutation(api.sessions.start, {});
    const ids = await asUser.mutation(api.sets.logMany, {
      sessionId,
      exerciseName: "deadlift",
      sets: [
        { reps: 3, weightLb: 225 },
        { reps: 3, weightLb: 245 },
      ],
    });
    const first = ids[0];
    const second = ids[1];
    if (!first || !second) {
      throw new Error("Expected two sets");
    }

    const other = await signIn(t, "Someone else");
    const otherSession = await other.mutation(api.sessions.start, {});
    const otherSet = await other.mutation(api.sets.log, {
      sessionId: otherSession,
      exerciseName: "curl",
      reps: 8,
      weightLb: 30,
    });

    await expect(
      asUser.mutation(api.sets.removeMany, { setIds: [first, otherSet] }),
    ).rejects.toThrow("Set not found");
    expect(await asUser.query(api.sets.listForSession, { sessionId })).toHaveLength(2);

    await asUser.mutation(api.sessions.complete, { sessionId });
    const nextSession = await asUser.mutation(api.sessions.start, {});
    const kept = await asUser.mutation(api.sets.log, {
      sessionId: nextSession,
      exerciseName: "deadlift",
      reps: 1,
      weightLb: 135,
    });
    await expect(
      asUser.mutation(api.sets.removeMany, { setIds: [second, kept] }),
    ).rejects.toThrow("Sets must belong to the same workout");
    expect(await asUser.query(api.sets.listForSession, { sessionId: nextSession })).toHaveLength(
      1,
    );

    await asUser.mutation(api.sets.removeMany, { setIds: [kept, kept] });
    expect(await asUser.query(api.sets.listForSession, { sessionId: nextSession })).toHaveLength(
      0,
    );
    await expect(
      asUser.mutation(api.sets.removeMany, { setIds: [second] }),
    ).rejects.toThrow("already finished");
  });
});

describe("workouts left unfinished", () => {
  test("a fresh finish ends now, and a stale one ends after the last set", async () => {
    const t = testBackend();
    const asUser = await signIn(t, "Michael");
    const recentId = await asUser.mutation(api.sessions.start, {});
    await asUser.mutation(api.sets.log, {
      sessionId: recentId,
      exerciseName: "squat",
      reps: 5,
      weightLb: 200,
    });
    const loggedAt = Date.now() - 30 * 60 * 1000;
    await ageWorkout(t, recentId, loggedAt - 10 * 60 * 1000, loggedAt);
    const beforeFinish = Date.now();
    await asUser.mutation(api.sessions.complete, { sessionId: recentId });
    const recent = await asUser.query(api.sessions.get, { sessionId: recentId });
    expect(recent?.completedAt ?? 0).toBeGreaterThanOrEqual(beforeFinish);

    const staleId = await asUser.mutation(api.sessions.start, {});
    await asUser.mutation(api.sets.log, {
      sessionId: staleId,
      exerciseName: "squat",
      reps: 5,
      weightLb: 205,
    });
    const staleLoggedAt = Date.now() - 5 * HOUR;
    const staleStartedAt = staleLoggedAt - 20 * 60 * 1000;
    await ageWorkout(t, staleId, staleStartedAt, staleLoggedAt);
    await asUser.mutation(api.sessions.complete, { sessionId: staleId });
    const stale = await asUser.query(api.sessions.get, { sessionId: staleId });
    expect(stale?.completedAt).toBe(staleLoggedAt + STALE_END_MARGIN_MS);
    expect((stale?.completedAt ?? 0) - (stale?.startedAt ?? 0)).toBe(
      staleLoggedAt + STALE_END_MARGIN_MS - staleStartedAt,
    );

    const explicitId = await asUser.mutation(api.sessions.start, {});
    await asUser.mutation(api.sets.log, {
      sessionId: explicitId,
      exerciseName: "squat",
      reps: 5,
      weightLb: 210,
    });
    const explicitLoggedAt = Date.now() - 40 * 60 * 1000;
    const explicitStartedAt = explicitLoggedAt - 15 * 60 * 1000;
    await ageWorkout(t, explicitId, explicitStartedAt, explicitLoggedAt);
    const chosenEnd = explicitLoggedAt + 5 * 60 * 1000;
    await asUser.mutation(api.sessions.complete, {
      sessionId: explicitId,
      completedAt: chosenEnd,
    });
    const chosen = await asUser.query(api.sessions.get, { sessionId: explicitId });
    expect(chosen?.completedAt).toBe(chosenEnd);

    const rejectedId = await asUser.mutation(api.sessions.start, {});
    await asUser.mutation(api.sets.log, {
      sessionId: rejectedId,
      exerciseName: "squat",
      reps: 5,
      weightLb: 215,
    });
    const rejectedLoggedAt = Date.now() - 40 * 60 * 1000;
    const rejectedStartedAt = rejectedLoggedAt - 20 * 60 * 1000;
    await ageWorkout(t, rejectedId, rejectedStartedAt, rejectedLoggedAt);
    await expect(
      asUser.mutation(api.sessions.complete, {
        sessionId: rejectedId,
        completedAt: Date.now() + HOUR,
      }),
    ).rejects.toThrow("End time can't be in the future");
    await expect(
      asUser.mutation(api.sessions.complete, {
        sessionId: rejectedId,
        completedAt: rejectedStartedAt + 5 * 60 * 1000,
      }),
    ).rejects.toThrow("End time can't be before the last set");
    expect((await asUser.query(api.sessions.get, { sessionId: rejectedId }))?.status).toBe(
      "open",
    );
  });

  test("keep going delays the prompt window, and the cron finishes or discards the rest", async () => {
    const t = testBackend();
    const asUser = await signIn(t, "Michael");
    const other = await signIn(t, "Someone else");

    const keptId = await asUser.mutation(api.sessions.start, {});
    await asUser.mutation(api.sets.log, {
      sessionId: keptId,
      exerciseName: "press",
      reps: 8,
      weightLb: 50,
    });
    await ageWorkout(t, keptId, Date.now() - 8 * HOUR, Date.now() - 7 * HOUR);
    const beforeKeep = Date.now();
    await asUser.mutation(api.sessions.keepGoing, { sessionId: keptId });
    const keptOpen = await asUser.query(api.sessions.getOpen, {});
    expect(keptOpen?.resumedAt ?? 0).toBeGreaterThanOrEqual(beforeKeep);

    const abandonedId = await other.mutation(api.sessions.start, {});
    await other.mutation(api.sets.log, {
      sessionId: abandonedId,
      exerciseName: "row",
      reps: 10,
      weightLb: 95,
    });
    const abandonedLoggedAt = Date.now() - 9 * HOUR;
    const abandonedStartedAt = abandonedLoggedAt - 25 * 60 * 1000;
    await ageWorkout(t, abandonedId, abandonedStartedAt, abandonedLoggedAt);

    const emptyId = await t.run(async (ctx) => {
      const kept = await ctx.db.get("sessions", keptId);
      if (!kept) {
        throw new Error("Expected the kept workout");
      }
      return await ctx.db.insert("sessions", {
        userId: kept.userId,
        status: "open",
        startedAt: Date.now() - 8 * HOUR,
      });
    });
    const freshEmptyId = await t.run(async (ctx) => {
      const kept = await ctx.db.get("sessions", keptId);
      if (!kept) {
        throw new Error("Expected the kept workout");
      }
      return await ctx.db.insert("sessions", {
        userId: kept.userId,
        status: "open",
        startedAt: Date.now() - 10 * 60 * 1000,
      });
    });

    await expect(
      other.mutation(api.sessions.keepGoing, { sessionId: keptId }),
    ).rejects.toThrow("Workout not found");

    const firstPass = await t.mutation(internal.sessions.closeStale, {});
    expect(firstPass.finished).toBe(1);
    expect(firstPass.discarded).toBe(1);
    expect(firstPass.done).toBe(true);

    expect((await asUser.query(api.sessions.get, { sessionId: keptId }))?.status).toBe("open");
    const abandoned = await other.query(api.sessions.get, { sessionId: abandonedId });
    expect(abandoned?.status).toBe("completed");
    expect(abandoned?.completedAt).toBe(abandonedLoggedAt + STALE_END_MARGIN_MS);
    expect(await asUser.query(api.sessions.get, { sessionId: emptyId })).toBeNull();
    expect((await asUser.query(api.sessions.get, { sessionId: freshEmptyId }))?.status).toBe(
      "open",
    );

    const secondPass = await t.mutation(internal.sessions.closeStale, {});
    expect(secondPass).toMatchObject({ finished: 0, discarded: 0 });
    expect((await other.query(api.sessions.get, { sessionId: abandonedId }))?.completedAt).toBe(
      abandonedLoggedAt + STALE_END_MARGIN_MS,
    );
  });

  test("the cron still closes a stale workout after access is removed", async () => {
    const t = testBackend();
    const asUser = await signIn(t, "Temporary");
    const sessionId = await asUser.mutation(api.sessions.start, {});
    await asUser.mutation(api.sets.log, {
      sessionId,
      exerciseName: "lunge",
      reps: 8,
      weightLb: 40,
    });
    const loggedAt = Date.now() - 7 * HOUR;
    await ageWorkout(t, sessionId, loggedAt - 10 * 60 * 1000, loggedAt);
    await t.run(async (ctx) => {
      const allowed = await ctx.db
        .query("allowedEmails")
        .withIndex("by_email", (q) => q.eq("email", "temporary.user@example.com"))
        .unique();
      if (!allowed) {
        throw new Error("Expected the allow-list row");
      }
      await ctx.db.delete("allowedEmails", allowed._id);
    });
    await expect(asUser.query(api.sessions.getOpen, {})).rejects.toThrow(
      "You don't have access yet",
    );

    const result = await t.mutation(internal.sessions.closeStale, {});
    expect(result.finished).toBe(1);
    const stored = await t.run(async (ctx) => await ctx.db.get("sessions", sessionId));
    expect(stored?.status).toBe("completed");
    expect(stored?.completedAt).toBe(loggedAt + STALE_END_MARGIN_MS);
  });
});
