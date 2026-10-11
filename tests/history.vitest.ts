/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { ADMIN_EMAIL } from "../convex/lib/accessControl";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");
const WEEK = 7 * 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

function testBackend() {
  return convexTest(schema, modules);
}

async function signIn(
  t: ReturnType<typeof testBackend>,
  name: string,
  options?: { email?: string; allow?: boolean },
) {
  const email = options?.email ?? `${name.toLowerCase().replace(/[^a-z0-9]+/g, ".")}.user@example.com`;
  const userId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("users", { name, email });
    if (options?.allow !== false) {
      await ctx.db.insert("allowedEmails", {
        email: email.trim().toLowerCase(),
        createdAt: Date.now(),
      });
    }
    return id;
  });
  return t.withIdentity({ subject: `${userId}|${name}-session` });
}

function weeksAround(now: number) {
  const thisWeekStart = now - 3 * 24 * HOUR;
  return {
    weekStarts: [thisWeekStart - 2 * WEEK, thisWeekStart - WEEK, thisWeekStart],
    weekEndsAt: thisWeekStart + WEEK,
    thisWeekStart,
    lastWeekStart: thisWeekStart - WEEK,
    olderStart: thisWeekStart - 2 * WEEK,
  };
}

describe("finished workouts can be corrected or deleted", () => {
  test("a set added to a finished workout stays on that workout's clock", async () => {
    const t = testBackend();
    const asUser = await signIn(t, "Michael");
    const sessionId = await asUser.mutation(api.sessions.start, {});
    await asUser.mutation(api.sets.log, {
      sessionId,
      exerciseName: "bench press",
      reps: 8,
      weightLb: 135,
    });
    const loggedAt = Date.now() - 2 * 24 * HOUR;
    await t.run(async (ctx) => {
      await ctx.db.patch("sessions", sessionId, { startedAt: loggedAt - 30 * 60 * 1000 });
      const sets = await ctx.db
        .query("sets")
        .withIndex("by_session_and_exercise", (q) => q.eq("sessionId", sessionId))
        .take(10);
      for (const set of sets) {
        await ctx.db.patch("sets", set._id, { loggedAt });
      }
    });
    await asUser.mutation(api.sessions.complete, { sessionId });

    const saved = await asUser.mutation(api.sets.log, {
      sessionId,
      exerciseName: "bench press",
      reps: 6,
      weightLb: 155,
    });
    const stored = await t.run(async (ctx) => await ctx.db.get("sets", saved.setId));
    expect(stored?.loggedAt).toBe(loggedAt + 1);
    expect(stored?.loggedAt ?? 0).toBeLessThan(Date.now() - HOUR);
    expect(await asUser.query(api.sessions.getOpen, {})).toBeNull();
  });

  test("deleting a finished workout removes its sets and leaves the library", async () => {
    const t = testBackend();
    const owner = await signIn(t, "Michael");
    const other = await signIn(t, "Someone else");
    const sessionId = await owner.mutation(api.sessions.start, {});
    await owner.mutation(api.sets.logMany, {
      sessionId,
      exerciseName: "squat",
      sets: [
        { reps: 5, weightLb: 185 },
        { reps: 5, weightLb: 205 },
      ],
    });
    await owner.mutation(api.sessions.complete, { sessionId });

    await t.run(async (ctx) => {
      const session = await ctx.db.get("sessions", sessionId);
      if (!session) {
        throw new Error("Expected the workout");
      }
      const exercise = await ctx.db
        .query("exercises")
        .withIndex("by_user_and_normalized_name", (q) =>
          q.eq("userId", session.userId).eq("normalizedName", "squat"),
        )
        .unique();
      if (!exercise) {
        throw new Error("Expected squat");
      }
      for (let index = 0; index < 120; index += 1) {
        await ctx.db.insert("sets", {
          userId: session.userId,
          sessionId,
          exerciseId: exercise._id,
          reps: 5,
          weightLb: 135,
          loggedAt: session.startedAt + index,
        });
      }
    });

    await expect(other.mutation(api.sessions.remove, { sessionId })).rejects.toThrow(
      "Workout not found",
    );
    expect(await owner.query(api.sessions.get, { sessionId })).not.toBeNull();

    const openId = await owner.mutation(api.sessions.start, {});
    await expect(owner.mutation(api.sessions.remove, { sessionId: openId })).rejects.toThrow(
      "can't be deleted",
    );
    expect((await owner.query(api.sessions.getOpen, {}))?._id).toBe(openId);

    const ownerId = await t.run(async (ctx) => {
      const session = await ctx.db.get("sessions", sessionId);
      return session?.userId ?? null;
    });
    await owner.mutation(api.sessions.remove, { sessionId });
    expect(await owner.query(api.sessions.get, { sessionId })).toBeNull();
    const leftover = await t.run(async (ctx) => {
      const sets = await ctx.db
        .query("sets")
        .withIndex("by_session_and_exercise", (q) => q.eq("sessionId", sessionId))
        .take(5);
      const session = await ctx.db.get("sessions", sessionId);
      const exercise =
        ownerId === null
          ? []
          : await ctx.db
              .query("exercises")
              .withIndex("by_user_and_normalized_name", (q) =>
                q.eq("userId", ownerId).eq("normalizedName", "squat"),
              )
              .take(5);
      return { sets, session, exercises: exercise.length };
    });
    expect(leftover.sets).toHaveLength(0);
    expect(leftover.session).toBeNull();
    expect(leftover.exercises).toBeGreaterThan(0);

    const history = await owner.query(api.sessions.listHistory, {
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(history.page).toHaveLength(0);
  });
});

describe("logging a past workout", () => {
  test("saves a finished workout without touching the open one or the stale pass", async () => {
    const t = testBackend();
    const asUser = await signIn(t, "Michael");
    const openId = await asUser.mutation(api.sessions.start, {});
    await asUser.mutation(api.sets.log, {
      sessionId: openId,
      exerciseName: "row",
      reps: 10,
      weightLb: 95,
    });

    const startedAt = Date.now() - 10 * HOUR;
    const saved = await asUser.mutation(api.sessions.logPast, {
      startedAt,
      exercises: [
        {
          name: "bench press",
          sets: [
            { reps: 10, weightLb: 135 },
            { reps: 8, weightLb: 145 },
          ],
        },
        { name: "push-ups", sets: [{ reps: 20, weightLb: 0 }] },
      ],
    });

    expect((await asUser.query(api.sessions.getOpen, {}))?._id).toBe(openId);
    const past = await asUser.query(api.sessions.get, { sessionId: saved.sessionId });
    expect(past?.status).toBe("completed");
    expect(past?.startedAt).toBe(startedAt);
    expect(past?.completedAt).toBe(startedAt);
    expect(past?.sets.map((set) => set.loggedAt)).toEqual([startedAt, startedAt + 1, startedAt + 2]);
    expect(saved.personalRecords.map((record) => record.exerciseName).sort()).toEqual([
      "bench press",
      "push-ups",
    ]);

    await t.mutation(internal.sessions.closeStale, {});
    const after = await asUser.query(api.sessions.get, { sessionId: saved.sessionId });
    expect(after?.status).toBe("completed");
    expect(after?.completedAt).toBe(startedAt);
    expect((await asUser.query(api.sessions.get, { sessionId: openId }))?.status).toBe("open");

    const history = await asUser.query(api.sessions.listHistory, {
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(history.page.map((session) => session._id)).toContain(saved.sessionId);
    expect(history.page.map((session) => session._id)).not.toContain(openId);
  });

  test("a later-saved past workout does not replace last time", async () => {
    const t = testBackend();
    const asUser = await signIn(t, "Michael");
    const recentId = await asUser.mutation(api.sessions.start, {});
    await asUser.mutation(api.sets.log, {
      sessionId: recentId,
      exerciseName: "bench press",
      reps: 5,
      weightLb: 185,
    });
    await asUser.mutation(api.sessions.complete, { sessionId: recentId });

    await asUser.mutation(api.sessions.logPast, {
      startedAt: Date.now() - 14 * 24 * HOUR,
      exercises: [{ name: "Bench Press", sets: [{ reps: 10, weightLb: 95 }] }],
    });

    expect(
      (await asUser.query(api.sets.recentForExercise, { exerciseName: "bench press" }))?.sets,
    ).toEqual([{ reps: 5, weightLb: 185, durationSec: null, distanceM: null, rpe: null, setType: "working" }]);
  });

  test("rejects a future time, an empty workout, and callers without access", async () => {
    const t = testBackend();
    const asUser = await signIn(t, "Michael");
    const blocked = await signIn(t, "Stranger", {
      email: "stranger@example.com",
      allow: false,
    });

    await expect(
      asUser.mutation(api.sessions.logPast, {
        startedAt: Date.now() + 2 * HOUR,
        exercises: [{ name: "squat", sets: [{ reps: 5, weightLb: 135 }] }],
      }),
    ).rejects.toThrow("already happened");
    await expect(
      asUser.mutation(api.sessions.logPast, {
        startedAt: Date.now() - HOUR,
        exercises: [],
      }),
    ).rejects.toThrow("at least one exercise");
    await expect(
      asUser.mutation(api.sessions.logPast, {
        startedAt: Date.now() - HOUR,
        exercises: [{ name: "squat", sets: [] }],
      }),
    ).rejects.toThrow("at least one set");
    expect(await asUser.query(api.sessions.getOpen, {})).toBeNull();

    await expect(
      blocked.mutation(api.sessions.logPast, {
        startedAt: Date.now() - HOUR,
        exercises: [{ name: "squat", sets: [{ reps: 5, weightLb: 135 }] }],
      }),
    ).rejects.toThrow("You don't have access yet");
    await expect(
      t.mutation(api.sessions.logPast, {
        startedAt: Date.now() - HOUR,
        exercises: [{ name: "squat", sets: [{ reps: 5, weightLb: 135 }] }],
      }),
    ).rejects.toThrow("Not authenticated");

    const saved = await asUser.mutation(api.sessions.logPast, {
      startedAt: Date.now() - HOUR,
      exercises: [{ name: "squat", sets: [{ reps: 5, weightLb: 135 }] }],
    });
    await expect(t.mutation(api.sessions.remove, { sessionId: saved.sessionId })).rejects.toThrow(
      "Not authenticated",
    );
    await expect(blocked.mutation(api.sessions.remove, { sessionId: saved.sessionId })).rejects.toThrow(
      "You don't have access yet",
    );
    expect(await asUser.query(api.sessions.get, { sessionId: saved.sessionId })).not.toBeNull();
  });
});

describe("exercise history and records", () => {
  test("pages sets by when they were performed and keeps records to the owner", async () => {
    const t = testBackend();
    const asUser = await signIn(t, "Michael");
    const other = await signIn(t, "Someone else");

    const older = await asUser.mutation(api.sessions.logPast, {
      startedAt: Date.now() - 20 * 24 * HOUR,
      exercises: [
        {
          name: "bench press",
          sets: [
            { reps: 10, weightLb: 135 },
            { reps: 8, weightLb: 145 },
          ],
        },
      ],
    });
    const newerId = await asUser.mutation(api.sessions.start, {});
    const heavy = await asUser.mutation(api.sets.log, {
      sessionId: newerId,
      exerciseName: "bench press",
      reps: 2,
      weightLb: 155,
    });
    expect(heavy.personalRecord?.kind).toBe("weight");
    await asUser.mutation(api.sets.log, {
      sessionId: newerId,
      exerciseName: "bench press",
      reps: 12,
      weightLb: 95,
    });
    const tied = await asUser.mutation(api.sets.log, {
      sessionId: newerId,
      exerciseName: "bench press",
      reps: 2,
      weightLb: 155,
    });
    expect(tied.personalRecord).toBeNull();
    await asUser.mutation(api.sessions.complete, { sessionId: newerId });
    await t.run(async (ctx) => {
      const sets = await ctx.db
        .query("sets")
        .withIndex("by_session_and_exercise", (q) => q.eq("sessionId", newerId))
        .take(10);
      const ordered = [...sets].sort((left, right) => left._creationTime - right._creationTime);
      for (let index = 0; index < ordered.length; index += 1) {
        const set = ordered[index];
        if (set) {
          await ctx.db.patch("sets", set._id, { loggedAt: Date.now() - HOUR + index });
        }
      }
    });

    const detailId = (
      await asUser.query(api.sessions.get, { sessionId: newerId })
    )?.sets[0]?.exerciseId;
    if (!detailId) {
      throw new Error("Expected bench press");
    }

    const detail = await asUser.query(api.exercises.detail, { exerciseId: detailId });
    expect(detail?.name).toBe("bench press");
    expect(detail?.bestWeight).toMatchObject({ weightLb: 155, reps: 2 });
    expect(detail?.bestEpley?.weightLb).toBe(145);
    expect(detail?.trend.map((point) => point.sessionId)).toEqual([
      older.sessionId,
      newerId,
    ]);
    expect(detail?.truncated).toBe(false);

    const firstPage = await asUser.query(api.exercises.history, {
      exerciseId: detailId,
      paginationOpts: { numItems: 3, cursor: null },
    });
    expect(firstPage.page.map((set) => set.weightLb)).toEqual([155, 95, 155]);
    expect(firstPage.isDone).toBe(false);
    const secondPage = await asUser.query(api.exercises.history, {
      exerciseId: detailId,
      paginationOpts: { numItems: 3, cursor: firstPage.continueCursor },
    });
    expect(secondPage.page.map((set) => set.sessionId)).toEqual([older.sessionId, older.sessionId]);
    expect(secondPage.page.map((set) => set.weightLb)).toEqual([145, 135]);

    expect(await other.query(api.exercises.detail, { exerciseId: detailId })).toBeNull();
    const hidden = await other.query(api.exercises.history, {
      exerciseId: detailId,
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(hidden.page).toHaveLength(0);
    expect(await asUser.query(api.exercises.detail, { exerciseId: "not-an-id" })).toBeNull();

    const blocked = await signIn(t, "Blocked", { email: "blocked@example.com", allow: false });
    await expect(
      blocked.query(api.exercises.detail, { exerciseId: detailId }),
    ).rejects.toThrow("You don't have access yet");
    await expect(
      blocked.query(api.exercises.history, {
        exerciseId: detailId,
        paginationOpts: { numItems: 10, cursor: null },
      }),
    ).rejects.toThrow("You don't have access yet");
  });
});

describe("weekly summary", () => {
  test("compares this week with last week and keeps a streak through an empty current week", async () => {
    const t = testBackend();
    const asUser = await signIn(t, "Michael");
    const other = await signIn(t, "Someone else");
    const range = weeksAround(Date.now());

    await asUser.mutation(api.sessions.logPast, {
      startedAt: range.olderStart + HOUR,
      exercises: [{ name: "squat", sets: [{ reps: 5, weightLb: 200 }] }],
    });
    await asUser.mutation(api.sessions.logPast, {
      startedAt: range.lastWeekStart + 2 * HOUR,
      exercises: [
        {
          name: "bench press",
          sets: [
            { reps: 10, weightLb: 100 },
            { reps: 20, weightLb: 0 },
          ],
        },
      ],
    });
    await asUser.mutation(api.sessions.logPast, {
      startedAt: range.thisWeekStart + HOUR,
      exercises: [{ name: "deadlift", sets: [{ reps: 3, weightLb: 300 }] }],
    });
    const openId = await asUser.mutation(api.sessions.start, {});
    await asUser.mutation(api.sets.log, {
      sessionId: openId,
      exerciseName: "curl",
      reps: 10,
      weightLb: 30,
    });
    await other.mutation(api.sessions.logPast, {
      startedAt: range.thisWeekStart + HOUR,
      exercises: [{ name: "squat", sets: [{ reps: 5, weightLb: 500 }] }],
    });

    const summary = await asUser.query(api.sessions.weeklySummary, {
      weekStarts: range.weekStarts,
      weekEndsAt: range.weekEndsAt,
    });
    expect(summary).toEqual({
      workouts: 1,
      sets: 1,
      volumeLb: 900,
      previousWorkouts: 1,
      previousSets: 2,
      previousVolumeLb: 1000,
      streakWeeks: 3,
    });

    const missedThisWeek = await asUser.query(api.sessions.weeklySummary, {
      weekStarts: [range.olderStart, range.lastWeekStart, range.thisWeekStart + 2 * HOUR],
      weekEndsAt: range.thisWeekStart + 2 * HOUR + WEEK,
    });
    expect(missedThisWeek.workouts).toBe(0);
    expect(missedThisWeek.streakWeeks).toBe(2);

    await expect(
      asUser.query(api.sessions.weeklySummary, {
        weekStarts: [range.thisWeekStart, range.thisWeekStart + HOUR],
        weekEndsAt: range.thisWeekStart + WEEK,
      }),
    ).rejects.toThrow("seven days");
    await expect(
      other.query(api.sessions.weeklySummary, {
        weekStarts: range.weekStarts,
        weekEndsAt: range.weekEndsAt,
      }),
    ).resolves.toMatchObject({ workouts: 1, volumeLb: 2500 });

    const blocked = await signIn(t, "Nope", { email: "nope@example.com", allow: false });
    await expect(
      blocked.query(api.sessions.weeklySummary, {
        weekStarts: range.weekStarts,
        weekEndsAt: range.weekEndsAt,
      }),
    ).rejects.toThrow("You don't have access yet");
    await expect(
      t.query(api.sessions.weeklySummary, {
        weekStarts: range.weekStarts,
        weekEndsAt: range.weekEndsAt,
      }),
    ).rejects.toThrow("Not authenticated");
  });

  test("the admin can log a past workout without an allow-list row", async () => {
    const t = testBackend();
    const admin = await signIn(t, "Admin", { email: ADMIN_EMAIL, allow: false });
    const saved = await admin.mutation(api.sessions.logPast, {
      startedAt: Date.now() - 2 * HOUR,
      exercises: [{ name: "pull-up", sets: [{ reps: 8, weightLb: 0 }] }],
    });
    expect(saved.personalRecords[0]).toMatchObject({ kind: "reps", reps: 8 });
    const summary = weeksAround(Date.now());
    const week = await admin.query(api.sessions.weeklySummary, {
      weekStarts: summary.weekStarts,
      weekEndsAt: summary.weekEndsAt,
    });
    expect(week.sets).toBeGreaterThan(0);
    expect(week.volumeLb).toBe(0);
  });
});

describe("finished workouts on one local day", () => {
  test("stay separate in history, load together, and delete together for the owner only", async () => {
    const t = testBackend();
    const owner = await signIn(t, "Michael");
    const other = await signIn(t, "Someone else");
    const blocked = await signIn(t, "Stranger", {
      email: "stranger.day@example.com",
      allow: false,
    });

    const morning = Date.now() - 5 * 24 * HOUR;
    const evening = morning + 6 * HOUR;
    const window = { startedFrom: morning - HOUR, startedUntil: morning + 10 * HOUR };

    const first = await owner.mutation(api.sessions.logPast, {
      startedAt: morning,
      note: "Morning session",
      exercises: [
        {
          name: "squat",
          sets: [
            { reps: 5, weightLb: 200 },
            { reps: 5, weightLb: 200 },
          ],
        },
      ],
    });
    const second = await owner.mutation(api.sessions.logPast, {
      startedAt: evening,
      exercises: [
        { name: "squat", sets: [{ reps: 3, weightLb: 220 }] },
        { name: "bench press", sets: [{ reps: 8, weightLb: 135 }] },
      ],
    });
    const previousDay = await owner.mutation(api.sessions.logPast, {
      startedAt: morning - 24 * HOUR,
      exercises: [{ name: "row", sets: [{ reps: 10, weightLb: 95 }] }],
    });
    const stranger = await other.mutation(api.sessions.logPast, {
      startedAt: morning + HOUR,
      exercises: [{ name: "deadlift", sets: [{ reps: 5, weightLb: 315 }] }],
    });
    const openId = await owner.mutation(api.sessions.start, {});
    await owner.mutation(api.sets.log, {
      sessionId: openId,
      exerciseName: "squat",
      reps: 5,
      weightLb: 185,
    });
    await t.run(async (ctx) => {
      await ctx.db.patch("sessions", openId, { startedAt: morning + 2 * HOUR });
    });

    const history = await owner.query(api.sessions.listHistory, {
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(history.page.map((session) => session._id)).toEqual(
      expect.arrayContaining([first.sessionId, second.sessionId, previousDay.sessionId]),
    );
    expect(history.page.map((session) => session._id)).not.toContain(openId);
    expect(history.page.find((session) => session._id === first.sessionId)?.volumeLb).toBe(2000);
    expect(history.page.find((session) => session._id === second.sessionId)?.volumeLb).toBe(1740);

    const day = await owner.query(api.sessions.listDay, window);
    expect(day.truncated).toBe(false);
    expect(day.sessions.map((session) => session._id)).toEqual([first.sessionId, second.sessionId]);
    expect(day.sessions.map((session) => session.note)).toEqual(["Morning session", null]);

    await expect(blocked.query(api.sessions.listDay, window)).rejects.toThrow(
      "You don't have access yet",
    );
    await expect(
      owner.query(api.sessions.listDay, {
        startedFrom: morning,
        startedUntil: morning + 48 * HOUR,
      }),
    ).rejects.toThrow("Pick a single day");
    await expect(
      owner.mutation(api.sessions.removeDay, {
        startedFrom: morning - 10 * 24 * HOUR,
        startedUntil: morning - 10 * 24 * HOUR + 2 * HOUR,
      }),
    ).rejects.toThrow("No finished workouts on this day");

    const otherUserId = await t.run(async (ctx) => {
      const session = await ctx.db.get("sessions", stranger.sessionId);
      return session?.userId ?? null;
    });
    await t.run(async (ctx) => {
      const sets = await ctx.db
        .query("sets")
        .withIndex("by_session_and_exercise", (q) => q.eq("sessionId", second.sessionId))
        .take(5);
      const set = sets[0];
      if (!set || !otherUserId) {
        throw new Error("Expected a set to corrupt");
      }
      await ctx.db.patch("sets", set._id, { userId: otherUserId });
    });
    await expect(owner.mutation(api.sessions.removeDay, window)).rejects.toThrow("Workout not found");
    expect(await owner.query(api.sessions.get, { sessionId: first.sessionId })).not.toBeNull();
    expect(await owner.query(api.sessions.get, { sessionId: second.sessionId })).not.toBeNull();

    await t.run(async (ctx) => {
      const session = await ctx.db.get("sessions", second.sessionId);
      const sets = await ctx.db
        .query("sets")
        .withIndex("by_session_and_exercise", (q) => q.eq("sessionId", second.sessionId))
        .take(5);
      if (!session) {
        throw new Error("Expected the evening workout");
      }
      for (const set of sets) {
        await ctx.db.patch("sets", set._id, { userId: session.userId });
      }
    });

    const removed = await owner.mutation(api.sessions.removeDay, window);
    expect(removed).toEqual({ workouts: 2, sets: 4 });
    expect(await owner.query(api.sessions.get, { sessionId: first.sessionId })).toBeNull();
    expect(await owner.query(api.sessions.get, { sessionId: second.sessionId })).toBeNull();
    expect(await owner.query(api.sessions.get, { sessionId: previousDay.sessionId })).not.toBeNull();
    expect((await owner.query(api.sessions.getOpen, {}))?._id).toBe(openId);
    expect(await other.query(api.sessions.get, { sessionId: stranger.sessionId })).not.toBeNull();
    const leftoverSets = await t.run(async (ctx) => {
      const morningSets = await ctx.db
        .query("sets")
        .withIndex("by_session_and_exercise", (q) => q.eq("sessionId", first.sessionId))
        .take(5);
      const eveningSets = await ctx.db
        .query("sets")
        .withIndex("by_session_and_exercise", (q) => q.eq("sessionId", second.sessionId))
        .take(5);
      return morningSets.length + eveningSets.length;
    });
    expect(leftoverSets).toBe(0);

    await expect(blocked.mutation(api.sessions.removeDay, window)).rejects.toThrow(
      "You don't have access yet",
    );
  });
});

describe("summary records and the month calendar", () => {
  test("finishing returns records and leaves warm-ups and drops out", async () => {
    const t = testBackend();
    const asUser = await signIn(t, "Michael");
    const blocked = await signIn(t, "Blocked", { allow: false });
    const sessionId = await asUser.mutation(api.sessions.start, {});
    await asUser.mutation(api.sets.log, {
      sessionId,
      exerciseName: "bench press",
      reps: 10,
      weightLb: 95,
      setType: "warmup",
    });
    await asUser.mutation(api.sets.log, {
      sessionId,
      exerciseName: "bench press",
      reps: 1,
      weightLb: 300,
      setType: "drop",
    });
    await asUser.mutation(api.sets.log, {
      sessionId,
      exerciseName: "bench press",
      reps: 5,
      weightLb: 135,
    });
    const finished = await asUser.mutation(api.sessions.complete, { sessionId });
    expect(finished.personalRecords).toEqual([
      expect.objectContaining({ exerciseName: "bench press", kind: "both", weightLb: 135 }),
    ]);
    expect(finished.completedAt).toBeGreaterThan(0);

    const later = await asUser.mutation(api.sessions.start, {});
    await asUser.mutation(api.sets.log, {
      sessionId: later,
      exerciseName: "bench press",
      reps: 5,
      weightLb: 95,
    });
    const noRecord = await asUser.mutation(api.sessions.complete, { sessionId: later });
    expect(noRecord.personalRecords).toEqual([]);

    await expect(blocked.mutation(api.sessions.complete, { sessionId: later })).rejects.toThrow(
      "You don't have access yet",
    );
  });

  test("a day keeps the records it earned, and the calendar stays on the signed-in user", async () => {
    const t = testBackend();
    const owner = await signIn(t, "Michael");
    const other = await signIn(t, "Someone else");
    const blocked = await signIn(t, "Blocked", { allow: false });
    const morning = Date.UTC(2026, 8, 11, 15);
    const evening = morning + 6 * HOUR;
    const later = Date.UTC(2026, 8, 20, 15);
    const monthStart = Date.UTC(2026, 8, 1);
    const monthEnd = Date.UTC(2026, 9, 1);

    await owner.mutation(api.sessions.logPast, {
      startedAt: morning,
      exercises: [{ name: "squat", sets: [{ reps: 5, weightLb: 185 }] }],
    });
    await owner.mutation(api.sessions.logPast, {
      startedAt: evening,
      exercises: [{ name: "squat", sets: [{ reps: 3, weightLb: 205 }] }],
    });
    await owner.mutation(api.sessions.logPast, {
      startedAt: later,
      exercises: [{ name: "squat", sets: [{ reps: 1, weightLb: 315 }] }],
    });
    await other.mutation(api.sessions.logPast, {
      startedAt: morning + HOUR,
      exercises: [{ name: "deadlift", sets: [{ reps: 5, weightLb: 405 }] }],
    });
    const openId = await owner.mutation(api.sessions.start, {});
    await t.run(async (ctx) => {
      await ctx.db.patch("sessions", openId, { startedAt: morning + 2 * HOUR });
    });

    const day = await owner.query(api.sessions.listDay, {
      startedFrom: Date.UTC(2026, 8, 11),
      startedUntil: Date.UTC(2026, 8, 12),
    });
    expect(day.sessions).toHaveLength(2);
    expect(day.personalRecords).toEqual([
      expect.objectContaining({ exerciseName: "squat", weightLb: 205, kind: "both" }),
    ]);

    const calendar = await owner.query(api.sessions.calendar, {
      startedFrom: monthStart,
      startedUntil: monthEnd,
    });
    expect(calendar).toEqual({ truncated: false, startedAts: [morning, evening, later] });

    const stranger = await other.query(api.sessions.calendar, {
      startedFrom: monthStart,
      startedUntil: monthEnd,
    });
    expect(stranger.startedAts).toEqual([morning + HOUR]);

    await expect(
      blocked.query(api.sessions.calendar, { startedFrom: monthStart, startedUntil: monthEnd }),
    ).rejects.toThrow("You don't have access yet");
    await expect(
      owner.query(api.sessions.calendar, {
        startedFrom: morning,
        startedUntil: morning + 2 * HOUR,
      }),
    ).rejects.toThrow("Pick a single month");
  });
});
