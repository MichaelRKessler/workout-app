/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import type { Doc, Id } from "../convex/_generated/dataModel";
import { absorbSet, emptyBests } from "../convex/lib/recordBests";
import { resolvedSetType } from "../convex/lib/setType";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");
const STALL_MS = 2 * 60 * 1000;

function testBackend() {
  return convexTest(schema, modules);
}

type Backend = ReturnType<typeof testBackend>;

async function signIn(t: Backend, name: string) {
  const email = `${name.toLowerCase()}.races@example.com`;
  const userId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("users", { name, email });
    await ctx.db.insert("allowedEmails", { email, createdAt: Date.now() });
    return id;
  });
  return { userId, asUser: t.withIdentity({ subject: `${userId}|${name}-session` }) };
}

async function drain(t: Backend) {
  await t.finishAllScheduledFunctions(() => {
    vi.runAllTimers();
  });
}

function tick(ms = 1_000) {
  vi.setSystemTime(Date.now() + ms);
}

async function statsRows(t: Backend, exerciseId: Id<"exercises">) {
  return await t.run(async (ctx) => {
    const rows = await ctx.db.query("exerciseStats").collect();
    return rows.filter((row) => row.exerciseId === exerciseId);
  });
}

async function exerciseNamed(t: Backend, normalizedName: string) {
  const exercise = await t.run(async (ctx) => {
    const all = await ctx.db.query("exercises").collect();
    return all.find((row) => row.normalizedName === normalizedName) ?? null;
  });
  if (!exercise) {
    throw new Error(`No exercise named ${normalizedName}`);
  }
  return exercise._id;
}

/** Recomputes every exercise's stats from its sets and lists what the stored rows get wrong. */
async function audit(t: Backend): Promise<string[]> {
  return await t.run(async (ctx) => {
    const problems: string[] = [];
    const rows = await ctx.db.query("exerciseStats").collect();
    const exercises = await ctx.db.query("exercises").collect();
    for (const exercise of exercises) {
      const owned = rows.filter((row) => row.exerciseId === exercise._id);
      if (owned.length > 1) {
        problems.push(`${exercise.name}: ${owned.length} stats rows`);
      }
      const stats = owned[0];
      if (!stats || !exercise.userId) {
        continue;
      }
      if (!stats.ready) {
        problems.push(`${exercise.name}: not ready`);
        continue;
      }
      const userId = exercise.userId;
      const sets = await ctx.db
        .query("sets")
        .withIndex("by_user_exercise_and_logged", (q) => q.eq("userId", userId).eq("exerciseId", exercise._id))
        .order("asc")
        .collect();
      if (stats.setCount !== sets.length) {
        problems.push(`${exercise.name}: setCount ${stats.setCount}, expected ${sets.length}`);
      }
      const last = sets.length > 0 ? Math.max(...sets.map((set) => set.loggedAt)) : null;
      if (stats.lastLoggedAt !== last) {
        problems.push(`${exercise.name}: lastLoggedAt ${stats.lastLoggedAt}, expected ${last}`);
      }
      let bests = emptyBests();
      const sessionCalories = new Map<string, number>();
      for (const set of sets) {
        const folded = absorbSet(exercise.name, bests, sessionCalories.get(set.sessionId) ?? 0, {
          setId: set._id,
          sessionId: set.sessionId,
          loggedAt: set.loggedAt,
          reps: set.reps ?? null,
          weightLb: set.weightLb,
          durationSec: set.durationSec ?? null,
          distanceM: set.distanceM ?? null,
          calories: set.calories ?? null,
          setType: resolvedSetType(set.setType),
        });
        bests = folded.bests;
        sessionCalories.set(set.sessionId, folded.sessionCalories);
        const stored = (set.recordStamps ?? []).map((stamp) => stamp.kind).join(",");
        const expected = folded.stamps.map((stamp) => stamp.kind).join(",");
        if (set.recordStamps === undefined || stored !== expected) {
          problems.push(`${exercise.name} set ${set.weightLb}x${set.reps}: stamps [${stored}], expected [${expected}]`);
        }
      }
      const compared: Array<[string, unknown, unknown]> = [
        ["bestWeight", stats.bestWeight?.setId ?? null, bests.weight?.setId ?? null],
        ["bestEpley", stats.bestEpley?.setId ?? null, bests.epley?.setId ?? null],
        ["bestReps", stats.bestReps?.setId ?? null, bests.reps?.setId ?? null],
        ["bestDuration", stats.bestDuration?.setId ?? null, bests.duration?.setId ?? null],
        ["bestDistance", stats.bestDistance?.setId ?? null, bests.distance?.setId ?? null],
        ["bestCalories", stats.bestCalories?.calories ?? null, bests.calories?.calories ?? null],
      ];
      for (const [field, stored, expected] of compared) {
        if (stored !== expected) {
          problems.push(`${exercise.name}: ${field} ${String(stored)}, expected ${String(expected)}`);
        }
      }
      const marks = await ctx.db
        .query("recordMarks")
        .withIndex("by_exercise", (q) => q.eq("exerciseId", exercise._id))
        .collect();
      const staleMarks = marks.filter((mark) => mark.generation !== stats.generation).length;
      if (staleMarks > 0) {
        problems.push(`${exercise.name}: ${staleMarks} marks from another generation`);
      }
    }
    return problems;
  });
}

function statsFields(
  userId: Id<"users">,
  exerciseId: Id<"exercises">,
  fields: Partial<Omit<Doc<"exerciseStats">, "_id" | "_creationTime" | "userId" | "exerciseId">>,
) {
  return {
    userId,
    exerciseId,
    setCount: 0,
    lastLoggedAt: null,
    ready: false,
    dirty: false,
    drop: false,
    generation: 1,
    cursor: null,
    phase: "purge" as const,
    scheduledAt: Date.now(),
    bestWeight: null,
    bestEpley: null,
    bestReps: null,
    bestDuration: null,
    bestDistance: null,
    bestCalories: null,
    secondCalories: null,
    ...fields,
  };
}

/**
 * The state earlier code left behind: a fresh ready row next to a stalled
 * rebuild, plus a mark for a set that was deleted.
 */
async function seedDuplicateRows(t: Backend, userId: Id<"users">) {
  return await t.run(async (ctx) => {
    const exerciseId = await ctx.db.insert("exercises", {
      userId,
      name: "Curl",
      normalizedName: "curl",
      createdAt: 1,
    });
    const sessionId = await ctx.db.insert("sessions", {
      userId,
      status: "completed",
      startedAt: 1_000,
      completedAt: 5_000,
      setCount: 2,
      lastSetAt: 1_002,
    });
    const deletedId = await ctx.db.insert("sets", {
      userId,
      sessionId,
      exerciseId,
      reps: 5,
      weightLb: 300,
      loggedAt: 1_000,
    });
    await ctx.db.delete("sets", deletedId);
    const lighter = await ctx.db.insert("sets", {
      userId,
      sessionId,
      exerciseId,
      reps: 5,
      weightLb: 50,
      loggedAt: 1_001,
    });
    const heavier = await ctx.db.insert("sets", {
      userId,
      sessionId,
      exerciseId,
      reps: 5,
      weightLb: 60,
      loggedAt: 1_002,
    });
    await ctx.db.insert("recordMarks", {
      userId,
      exerciseId,
      generation: 1,
      metric: "weight",
      setId: deletedId,
      sessionId,
      loggedAt: 1_000,
      reps: 5,
      weightLb: 300,
      epleyLb: 350,
      durationSec: null,
      distanceM: null,
      calories: null,
    });
    const snap = {
      setId: lighter,
      sessionId,
      loggedAt: 1_001,
      reps: 5,
      weightLb: 50,
      epleyLb: 58.33,
      durationSec: null,
      distanceM: null,
    };
    await ctx.db.insert("exerciseStats", statsFields(userId, exerciseId, {
      generation: 2,
      scheduledAt: Date.now() - 10 * 60 * 1000,
    }));
    await ctx.db.insert("exerciseStats", statsFields(userId, exerciseId, {
      ready: true,
      phase: "walk",
      setCount: 1,
      lastLoggedAt: 1_001,
      bestWeight: snap,
      bestEpley: snap,
    }));
    return { exerciseId, heavier };
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-01T12:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("exercise stats rows", () => {
  test("relogging after deleting an exercise's only set keeps one stats row", async () => {
    const t = testBackend();
    const { asUser } = await signIn(t, "Ann");
    const sessionId = await asUser.mutation(api.sessions.start, {});
    const first = await asUser.mutation(api.sets.log, { sessionId, exerciseName: "curl", reps: 5, weightLb: 50 });
    await drain(t);
    const exerciseId = await exerciseNamed(t, "curl");

    tick();
    await asUser.mutation(api.sets.remove, { setId: first.setId });
    tick();
    const relogged = await asUser.mutation(api.sets.log, { sessionId, exerciseName: "curl", reps: 5, weightLb: 40 });
    expect(relogged.personalRecord).toEqual(expect.objectContaining({ kind: "both", weightLb: 40 }));
    expect(await statsRows(t, exerciseId)).toHaveLength(1);

    tick();
    const heavier = await asUser.mutation(api.sets.log, { sessionId, exerciseName: "curl", reps: 5, weightLb: 60 });
    expect(heavier.personalRecord).toEqual(expect.objectContaining({ kind: "both", weightLb: 60 }));
    const during = await asUser.query(api.exercises.detail, { exerciseId });
    expect(during?.bestWeight?.weightLb).toBe(60);

    await drain(t);
    expect(await audit(t)).toEqual([]);
    const after = await asUser.query(api.exercises.detail, { exerciseId });
    expect(after?.recordsComplete).toBe(true);
    expect(after?.bestWeight?.weightLb).toBe(60);
  });

  test("a first log before the backfill's blank row is rebuilt keeps one stats row", async () => {
    const t = testBackend();
    const { userId, asUser } = await signIn(t, "Fay");
    const exerciseId = await t.run(async (ctx) => {
      return await ctx.db.insert("exercises", { userId, name: "Lunge", normalizedName: "lunge", createdAt: 1 });
    });
    await t.mutation(internal.exerciseStats.backfillTick, {});
    expect(await statsRows(t, exerciseId)).toHaveLength(1);

    const sessionId = await asUser.mutation(api.sessions.start, {});
    const logged = await asUser.mutation(api.sets.log, { sessionId, exerciseName: "lunge", reps: 8, weightLb: 40 });
    expect(logged.personalRecord).toEqual(expect.objectContaining({ kind: "both", weightLb: 40 }));
    expect(await statsRows(t, exerciseId)).toHaveLength(1);

    tick();
    await asUser.mutation(api.sets.log, { sessionId, exerciseName: "lunge", reps: 8, weightLb: 45 });
    await drain(t);
    expect(await audit(t)).toEqual([]);
  });

  test("duplicate rows left by earlier code are readable and heal on the next log", async () => {
    const t = testBackend();
    const { userId, asUser } = await signIn(t, "Dee");
    const { exerciseId } = await seedDuplicateRows(t, userId);
    expect(await statsRows(t, exerciseId)).toHaveLength(2);

    const detail = await asUser.query(api.exercises.detail, { exerciseId });
    expect(detail?.recordsComplete).toBe(false);
    expect(detail?.bestWeight?.weightLb).toBe(60);
    const library = await asUser.query(api.exercises.browse, { paginationOpts: { numItems: 10, cursor: null } });
    expect(library.page.find((item) => item._id === exerciseId)?.setCount).toBe(2);

    const sessionId = await asUser.mutation(api.sessions.start, {});
    const logged = await asUser.mutation(api.sets.log, { sessionId, exerciseName: "curl", reps: 5, weightLb: 55 });
    expect(logged.personalRecord).toBeNull();
    expect(await statsRows(t, exerciseId)).toHaveLength(1);

    await drain(t);
    expect(await audit(t)).toEqual([]);
    const after = await asUser.query(api.exercises.detail, { exerciseId });
    expect(after?.recordsComplete).toBe(true);
    expect(after?.bestWeight?.weightLb).toBe(60);
  });

  test("duplicate rows left by earlier code heal from the cron alone", async () => {
    const t = testBackend();
    const { userId } = await signIn(t, "Eli");
    const { exerciseId } = await seedDuplicateRows(t, userId);
    await t.run(async (ctx) => {
      await ctx.db.insert("statsBackfill", {
        key: "main",
        exerciseCursor: null,
        exercisesDone: true,
        sessionCursor: null,
        sessionsDone: true,
        runningUntil: 0,
      });
    });

    await t.mutation(internal.exerciseStats.backfillTick, {});
    await drain(t);
    expect(await statsRows(t, exerciseId)).toHaveLength(1);
    expect(await audit(t)).toEqual([]);
  });
});

describe("exercise stats rebuild pages", () => {
  test("a rebuild resumed while its first page is still queued counts each set once", async () => {
    const t = testBackend();
    const { userId } = await signIn(t, "Bob");
    const exerciseId = await t.run(async (ctx) => {
      const exerciseId = await ctx.db.insert("exercises", { userId, name: "Squat", normalizedName: "squat", createdAt: 1 });
      const sessionId = await ctx.db.insert("sessions", { userId, status: "completed", startedAt: 1_000, completedAt: 2_000 });
      for (let index = 0; index < 10; index += 1) {
        await ctx.db.insert("sets", {
          userId,
          sessionId,
          exerciseId,
          reps: 5,
          weightLb: 100 + index * 10,
          loggedAt: 1_000 + index,
        });
      }
      return exerciseId;
    });

    await t.mutation(internal.exerciseStats.backfillTick, {});
    tick(3 * 60 * 1000);
    await t.mutation(internal.exerciseStats.backfillTick, { followUp: true });
    await drain(t);

    const rows = await statsRows(t, exerciseId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.setCount).toBe(10);
    expect(await audit(t)).toEqual([]);
  });

  test("a page delivered again after the rebuild finished does nothing", async () => {
    const t = testBackend();
    const { userId, asUser } = await signIn(t, "Cy");
    const sessionId = await asUser.mutation(api.sessions.start, {});
    for (let index = 0; index < 3; index += 1) {
      tick();
      await asUser.mutation(api.sets.log, { sessionId, exerciseName: "row", reps: 5, weightLb: 100 + index });
    }
    const exerciseId = await exerciseNamed(t, "row");
    const [stats] = await statsRows(t, exerciseId);
    expect(stats?.ready).toBe(true);

    const generation = stats?.generation ?? 0;
    await t.mutation(internal.exerciseStats.rebuildPage, { userId, exerciseId, generation, cursor: null });
    await t.mutation(internal.exerciseStats.rebuildPage, {
      userId,
      exerciseId,
      generation,
      cursor: null,
      step: stats?.step ?? 0,
    });
    await drain(t);

    expect((await statsRows(t, exerciseId))[0]?.setCount).toBe(3);
    expect(await audit(t)).toEqual([]);
  });

  test("a second copy of a page mid-rebuild does nothing", async () => {
    const t = testBackend();
    const { userId, asUser } = await signIn(t, "Gil");
    const sessionId = await asUser.mutation(api.sessions.start, {});
    const setIds: Array<Id<"sets">> = [];
    for (const weightLb of [100, 120, 110]) {
      tick();
      const logged = await asUser.mutation(api.sets.log, { sessionId, exerciseName: "press", reps: 5, weightLb });
      setIds.push(logged.setId);
    }
    const exerciseId = await exerciseNamed(t, "press");
    tick();
    await asUser.mutation(api.sets.remove, { setId: setIds[0] as Id<"sets"> });

    const [queued] = await statsRows(t, exerciseId);
    expect(queued?.ready).toBe(false);
    const page = {
      userId,
      exerciseId,
      generation: queued?.generation ?? 0,
      cursor: null,
      step: queued?.step ?? 0,
    };
    await t.mutation(internal.exerciseStats.rebuildPage, page);
    const afterFirst = (await statsRows(t, exerciseId))[0];
    expect(afterFirst?.phase).toBe("purgeCalories");
    expect(afterFirst?.cursor).toBeNull();

    await t.mutation(internal.exerciseStats.rebuildPage, page);
    await t.mutation(internal.exerciseStats.rebuildPage, { userId, exerciseId, generation: page.generation, cursor: null });
    const afterCopies = (await statsRows(t, exerciseId))[0];
    expect(afterCopies?.phase).toBe("purgeCalories");
    expect(afterCopies?.step).toBe(afterFirst?.step);

    await drain(t);
    expect((await statsRows(t, exerciseId))[0]?.setCount).toBe(2);
    expect(await audit(t)).toEqual([]);
  });

  test("a stalled rebuild resumes even when older stalled rows never finish", async () => {
    const t = testBackend();
    const { userId } = await signIn(t, "Hal");
    const { userId: otherUserId } = await signIn(t, "Ivy");
    const exerciseId = await t.run(async (ctx) => {
      await ctx.db.insert("statsBackfill", {
        key: "main",
        exerciseCursor: null,
        exercisesDone: true,
        sessionCursor: null,
        sessionsDone: true,
        runningUntil: 0,
      });
      // A page for a row whose exercise has another owner returns without
      // progress, so these rows stay stalled forever.
      for (let index = 0; index < 8; index += 1) {
        const stuckId = await ctx.db.insert("exercises", {
          userId: otherUserId,
          name: `Stuck ${index}`,
          normalizedName: `stuck ${index}`,
          createdAt: 1,
        });
        await ctx.db.insert("exerciseStats", statsFields(userId, stuckId, {
          scheduledAt: Date.now() - 10 * 60 * 1000,
        }));
      }
      const exerciseId = await ctx.db.insert("exercises", { userId, name: "Dip", normalizedName: "dip", createdAt: 1 });
      const sessionId = await ctx.db.insert("sessions", { userId, status: "completed", startedAt: 1_000, completedAt: 2_000 });
      for (let index = 0; index < 2; index += 1) {
        await ctx.db.insert("sets", { userId, sessionId, exerciseId, reps: 10 + index, weightLb: 0, loggedAt: 1_000 + index });
      }
      await ctx.db.insert("exerciseStats", statsFields(userId, exerciseId, {
        scheduledAt: Date.now() - STALL_MS - 1,
      }));
      return exerciseId;
    });

    await t.mutation(internal.exerciseStats.backfillTick, {});
    await drain(t);
    tick(STALL_MS + 1_000);
    await t.mutation(internal.exerciseStats.backfillTick, {});
    await drain(t);

    const [stats] = await statsRows(t, exerciseId);
    expect(stats?.ready).toBe(true);
    expect(stats?.setCount).toBe(2);
  });
});
