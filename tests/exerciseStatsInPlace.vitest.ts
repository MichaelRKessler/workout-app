/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { announcedRecords, recordAfterEdit } from "../convex/lib/records";
import type { SetType } from "../convex/lib/setType";
import { recordPoint } from "../convex/lib/workouts";
import schema from "../convex/schema";
import { seeded } from "./seeded";
import { audit } from "./statsAudit";

const modules = import.meta.glob("../convex/**/*.ts");
const DAY = 24 * 60 * 60 * 1000;

function testBackend() {
  return convexTest(schema, modules);
}

type Backend = ReturnType<typeof testBackend>;

async function signIn(t: Backend, name: string) {
  const email = `${name.toLowerCase()}.inplace@example.com`;
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

function tick(ms = 60_000) {
  vi.setSystemTime(Date.now() + ms);
}

async function statsRow(t: Backend, exerciseId: Id<"exercises">) {
  const rows = await t.run(async (ctx) => {
    const all = await ctx.db.query("exerciseStats").collect();
    return all.filter((row) => row.exerciseId === exerciseId);
  });
  expect(rows).toHaveLength(1);
  return rows[0]!;
}

/** Rebuild pages waiting to run. Zero right after a write means it scheduled none. */
async function queuedPages(t: Backend): Promise<number> {
  return await t.run(async (ctx) => {
    const jobs = await ctx.db.system.query("_scheduled_functions").collect();
    return jobs.filter((job) => job.name.includes("rebuildPage") && job.state.kind === "pending").length;
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

async function stampsOf(t: Backend, setId: Id<"sets">) {
  return await t.run(async (ctx) => (await ctx.db.get("sets", setId))?.recordStamps);
}

/** Expects the last write to have kept the row ready under the same generation, with nothing queued. */
async function expectKeptInPlace(t: Backend, exerciseId: Id<"exercises">, generation: number) {
  const row = await statsRow(t, exerciseId);
  expect(row.ready).toBe(true);
  expect(row.generation).toBe(generation);
  expect(await queuedPages(t)).toBe(0);
  expect(await audit(t)).toEqual([]);
  return row;
}

async function pastSession(t: Backend, userId: Id<"users">, startedAt: number) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("sessions", {
      userId,
      status: "completed",
      startedAt,
      completedAt: startedAt + 60 * 60 * 1000,
      setCount: 0,
    });
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-01T12:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("changes that leave the bests alone skip the rebuild", () => {
  test(
    "deleting an ordinary set on a 2,251-set history keeps the 315 lb best",
    async () => {
      const t = testBackend();
      const { userId, asUser } = await signIn(t, "Rae");
      const { exerciseId, ordinary } = await t.run(async (ctx) => {
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
        await ctx.db.insert("sets", { userId, sessionId: heavySession, exerciseId, reps: 5, weightLb: 315, loggedAt: 1_000 });
        const setIds: Array<Id<"sets">> = [];
        for (let sessionIndex = 0; sessionIndex < 9; sessionIndex += 1) {
          const startedAt = 10_000 + sessionIndex * 1_000;
          const sessionId = await ctx.db.insert("sessions", {
            userId,
            status: "completed",
            startedAt,
            completedAt: startedAt + 1,
            setCount: 250,
            lastSetAt: startedAt + 250,
          });
          for (let index = 0; index < 250; index += 1) {
            setIds.push(
              await ctx.db.insert("sets", { userId, sessionId, exerciseId, reps: 8, weightLb: 135, loggedAt: startedAt + index + 1 }),
            );
          }
        }
        return { exerciseId, ordinary: setIds[1_200]! };
      });
      await t.mutation(internal.exerciseStats.backfillTick, {});
      await drain(t);
      const built = await statsRow(t, exerciseId);
      expect(built).toMatchObject({ ready: true, setCount: 2_251 });
      expect(built.bestWeight?.weightLb).toBe(315);

      await asUser.mutation(api.sets.remove, { setId: ordinary });
      const removed = await expectKeptInPlace(t, exerciseId, built.generation);
      expect(removed.setCount).toBe(2_250);
      expect(removed.lastLoggedAt).toBe(built.lastLoggedAt);
      const detail = await asUser.query(api.exercises.detail, { exerciseId });
      expect(detail?.recordsComplete).toBe(true);
      expect(detail?.bestWeight?.weightLb).toBe(315);

      const sessionId = await asUser.mutation(api.sessions.start, {});
      const logged = await asUser.mutation(api.sets.log, { sessionId, exerciseName: "bench press", reps: 5, weightLb: 185 });
      expect(logged.personalRecord).toBeNull();

      // The newest set goes too, so the row reads the next newest time.
      await asUser.mutation(api.sets.remove, { setId: logged.setId });
      const latestRemoved = await expectKeptInPlace(t, exerciseId, built.generation);
      expect(latestRemoved.setCount).toBe(2_250);
      expect(latestRemoved.lastLoggedAt).toBe(built.lastLoggedAt);
    },
    60_000,
  );

  test("editing a set that holds no record keeps the row ready; editing it into a record at its own time rebuilds", async () => {
    const t = testBackend();
    const { asUser } = await signIn(t, "Sal");
    const sessionId = await asUser.mutation(api.sessions.start, {});
    const setIds: Array<Id<"sets">> = [];
    for (const weightLb of [100, 90, 80, 120]) {
      tick();
      setIds.push((await asUser.mutation(api.sets.log, { sessionId, exerciseName: "row", reps: 5, weightLb })).setId);
    }
    const exerciseId = await exerciseNamed(t, "row");
    const { generation } = await statsRow(t, exerciseId);

    const edited = await asUser.mutation(api.sets.update, { setId: setIds[1]!, reps: 5, weightLb: 95 });
    expect(edited).toBeNull();
    await expectKeptInPlace(t, exerciseId, generation);
    expect(await stampsOf(t, setIds[1]!)).toEqual([]);

    // 110 is below today's 120, but it beat the 100 that stood when it was logged.
    const raised = await asUser.mutation(api.sets.update, { setId: setIds[2]!, reps: 5, weightLb: 110 });
    expect(raised).toEqual(expect.objectContaining({ kind: "both", weightLb: 110 }));
    expect((await statsRow(t, exerciseId)).ready).toBe(false);
    await drain(t);
    expect(await audit(t)).toEqual([]);
    expect((await stampsOf(t, setIds[2]!))?.map((stamp) => stamp.kind)).toEqual(["both"]);
  });

  test("editing the latest set into a new best folds it in, and deleting that best rebuilds", async () => {
    const t = testBackend();
    const { asUser } = await signIn(t, "Tam");
    const sessionId = await asUser.mutation(api.sessions.start, {});
    for (const weightLb of [100, 120]) {
      tick();
      await asUser.mutation(api.sets.log, { sessionId, exerciseName: "squat", reps: 5, weightLb });
    }
    tick();
    const latest = await asUser.mutation(api.sets.log, { sessionId, exerciseName: "squat", reps: 5, weightLb: 90 });
    expect(latest.personalRecord).toBeNull();
    const exerciseId = await exerciseNamed(t, "squat");
    const { generation } = await statsRow(t, exerciseId);

    const raised = await asUser.mutation(api.sets.update, { setId: latest.setId, reps: 5, weightLb: 150 });
    expect(raised).toEqual(expect.objectContaining({ kind: "both", weightLb: 150 }));
    const folded = await expectKeptInPlace(t, exerciseId, generation);
    expect(folded.bestWeight?.setId).toBe(latest.setId);
    expect((await stampsOf(t, latest.setId))?.map((stamp) => stamp.kind)).toEqual(["both"]);

    tick();
    const lighter = await asUser.mutation(api.sets.log, { sessionId, exerciseName: "squat", reps: 5, weightLb: 140 });
    expect(lighter.personalRecord).toBeNull();

    // RPE is not part of any record, so the record set keeps its stamp without a rebuild.
    await asUser.mutation(api.sets.update, { setId: latest.setId, reps: 5, weightLb: 150, rpe: 8 });
    await expectKeptInPlace(t, exerciseId, generation);

    await asUser.mutation(api.sets.remove, { setId: latest.setId });
    expect((await statsRow(t, exerciseId)).ready).toBe(false);
    await drain(t);
    expect(await audit(t)).toEqual([]);
    const detail = await asUser.query(api.exercises.detail, { exerciseId });
    expect(detail?.recordsComplete).toBe(true);
    expect(detail?.bestWeight?.weightLb).toBe(140);
  });

  test("a past set that is no record at its own time is added in place; one that was a record then rebuilds", async () => {
    const t = testBackend();
    const { userId, asUser } = await signIn(t, "Uma");
    const morning = await pastSession(t, userId, Date.now() - 2 * DAY);
    const sessionId = await asUser.mutation(api.sessions.start, {});
    for (const weightLb of [100, 120]) {
      tick();
      await asUser.mutation(api.sets.log, { sessionId, exerciseName: "press", reps: 5, weightLb });
    }
    // An older workout's best, logged ahead of the 100 lb set.
    const early = await asUser.mutation(api.sets.log, { sessionId: morning, exerciseName: "press", reps: 5, weightLb: 95 });
    expect(early.personalRecord).toEqual(expect.objectContaining({ weightLb: 95 }));
    await drain(t);
    const exerciseId = await exerciseNamed(t, "press");
    const before = await statsRow(t, exerciseId);
    expect(await audit(t)).toEqual([]);

    const warmup = await asUser.mutation(api.sets.log, { sessionId: morning, exerciseName: "press", reps: 5, weightLb: 150, setType: "warmup" });
    expect(warmup.personalRecord).toBeNull();
    const lighter = await asUser.mutation(api.sets.log, { sessionId: morning, exerciseName: "press", reps: 3, weightLb: 90 });
    expect(lighter.personalRecord).toBeNull();
    const row = await expectKeptInPlace(t, exerciseId, before.generation);
    expect(row.setCount).toBe(5);
    expect(row.lastLoggedAt).toBe(before.lastLoggedAt);
    expect(await stampsOf(t, lighter.setId)).toEqual([]);

    const record = await asUser.mutation(api.sets.log, { sessionId: morning, exerciseName: "press", reps: 5, weightLb: 98 });
    expect(record.personalRecord).toEqual(expect.objectContaining({ weightLb: 98 }));
    expect((await statsRow(t, exerciseId)).ready).toBe(false);
    await drain(t);
    expect(await audit(t)).toEqual([]);
  });

  test("calories come off a session that never held the calorie record; a session that did rebuilds", async () => {
    const t = testBackend();
    const { userId, asUser } = await signIn(t, "Vic");
    const start = Date.now() - 10 * DAY;
    const sessions: Array<Id<"sessions">> = [];
    for (let index = 0; index < 5; index += 1) {
      sessions.push(await pastSession(t, userId, start + index * DAY));
    }
    const [first, second, third, fourth, fifth] = sessions as [
      Id<"sessions">, Id<"sessions">, Id<"sessions">, Id<"sessions">, Id<"sessions">,
    ];
    const log = async (sessionId: Id<"sessions">, calories: number) =>
      await asUser.mutation(api.sets.log, { sessionId, exerciseName: "rower", distanceM: 500, durationSec: 120, calories });
    await log(first, 120);
    // 100 is no record, then 50 more makes the second workout the record at 150.
    const unstamped = await log(second, 100);
    const stamped = await log(second, 50);
    expect(stamped.personalRecord).toEqual(expect.objectContaining({ kind: "calories", calories: 150 }));
    await log(third, 200);
    const runnerUp = await log(fourth, 90);
    await log(fourth, 90);
    const small = await log(fifth, 40);
    const exerciseId = await exerciseNamed(t, "rower");
    expect(await audit(t)).toEqual([]);
    const { generation } = await statsRow(t, exerciseId);

    await asUser.mutation(api.sets.remove, { setId: small.setId });
    await expectKeptInPlace(t, exerciseId, generation);

    // The second workout is neither best nor second best now, but it was the
    // record once. Without its first 100, its 50 is no record at its time.
    await asUser.mutation(api.sets.remove, { setId: unstamped.setId });
    expect((await statsRow(t, exerciseId)).ready).toBe(false);
    await drain(t);
    expect(await audit(t)).toEqual([]);
    expect(await stampsOf(t, stamped.setId)).toEqual([]);

    // The fourth workout holds the second best, which this lowers.
    await asUser.mutation(api.sets.remove, { setId: runnerUp.setId });
    expect((await statsRow(t, exerciseId)).ready).toBe(false);
    await drain(t);
    expect(await audit(t)).toEqual([]);
  });

  test("deleting a short workout keeps the rows ready, and a long one rebuilds", async () => {
    const t = testBackend();
    const { userId, asUser } = await signIn(t, "Ora");
    const heavy = await pastSession(t, userId, Date.now() - 3 * DAY);
    const short = await pastSession(t, userId, Date.now() - 2 * DAY);
    const long = await pastSession(t, userId, Date.now() - DAY);
    await asUser.mutation(api.sets.log, { sessionId: heavy, exerciseName: "deadlift", reps: 5, weightLb: 405 });
    await asUser.mutation(api.sets.log, { sessionId: heavy, exerciseName: "plank", durationSec: 120 });
    for (let index = 0; index < 3; index += 1) {
      await asUser.mutation(api.sets.log, { sessionId: short, exerciseName: "deadlift", reps: 5, weightLb: 315 });
      await asUser.mutation(api.sets.log, { sessionId: short, exerciseName: "plank", durationSec: 60 });
    }
    await asUser.mutation(api.sets.logMany, {
      sessionId: long,
      exerciseName: "deadlift",
      sets: Array.from({ length: 30 }, () => ({ reps: 5, weightLb: 225 })),
    });
    await asUser.mutation(api.sets.log, { sessionId: long, exerciseName: "plank", durationSec: 45 });
    const deadlift = await exerciseNamed(t, "deadlift");
    const plank = await exerciseNamed(t, "plank");
    expect(await audit(t)).toEqual([]);
    const generations = [(await statsRow(t, deadlift)).generation, (await statsRow(t, plank)).generation];

    await asUser.mutation(api.sessions.remove, { sessionId: short });
    await expectKeptInPlace(t, deadlift, generations[0]!);
    await expectKeptInPlace(t, plank, generations[1]!);

    await asUser.mutation(api.sessions.remove, { sessionId: long });
    expect((await statsRow(t, deadlift)).ready).toBe(false);
    expect((await statsRow(t, plank)).ready).toBe(false);
    await drain(t);
    expect(await audit(t)).toEqual([]);
  });

  test("changing a set's calories rebuilds, and so does a past set that adds calories", async () => {
    const t = testBackend();
    const { userId, asUser } = await signIn(t, "Wyn");
    const start = Date.now() - 10 * DAY;
    const sessions: Array<Id<"sessions">> = [];
    for (let index = 0; index < 4; index += 1) {
      sessions.push(await pastSession(t, userId, start + index * DAY));
    }
    const [earliest, first, second, third] = sessions as [Id<"sessions">, Id<"sessions">, Id<"sessions">, Id<"sessions">];
    const log = async (sessionId: Id<"sessions">, calories: number) =>
      await asUser.mutation(api.sets.log, { sessionId, exerciseName: "bike", durationSec: 600, calories });
    await log(first, 100);
    const middle = await log(second, 50);
    const last = await log(third, 80);
    expect(last.personalRecord).toBeNull();
    const exerciseId = await exerciseNamed(t, "bike");
    expect(await audit(t)).toEqual([]);

    // Same time, more calories: no time record, but a calorie record at its own time.
    const edited = await asUser.mutation(api.sets.update, { setId: middle.setId, durationSec: 600, calories: 120 });
    expect(edited).toEqual(expect.objectContaining({ kind: "calories", calories: 120 }));
    expect((await statsRow(t, exerciseId)).ready).toBe(false);
    await drain(t);
    expect(await audit(t)).toEqual([]);

    await asUser.mutation(api.sets.log, { sessionId: earliest, exerciseName: "bike", durationSec: 900 });
    await drain(t);
    // A shorter ride after it: no time record, but the first calories logged.
    const past = await asUser.mutation(api.sets.log, { sessionId: earliest, exerciseName: "bike", durationSec: 300, calories: 150 });
    expect(past.personalRecord).toEqual(expect.objectContaining({ kind: "calories", calories: 150 }));
    expect((await statsRow(t, exerciseId)).ready).toBe(false);
    await drain(t);
    expect(await audit(t)).toEqual([]);
  });
});

describe("a running rebuild", () => {
  async function seedHistory(t: Backend, userId: Id<"users">) {
    return await t.run(async (ctx) => {
      const exerciseId = await ctx.db.insert("exercises", { userId, name: "Curl", normalizedName: "curl", createdAt: 1 });
      const sessionId = await ctx.db.insert("sessions", {
        userId,
        status: "completed",
        startedAt: 1_000,
        completedAt: 2_000,
        setCount: 120,
        lastSetAt: 1_119,
      });
      const setIds: Array<Id<"sets">> = [];
      for (let index = 0; index < 120; index += 1) {
        setIds.push(
          await ctx.db.insert("sets", {
            userId,
            sessionId,
            exerciseId,
            reps: 8,
            weightLb: index === 0 ? 80 : 50 + (index % 7),
            loggedAt: 1_000 + index,
          }),
        );
      }
      return { exerciseId, setIds };
    });
  }

  /** Runs queued pages by hand until the walk has read at least one page. */
  async function walkOnePage(t: Backend, userId: Id<"users">, exerciseId: Id<"exercises">) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const row = await statsRow(t, exerciseId);
      if (row.phase === "walk" && row.cursor !== null) {
        return row;
      }
      await t.mutation(internal.exerciseStats.rebuildPage, {
        userId,
        exerciseId,
        generation: row.generation,
        cursor: row.cursor,
        step: row.step ?? 0,
      });
    }
    throw new Error("The rebuild never reached the walk");
  }

  test("a set logged after the walked part does not restart it, and an edit inside it does", async () => {
    const t = testBackend();
    const { userId, asUser } = await signIn(t, "Wes");
    const { exerciseId, setIds } = await seedHistory(t, userId);
    await t.mutation(internal.exerciseStats.backfillTick, {});
    await drain(t);

    await asUser.mutation(api.sets.remove, { setId: setIds[0]! });
    const walking = await walkOnePage(t, userId, exerciseId);
    expect(walking.walkedThrough).toBeLessThan(1_119);

    const sessionId = await asUser.mutation(api.sessions.start, {});
    await asUser.mutation(api.sets.log, { sessionId, exerciseName: "curl", reps: 8, weightLb: 60 });
    expect((await statsRow(t, exerciseId)).dirty).toBe(false);
    await drain(t);
    const finished = await statsRow(t, exerciseId);
    expect(finished.generation).toBe(walking.generation);
    expect(finished.setCount).toBe(120);
    expect(await audit(t)).toEqual([]);

    await asUser.mutation(api.sets.remove, { setId: setIds[1]! });
    const again = await walkOnePage(t, userId, exerciseId);
    await asUser.mutation(api.sets.update, { setId: setIds[2]!, reps: 8, weightLb: 75 });
    expect((await statsRow(t, exerciseId)).dirty).toBe(true);
    await drain(t);
    expect((await statsRow(t, exerciseId)).generation).toBeGreaterThan(again.generation);
    expect(await audit(t)).toEqual([]);
  });
});

describe("rows built under the old distance rule", () => {
  test("an untimed distance best is rebuilt once, and the faster 5,000 m is announced", async () => {
    const t = testBackend();
    const { userId, asUser } = await signIn(t, "Xia");
    const exerciseId = await t.run(async (ctx) => {
      const exerciseId = await ctx.db.insert("exercises", { userId, name: "Run", normalizedName: "run", createdAt: 1 });
      const sessionId = await ctx.db.insert("sessions", {
        userId,
        status: "completed",
        startedAt: 1_000,
        completedAt: 5_000,
        setCount: 2,
        lastSetAt: 1_001,
      });
      const untimed = await ctx.db.insert("sets", {
        userId,
        sessionId,
        exerciseId,
        weightLb: 0,
        distanceM: 5_000,
        loggedAt: 1_000,
        recordStamps: [{ kind: "distance", reps: null, weightLb: 0, epleyLb: null, durationSec: null, distanceM: 5_000, calories: null }],
      });
      await ctx.db.insert("sets", {
        userId,
        sessionId,
        exerciseId,
        weightLb: 0,
        distanceM: 5_000,
        durationSec: 1_500,
        loggedAt: 1_001,
        recordStamps: [],
      });
      const snap = {
        setId: untimed,
        sessionId,
        loggedAt: 1_000,
        reps: null,
        weightLb: 0,
        epleyLb: null,
        durationSec: null,
        distanceM: 5_000,
      };
      await ctx.db.insert("recordMarks", {
        userId,
        exerciseId,
        generation: 1,
        metric: "distance",
        ...snap,
        calories: null,
      });
      // What the earlier code stored: the untimed holder, and no rules version.
      await ctx.db.insert("exerciseStats", {
        userId,
        exerciseId,
        setCount: 2,
        lastLoggedAt: 1_001,
        ready: true,
        dirty: false,
        drop: false,
        generation: 1,
        cursor: null,
        phase: "walk",
        scheduledAt: 1,
        bestWeight: null,
        bestEpley: null,
        bestReps: null,
        bestDuration: null,
        bestDistance: snap,
        bestCalories: null,
        secondCalories: null,
      });
      return exerciseId;
    });

    const sessionId = await asUser.mutation(api.sessions.start, {});
    const faster = await asUser.mutation(api.sets.log, { sessionId, exerciseName: "run", distanceM: 5_000, durationSec: 1_400 });
    expect(faster.personalRecord).toEqual(expect.objectContaining({ kind: "distance", durationSec: 1_400 }));
    await drain(t);
    const row = await statsRow(t, exerciseId);
    expect(row.recordRules).toBe(2);
    expect(row.bestDistance?.setId).toBe(faster.setId);
    expect(await audit(t)).toEqual([]);
  });

  test("5,000 m untimed, then in 1,500 s, then in 1,400 s announces the last as a record", async () => {
    const t = testBackend();
    const { asUser } = await signIn(t, "Yan");
    const sessionId = await asUser.mutation(api.sessions.start, {});
    const results = [];
    for (const durationSec of [undefined, 1_500, 1_400]) {
      tick();
      results.push(await asUser.mutation(api.sets.log, { sessionId, exerciseName: "run", distanceM: 5_000, durationSec }));
    }
    expect(results.map((result) => result.personalRecord?.kind ?? null)).toEqual(["distance", null, "distance"]);
    expect(await audit(t)).toEqual([]);

    // The 1,500 s set holds no record but set the time to beat, so deleting it rebuilds.
    const [, timed, faster] = results;
    expect(await stampsOf(t, timed!.setId)).toEqual([]);
    await asUser.mutation(api.sets.remove, { setId: timed!.setId });
    const exerciseId = await exerciseNamed(t, "run");
    expect((await statsRow(t, exerciseId)).ready).toBe(false);
    await drain(t);
    expect(await audit(t)).toEqual([]);
    expect(await stampsOf(t, faster!.setId)).toEqual([]);
  });
});

describe("a random mix of logs, past sets, edits, and deletes", () => {
  type Measures = {
    reps?: number;
    weightLb: number;
    durationSec?: number;
    distanceM?: number;
    calories?: number;
    setType: SetType;
  };

  function randomMeasures(random: ReturnType<typeof seeded>): Measures {
    const kind = random.pick(["strength", "strength", "bodyweight", "timed", "distance"] as const);
    const setType = random.pick(["working", "working", "working", "warmup", "drop", "failure"] as const);
    const calories = random.next() < 0.3 ? random.pick([10, 20, 40]) : undefined;
    if (kind === "strength") {
      return { reps: random.pick([3, 5, 5, 8]), weightLb: random.pick([95, 135, 135, 185]), calories, setType };
    }
    if (kind === "bodyweight") {
      return { reps: random.pick([8, 10, 12]), weightLb: 0, calories, setType };
    }
    if (kind === "timed") {
      return { durationSec: random.pick([30, 60, 60]), weightLb: random.pick([0, 20]), calories, setType };
    }
    return {
      distanceM: random.pick([1_000, 5_000, 5_000]),
      durationSec: random.pick([undefined, undefined, 1_400, 1_500]),
      weightLb: 0,
      calories,
      setType,
    };
  }

  async function history(t: Backend) {
    return await t.run(async (ctx) => {
      const exercise = (await ctx.db.query("exercises").collect())[0] ?? null;
      if (!exercise?.userId) {
        return { exercise: null, sets: [] };
      }
      const userId = exercise.userId;
      const sets = await ctx.db
        .query("sets")
        .withIndex("by_user_exercise_and_logged", (q) => q.eq("userId", userId).eq("exerciseId", exercise._id))
        .collect();
      return { exercise, sets };
    });
  }

  test("every row kept in place matches a rebuild, and every announcement matches the scan", async () => {
    const t = testBackend();
    const { userId, asUser } = await signIn(t, "Zed");
    const random = seeded(95);
    const past: Array<Id<"sessions">> = [];
    for (let index = 0; index < 4; index += 1) {
      past.push(await pastSession(t, userId, Date.now() - (10 - index) * DAY));
    }
    const open = await asUser.mutation(api.sessions.start, {});
    let kept = 0;
    let rebuilt = 0;
    for (let step = 0; step < 150; step += 1) {
      const { exercise, sets } = await history(t);
      const before = exercise ? await statsRow(t, exercise._id) : null;
      const earlierThan = (loggedAt: number) =>
        sets.filter((set) => set.loggedAt < loggedAt).map((set) => recordPoint(set));
      const roll = random.next();
      const action = sets.length < 3 || roll < 0.4 ? "append" : roll < 0.55 ? "past" : roll < 0.75 ? "remove" : "edit";
      if (action === "append" || action === "past") {
        tick();
        const measures = randomMeasures(random);
        const sessionId = action === "past" ? random.pick(past) : open;
        const logged = await asUser.mutation(api.sets.log, { sessionId, exerciseName: "mixed", ...measures });
        const saved = await t.run(async (ctx) => await ctx.db.get("sets", logged.setId));
        const expected = announcedRecords(
          exercise?.name ?? "mixed",
          [recordPoint({ ...measures, sessionId })],
          earlierThan(saved!.loggedAt),
        ).headline;
        expect(logged.personalRecord, `step ${step}: ${action}`).toEqual(expected);
      } else if (action === "remove") {
        await asUser.mutation(api.sets.remove, { setId: random.pick(sets)._id });
      } else {
        const target = random.pick(sets);
        // A quarter of edits change only RPE.
        const measures: Measures =
          random.next() < 0.25
            ? {
                reps: target.reps,
                weightLb: target.weightLb,
                durationSec: target.durationSec,
                distanceM: target.distanceM,
                calories: target.calories,
                setType: target.setType ?? "working",
              }
            : randomMeasures(random);
        const announced = await asUser.mutation(api.sets.update, { setId: target._id, ...measures, rpe: 8 });
        const expected = recordAfterEdit(
          exercise!.name,
          recordPoint(target),
          recordPoint({ ...measures, sessionId: target.sessionId }),
          earlierThan(target.loggedAt),
        );
        expect(announced, `step ${step}: edit`).toEqual(expected);
      }
      const exerciseId = exercise?._id ?? (await exerciseNamed(t, "mixed"));
      const after = await statsRow(t, exerciseId);
      if (!after.ready) {
        rebuilt += 1;
        await drain(t);
      } else if (before && action !== "append" && after.generation === before.generation && (await queuedPages(t)) === 0) {
        kept += 1;
      }
      expect(await audit(t), `step ${step}: ${action}`).toEqual([]);
    }
    expect(kept).toBeGreaterThan(15);
    expect(rebuilt).toBeGreaterThan(10);
  }, 60_000);
});
