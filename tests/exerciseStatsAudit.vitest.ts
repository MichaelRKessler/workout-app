/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");

function testBackend() {
  return convexTest(schema, modules);
}

type Backend = ReturnType<typeof testBackend>;

async function signIn(t: Backend, name: string) {
  const email = `${name.toLowerCase()}.audit@example.com`;
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

async function statsRow(t: Backend, exerciseId: Id<"exercises">) {
  return await t.run(async (ctx) => {
    const rows = await ctx.db.query("exerciseStats").collect();
    return rows.find((row) => row.exerciseId === exerciseId)!;
  });
}

/** Bench at 135, 185, 155, then a plank and a run, all in one workout. */
async function logHistory(t: Backend, asUser: Awaited<ReturnType<typeof signIn>>["asUser"]) {
  const sessionId = await asUser.mutation(api.sessions.start, {});
  const setIds: Array<Id<"sets">> = [];
  for (const weightLb of [135, 185, 155]) {
    vi.setSystemTime(Date.now() + 60_000);
    setIds.push((await asUser.mutation(api.sets.log, { sessionId, exerciseName: "bench", reps: 5, weightLb })).setId);
  }
  await asUser.mutation(api.sets.log, { sessionId, exerciseName: "plank", durationSec: 60, calories: 10 });
  await asUser.mutation(api.sets.log, { sessionId, exerciseName: "run", distanceM: 5_000, durationSec: 1_500 });
  await drain(t);
  return setIds;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-01T12:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("checking exercise stats in production", () => {
  test("consistent stats report no mismatches", async () => {
    const t = testBackend();
    const { userId, asUser } = await signIn(t, "Ada");
    await logHistory(t, asUser);
    const bench = await exerciseNamed(t, "bench");
    const row = await statsRow(t, bench);

    const result = await t.query(internal.exerciseStats.auditExercise, { userId, exerciseId: bench });
    expect(result).toMatchObject({
      name: "bench",
      checked: true,
      reason: null,
      statsRows: 1,
      ready: true,
      dirty: false,
      generation: row.generation,
      step: row.step ?? null,
      setsRead: 3,
      mismatches: [],
    });

    const page = await t.query(internal.exerciseStats.auditUser, { userId, cursor: null });
    expect(page).toEqual({ exercises: 3, clean: 3, flagged: [], continueCursor: null });
  });

  test("a corrupted row, a lost stamp, and a stale mark are reported", async () => {
    const t = testBackend();
    const { userId, asUser } = await signIn(t, "Ben");
    const [, heaviest, last] = await logHistory(t, asUser);
    const bench = await exerciseNamed(t, "bench");
    const row = await statsRow(t, bench);
    await t.run(async (ctx) => {
      const lighter = await ctx.db.get("sets", last!);
      await ctx.db.patch("exerciseStats", row._id, {
        setCount: 4,
        bestWeight: { ...row.bestWeight!, setId: lighter!._id, weightLb: 155, loggedAt: lighter!.loggedAt },
      });
      await ctx.db.patch("sets", heaviest!, { recordStamps: [] });
      await ctx.db.insert("recordMarks", {
        userId,
        exerciseId: bench,
        generation: row.generation - 1,
        metric: "weight",
        setId: lighter!._id,
        sessionId: lighter!.sessionId,
        loggedAt: lighter!.loggedAt,
        reps: 5,
        weightLb: 155,
        epleyLb: null,
        durationSec: null,
        distanceM: null,
        calories: null,
      });
    });

    const result = await t.query(internal.exerciseStats.auditExercise, { userId, exerciseId: bench });
    expect(result.checked).toBe(true);
    expect(result.mismatches).toEqual([
      "setCount 4, expected 3",
      expect.stringMatching(new RegExp(`^set ${heaviest} \\(185x5 at \\d+\\): stamps \\[\\], expected \\[\\["both"`)),
      expect.stringMatching(/^bestWeight .*155.*, expected .*185/),
      "1 marks from another generation",
    ]);

    const page = await t.query(internal.exerciseStats.auditUser, { userId, cursor: null });
    expect(page.clean).toBe(2);
    expect(page.flagged.map((item) => item.name)).toEqual(["bench"]);
  });

  test("duplicate rows, a rebuilding row, and another user's exercise are reported", async () => {
    const t = testBackend();
    const { userId, asUser } = await signIn(t, "Cal");
    const { userId: otherId } = await signIn(t, "Dot");
    await logHistory(t, asUser);
    const bench = await exerciseNamed(t, "bench");
    const plank = await exerciseNamed(t, "plank");
    const benchRow = await statsRow(t, bench);
    await t.run(async (ctx) => {
      const { _id, _creationTime, ...copy } = benchRow;
      void _id;
      void _creationTime;
      await ctx.db.insert("exerciseStats", copy);
    });
    // Deleting the plank's only set rebuilds its row, and nothing runs the pages yet.
    const plankSet = await t.run(async (ctx) => {
      const sets = await ctx.db.query("sets").collect();
      return sets.find((set) => set.exerciseId === plank)!._id;
    });
    await asUser.mutation(api.sets.remove, { setId: plankSet });

    expect(await t.query(internal.exerciseStats.auditExercise, { userId, exerciseId: bench })).toMatchObject({
      checked: true,
      statsRows: 2,
      mismatches: ["2 stats rows; readers ignore them until a write keeps one"],
    });
    expect(await t.query(internal.exerciseStats.auditExercise, { userId, exerciseId: plank })).toMatchObject({
      checked: false,
      reason: "rebuilding",
      ready: false,
      mismatches: [],
    });
    expect(await t.query(internal.exerciseStats.auditExercise, { userId: otherId, exerciseId: bench })).toMatchObject({
      checked: false,
      reason: "exercise not found",
      name: null,
    });

    const page = await t.query(internal.exerciseStats.auditUser, { userId, cursor: null });
    expect(page.clean).toBe(1);
    expect(page.flagged.map((item) => [item.name, item.reason, item.statsRows])).toEqual([
      ["bench", null, 2],
      ["plank", "rebuilding", 1],
    ]);

    await drain(t);
    const healed = await t.query(internal.exerciseStats.auditUser, { userId, cursor: null });
    expect(healed.flagged.map((item) => item.name)).toEqual(["bench"]);
  });

  test(
    "a history past 4,000 sets is not checked, and a page stops after it",
    async () => {
      const t = testBackend();
      const { userId } = await signIn(t, "Eve");
      const large = await t.run(async (ctx) => {
        const exerciseId = await ctx.db.insert("exercises", { userId, name: "Aaa", normalizedName: "aaa", createdAt: 1 });
        const sessionId = await ctx.db.insert("sessions", { userId, status: "completed", startedAt: 1_000, completedAt: 2_000 });
        for (let index = 0; index < 4_001; index += 1) {
          await ctx.db.insert("sets", { userId, sessionId, exerciseId, reps: 5, weightLb: 100, loggedAt: 1_000 + index });
        }
        for (const name of ["Bbb", "Ccc"]) {
          await ctx.db.insert("exercises", { userId, name, normalizedName: name.toLowerCase(), createdAt: 1 });
        }
        return exerciseId;
      });

      expect(await t.query(internal.exerciseStats.auditExercise, { userId, exerciseId: large })).toMatchObject({
        checked: false,
        reason: "too many sets",
        setsRead: 4_001,
        mismatches: [],
      });

      const first = await t.query(internal.exerciseStats.auditUser, { userId, cursor: null });
      expect(first).toMatchObject({ exercises: 1, clean: 0, continueCursor: "aaa" });
      expect(first.flagged[0]?.reason).toBe("too many sets");
      const second = await t.query(internal.exerciseStats.auditUser, { userId, cursor: first.continueCursor });
      expect(second).toEqual({ exercises: 2, clean: 2, flagged: [], continueCursor: null });
    },
    60_000,
  );

  test("a page holds ten exercises, and the cursor picks up after them", async () => {
    const t = testBackend();
    const { userId, asUser } = await signIn(t, "Fin");
    const sessionId = await asUser.mutation(api.sessions.start, {});
    for (let index = 0; index < 12; index += 1) {
      await asUser.mutation(api.sets.log, { sessionId, exerciseName: `lift ${String(index).padStart(2, "0")}`, reps: 5, weightLb: 50 });
    }
    await drain(t);

    const first = await t.query(internal.exerciseStats.auditUser, { userId, cursor: null });
    expect(first).toEqual({ exercises: 10, clean: 10, flagged: [], continueCursor: "lift09" });
    const second = await t.query(internal.exerciseStats.auditUser, { userId, cursor: first.continueCursor });
    expect(second).toEqual({ exercises: 2, clean: 2, flagged: [], continueCursor: null });
  });
});
