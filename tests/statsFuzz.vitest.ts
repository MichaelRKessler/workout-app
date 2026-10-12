/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import type { Doc, Id } from "../convex/_generated/dataModel";
import type { SetType } from "../convex/lib/setType";
import schema from "../convex/schema";
import { seeded } from "./seeded";
import { audit, auditBetweenWrites } from "./statsAudit";

const modules = import.meta.glob("../convex/**/*.ts");
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const STALL_MS = 2 * MINUTE;
const NAMES = ["Bench Press", "Row", "Run", "Plank", "Bike", "Squat"];
// A few seeds keep `npm test` quick. Search longer with, for example,
// STATS_FUZZ_SEEDS=1-200 STATS_FUZZ_STEPS=300 npx vitest run tests/statsFuzz.vitest.ts
const SEEDS = seedList(process.env.STATS_FUZZ_SEEDS) ?? [11, 23, 37, 41, 58, 64];
const STEPS = Number(process.env.STATS_FUZZ_STEPS) || 140;

function seedList(value: string | undefined): number[] | null {
  if (!value) {
    return null;
  }
  return value.split(",").flatMap((part) => {
    const [low = 0, high = low] = part.split("-").map(Number);
    return Array.from({ length: high - low + 1 }, (_, index) => low + index);
  });
}

type Backend = ReturnType<typeof testBackend>;
type Random = ReturnType<typeof seeded>;
type User = Awaited<ReturnType<typeof signIn>>;

type Measures = {
  reps?: number;
  weightLb: number;
  durationSec?: number;
  distanceM?: number;
  calories?: number;
  setType?: SetType;
};

/** A set this phone queued, kept so later batches can revise or remove it. */
type ClientSet = {
  clientId: string;
  revision: number;
  removed: boolean;
  placement: "open" | "completed";
  sessionClientId: string;
  sessionStartedAt: number;
  exerciseName: string;
  loggedAt: number;
};

type Op =
  | "log"
  | "logMany"
  | "logWorkout"
  | "logPast"
  | "update"
  | "remove"
  | "removeMany"
  | "removeWorkout"
  | "removeDay"
  | "finish"
  | "offline"
  | "merge"
  | "rename"
  | "otherUser"
  | "cron"
  | "replayPage";

const WEIGHTS: Array<[Op, number]> = [
  ["log", 14],
  ["logMany", 5],
  ["logWorkout", 4],
  ["logPast", 6],
  ["update", 11],
  ["remove", 8],
  ["removeMany", 3],
  ["removeWorkout", 2],
  ["removeDay", 1],
  ["finish", 3],
  ["offline", 10],
  ["merge", 4],
  ["rename", 2],
  ["otherUser", 2],
  ["cron", 4],
  ["replayPage", 6],
];

function testBackend() {
  return convexTest(schema, modules);
}

async function signIn(t: Backend, name: string) {
  const email = `${name.toLowerCase()}.fuzz@example.com`;
  const userId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("users", { name, email });
    await ctx.db.insert("allowedEmails", { email, createdAt: Date.now() });
    return id;
  });
  return { userId, asUser: t.withIdentity({ subject: `${userId}|${name}-session` }) };
}

function between(random: Random, low: number, high: number): number {
  return low + Math.floor(random.next() * (high - low + 1));
}

function chance(random: Random, odds: number): boolean {
  return random.next() < odds;
}

function some<T>(random: Random, items: T[], count: number): T[] {
  const pool = [...items];
  const chosen: T[] = [];
  while (chosen.length < count && pool.length > 0) {
    chosen.push(pool.splice(Math.floor(random.next() * pool.length), 1)[0] as T);
  }
  return chosen;
}

function pickOp(random: Random): Op {
  const total = WEIGHTS.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = random.next() * total;
  for (const [op, weight] of WEIGHTS) {
    roll -= weight;
    if (roll < 0) {
      return op;
    }
  }
  return "log";
}

/** Few distinct values, so ties and records are common. */
function randomMeasures(random: Random): Measures {
  const kind = random.pick(["strength", "strength", "bodyweight", "timed", "distance", "distance"] as const);
  const setType = random.pick([undefined, undefined, "working", "warmup", "drop", "failure"] as const);
  const calories = chance(random, 0.3) ? random.pick([10, 20, 40]) : undefined;
  const extra = { ...(calories !== undefined ? { calories } : {}), ...(setType ? { setType } : {}) };
  if (kind === "strength") {
    return { reps: random.pick([3, 5, 5, 8]), weightLb: random.pick([95, 135, 135, 185]), ...extra };
  }
  if (kind === "bodyweight") {
    return { reps: random.pick([8, 10, 12]), weightLb: 0, ...extra };
  }
  if (kind === "timed") {
    return { durationSec: random.pick([30, 60, 60, 90]), weightLb: random.pick([0, 0, 20]), ...extra };
  }
  const durationSec = random.pick([undefined, undefined, 1_400, 1_500]);
  return {
    distanceM: random.pick([1_000, 5_000, 5_000]),
    ...(durationSec !== undefined ? { durationSec } : {}),
    weightLb: 0,
    ...extra,
  };
}

function sameMeasures(set: Doc<"sets">): Measures {
  return {
    weightLb: set.weightLb,
    ...(set.reps !== undefined ? { reps: set.reps } : {}),
    ...(set.durationSec !== undefined ? { durationSec: set.durationSec } : {}),
    ...(set.distanceM !== undefined ? { distanceM: set.distanceM } : {}),
    ...(set.calories !== undefined ? { calories: set.calories } : {}),
    ...(set.setType !== undefined ? { setType: set.setType } : {}),
  };
}

function describeMeasures(measures: Measures): string {
  return [
    measures.reps !== undefined ? `${measures.weightLb}x${measures.reps}` : measures.weightLb > 0 ? `${measures.weightLb}lb` : null,
    measures.durationSec !== undefined ? `${measures.durationSec}s` : null,
    measures.distanceM !== undefined ? `${measures.distanceM}m` : null,
    measures.calories !== undefined ? `${measures.calories}kcal` : null,
    measures.setType ?? null,
  ]
    .filter((part) => part !== null)
    .join(" ");
}

async function world(t: Backend, userId: Id<"users">) {
  return await t.run(async (ctx) => {
    const sets = (await ctx.db.query("sets").collect()).filter((set) => set.userId === userId);
    const sessions = (await ctx.db.query("sessions").collect()).filter((session) => session.userId === userId);
    const exercises = (await ctx.db.query("exercises").collect()).filter((exercise) => exercise.userId === userId);
    return { sets, sessions, exercises };
  });
}

type World = Awaited<ReturnType<typeof world>>;

/** Runs every queued function, including ones the queued ones schedule. */
async function drainAll(t: Backend) {
  await t.finishAllScheduledFunctions(() => {
    vi.runAllTimers();
  }, 1_000);
}

/** Runs only the next few queued functions, oldest first. */
async function drainSome(t: Backend, count: number): Promise<number> {
  let ran = 0;
  while (ran < count && vi.getTimerCount() > 0) {
    vi.advanceTimersToNextTimer();
    await t.finishInProgressScheduledFunctions();
    ran += 1;
  }
  return ran;
}

/** Every rebuild page ever queued, run or not. */
async function queuedPages(t: Backend) {
  return await t.run(async (ctx) => {
    const jobs = await ctx.db.system.query("_scheduled_functions").collect();
    return jobs
      .filter((job) => job.name.includes("rebuildPage"))
      .map((job) => ({
        pending: job.state.kind === "pending",
        args: job.args[0] as {
          userId: Id<"users">;
          exerciseId: Id<"exercises">;
          generation: number;
          cursor: string | null;
          step?: number;
        },
      }));
  });
}

/**
 * Screens that read stats, while rebuilds run. None of them may throw, and
 * the library's set counts must match. Two exercise pages and one day per
 * step, in turn, keep this quick.
 */
async function readScreens(user: User, snapshot: World, step: number): Promise<string[]> {
  const problems: string[] = [];
  const { exercises } = snapshot;
  for (const exercise of [exercises[step % exercises.length], exercises[(step + 1) % exercises.length]]) {
    if (exercise) {
      await user.asUser.query(api.exercises.detail, { exerciseId: exercise._id });
    }
  }
  const library = await user.asUser.query(api.exercises.browse, { paginationOpts: { numItems: 100, cursor: null } });
  for (const item of library.page) {
    const count = snapshot.sets.filter((set) => set.exerciseId === item._id).length;
    if (item.setCount !== Math.min(count, 100)) {
      problems.push(`library shows ${item.setCount} sets for ${item.name}, expected ${count}`);
    }
  }
  // A day's records come from stamps when the exercise is ready, and from a scan when not.
  const finished = snapshot.sessions.filter((session) => session.status === "completed");
  const day = finished[step % Math.max(1, finished.length)];
  if (day) {
    await user.asUser.query(api.sessions.listDay, { startedFrom: day.startedAt - HOUR, startedUntil: day.startedAt + HOUR });
  }
  return problems;
}

/**
 * Applies random operations for one seed, then runs all, some, or none of the
 * queued functions. When all of them ran, every stats row must match its sets.
 * Otherwise every ready row must still match, no exercise may have two rows,
 * every workout's set count must be right, and the screens must still load.
 */
async function runSeed(seed: number, steps: number) {
  const t = testBackend();
  const random = seeded(seed);
  const me = await signIn(t, "Fuzz");
  const other = await signIn(t, "Other");
  const history: string[] = [];
  const clientSets: ClientSet[] = [];
  const ran = new Map<string, number>();
  let counter = 0;
  const newClientId = (prefix: string) => `${prefix}${seed}x${String((counter += 1)).padStart(4, "0")}`;

  function fail(step: number, message: string): never {
    throw new Error(`seed ${seed}, step ${step}: ${message}\n\nOperations so far (newest last):\n${history.slice(-80).join("\n")}`);
  }

  async function openSession(user: User): Promise<Id<"sessions">> {
    return await user.asUser.mutation(api.sessions.start, {});
  }

  /** Where a hand-logged set goes: the open workout, or a finished one. */
  async function logTarget(snapshot: World): Promise<{ sessionId: Id<"sessions">; label: string }> {
    const finished = snapshot.sessions.filter((session) => session.status === "completed");
    if (finished.length > 0 && chance(random, 0.4)) {
      const session = random.pick(finished);
      return { sessionId: session._id, label: `past ${session._id}` };
    }
    return { sessionId: await openSession(me), label: "open" };
  }

  /** A past workout's exercises. Its form has no set type, so every set is a working set. */
  function pastExercises(): Array<{ name: string; sets: Measures[] }> {
    const working = () => {
      const { setType, ...measures } = randomMeasures(random);
      void setType;
      return measures;
    };
    if (chance(random, 0.1)) {
      // A long block, so a merge of this exercise takes more than one batch.
      return [{ name: random.pick(NAMES), sets: Array.from({ length: between(random, 25, 45) }, working) }];
    }
    return Array.from({ length: between(random, 1, 3) }, () => ({
      name: random.pick(NAMES),
      sets: Array.from({ length: between(random, 1, 3) }, working),
    }));
  }

  async function offlineBatch(snapshot: World): Promise<string> {
    const now = Date.now();
    const open = snapshot.sessions.find((session) => session.status === "open") ?? null;
    const touched = new Set<string>();
    const inBatch = new Set<string>();
    const sets: Array<ClientSet & Measures & { sessionId?: Id<"sessions"> }> = [];
    const edits: Array<Measures & { editId: string; setId: Id<"sets"> }> = [];
    const deletes: Array<{ deleteId: string; setId: Id<"sets"> }> = [];
    const parts: string[] = [];
    const earlierPast = clientSets.filter((item) => item.placement === "completed");
    const reused = earlierPast.length > 0 && chance(random, 0.4) ? random.pick(earlierPast) : null;
    const pastClientId = reused?.sessionClientId ?? newClientId("past");
    const pastStartedAt = reused?.sessionStartedAt ?? now - between(random, 1, 20) * DAY - between(random, 0, 12) * HOUR;
    const live = clientSets.filter((item) => !item.removed);
    const setOf = (clientId: string) => snapshot.sets.find((set) => set.clientId === clientId) ?? null;
    const items = between(random, 1, 4);
    for (let index = 0; index < items; index += 1) {
      const roll = random.next();
      const priors = live.filter((item) => !inBatch.has(item.clientId));
      const free = snapshot.sets.filter((set) => !touched.has(set._id));
      if (roll < 0.45 || priors.length === 0) {
        const placement = chance(random, 0.6) ? "open" : "completed";
        const measures = randomMeasures(random);
        const clientId = newClientId("set");
        // A fast phone clock lands in the future, which the server clamps to now.
        const loggedAt =
          placement === "open"
            ? chance(random, 0.3)
              ? now + 5 * MINUTE
              : now - between(random, 0, 30) * MINUTE
            : pastStartedAt + between(random, 0, 3) * 1_000;
        const item: ClientSet = {
          clientId,
          revision: 1,
          removed: false,
          placement,
          sessionClientId: placement === "open" ? (open?.clientId ?? newClientId("open")) : pastClientId,
          sessionStartedAt: placement === "open" ? (open?.startedAt ?? now) : pastStartedAt,
          exerciseName: random.pick(NAMES),
          loggedAt,
        };
        inBatch.add(clientId);
        sets.push({ ...item, ...measures, ...(placement === "open" && open && chance(random, 0.5) ? { sessionId: open._id } : {}) });
        parts.push(`new ${placement} ${item.exerciseName} ${describeMeasures(measures)} at ${loggedAt - now}ms`);
      } else if (roll < 0.8) {
        const prior = random.pick(priors);
        const removed = roll >= 0.7;
        const measures = randomMeasures(random);
        const exerciseName = !removed && chance(random, 0.25) ? random.pick(NAMES) : prior.exerciseName;
        inBatch.add(prior.clientId);
        const saved = setOf(prior.clientId);
        if (saved) {
          touched.add(saved._id);
        }
        sets.push({ ...prior, revision: prior.revision + 1, removed, exerciseName, ...measures });
        parts.push(
          removed
            ? `remove ${prior.clientId}`
            : `revise ${prior.clientId} to ${exerciseName} ${describeMeasures(measures)}`,
        );
      } else if (free.length > 0 && roll < 0.9) {
        const set = random.pick(free);
        touched.add(set._id);
        deletes.push({ deleteId: newClientId("del"), setId: set._id });
        parts.push(`delete ${set._id}`);
      } else if (free.length > 0) {
        const set = random.pick(free);
        touched.add(set._id);
        const measures = randomMeasures(random);
        edits.push({ editId: newClientId("edit"), setId: set._id, ...measures });
        parts.push(`edit ${set._id} to ${describeMeasures(measures)}`);
      }
    }
    if (sets.length + edits.length + deletes.length === 0) {
      return "offline: nothing";
    }
    const result = await me.asUser.mutation(api.offline.accept, {
      sets,
      edits,
      deletes,
      actions: [],
    });
    const rejected = [...result.sets, ...result.edits, ...result.deletes].filter((item) => item.status === "rejected");
    if (rejected.length > 0) {
      throw new Error(`offline items were rejected: ${JSON.stringify(rejected)}`);
    }
    for (const outcome of result.sets) {
      const sent = sets.find((item) => item.clientId === outcome.clientId);
      if (!sent) {
        continue;
      }
      const known = clientSets.find((item) => item.clientId === sent.clientId);
      const next: ClientSet = {
        clientId: sent.clientId,
        revision: sent.revision,
        removed: sent.removed || outcome.status === "removed",
        placement: sent.placement,
        sessionClientId: sent.sessionClientId,
        sessionStartedAt: sent.sessionStartedAt,
        exerciseName: sent.exerciseName,
        loggedAt: sent.loggedAt,
      };
      if (known) {
        Object.assign(known, next);
      } else {
        clientSets.push(next);
      }
    }
    return `offline: ${parts.join("; ")}`;
  }

  async function apply(op: Op, snapshot: World): Promise<string> {
    const mine = snapshot.sets;
    const finished = snapshot.sessions.filter((session) => session.status === "completed");
    switch (op) {
      case "log": {
        const { sessionId, label } = await logTarget(snapshot);
        const name = random.pick(NAMES);
        const measures = randomMeasures(random);
        const result = await me.asUser.mutation(api.sets.log, { sessionId, exerciseName: name, ...measures });
        return `log ${name} ${describeMeasures(measures)} to ${label} -> ${result.setId}${result.personalRecord ? ` PR ${result.personalRecord.kind}` : ""}`;
      }
      case "logMany": {
        const { sessionId, label } = await logTarget(snapshot);
        const name = random.pick(NAMES);
        const sets = Array.from({ length: between(random, 2, 4) }, () => randomMeasures(random));
        await me.asUser.mutation(api.sets.logMany, { sessionId, exerciseName: name, sets });
        return `logMany ${name} [${sets.map(describeMeasures).join(", ")}] to ${label}`;
      }
      case "logWorkout": {
        const { sessionId, label } = await logTarget(snapshot);
        const exercises = Array.from({ length: between(random, 1, 3) }, () => ({
          exerciseName: random.pick(NAMES),
          sets: Array.from({ length: between(random, 1, 3) }, () => randomMeasures(random)),
        }));
        await me.asUser.mutation(api.sets.logWorkout, { sessionId, exercises });
        return `logWorkout to ${label}: ${exercises.map((item) => `${item.exerciseName} [${item.sets.map(describeMeasures).join(", ")}]`).join("; ")}`;
      }
      case "logPast": {
        const startedAt = Date.now() - between(random, 1, 30 * 24) * HOUR;
        const exercises = pastExercises();
        const result = await me.asUser.mutation(api.sessions.logPast, {
          startedAt,
          exercises: exercises.map((item) => ({ name: item.name, sets: item.sets })),
        });
        return `logPast ${result.sessionId} at -${Math.round((Date.now() - startedAt) / HOUR)}h: ${exercises.map((item) => `${item.name} x${item.sets.length}`).join(", ")}`;
      }
      case "update": {
        if (mine.length === 0) {
          return "update: no sets";
        }
        const set = random.pick(mine);
        const measures = chance(random, 0.25) ? sameMeasures(set) : randomMeasures(random);
        await me.asUser.mutation(api.sets.update, { setId: set._id, ...measures, rpe: between(random, 6, 10) });
        return `update ${set._id} at ${set.loggedAt} to ${describeMeasures(measures)}`;
      }
      case "remove": {
        if (mine.length === 0) {
          return "remove: no sets";
        }
        const set = random.pick(mine);
        await me.asUser.mutation(api.sets.remove, { setId: set._id });
        return `remove ${set._id} at ${set.loggedAt}`;
      }
      case "removeMany": {
        const crowded = snapshot.sessions.filter((session) => mine.filter((set) => set.sessionId === session._id).length >= 2);
        if (crowded.length === 0) {
          return "removeMany: no workout with two sets";
        }
        const session = random.pick(crowded);
        const sets = some(random, mine.filter((set) => set.sessionId === session._id), between(random, 2, 4));
        await me.asUser.mutation(api.sets.removeMany, { setIds: sets.map((set) => set._id) });
        return `removeMany ${sets.map((set) => set._id).join(", ")}`;
      }
      case "removeWorkout": {
        if (finished.length === 0) {
          return "removeWorkout: none finished";
        }
        const session = random.pick(finished);
        await me.asUser.mutation(api.sessions.remove, { sessionId: session._id });
        return `removeWorkout ${session._id} (${mine.filter((set) => set.sessionId === session._id).length} sets)`;
      }
      case "removeDay": {
        if (finished.length === 0) {
          return "removeDay: none finished";
        }
        const session = random.pick(finished);
        const startedFrom = session.startedAt - between(random, 0, 23) * HOUR;
        const result = await me.asUser.mutation(api.sessions.removeDay, { startedFrom, startedUntil: startedFrom + DAY });
        return `removeDay around ${session._id}: ${result.workouts} workouts, ${result.sets} sets`;
      }
      case "finish": {
        const open = snapshot.sessions.find((session) => session.status === "open");
        if (!open || (open.setCount ?? 0) === 0) {
          return `finish: start ${await openSession(me)}`;
        }
        await me.asUser.mutation(api.sessions.complete, { sessionId: open._id });
        return `finish ${open._id}`;
      }
      case "offline":
        return await offlineBatch(snapshot);
      case "merge": {
        if (snapshot.exercises.length < 2) {
          return "merge: fewer than two exercises";
        }
        const [from, into] = some(random, snapshot.exercises, 2) as [Doc<"exercises">, Doc<"exercises">];
        const result = await me.asUser.mutation(api.exercises.merge, { fromId: from._id, intoId: into._id });
        return `merge ${from.name} (${mine.filter((set) => set.exerciseId === from._id).length} sets) into ${into.name}: moved ${result.moved}${result.continuing ? ", continuing" : ""}`;
      }
      case "rename": {
        if (snapshot.exercises.length === 0) {
          return "rename: no exercises";
        }
        const exercise = random.pick(snapshot.exercises);
        const name = random.pick([...NAMES, "Pulldown", "Lunge"]);
        const result = await me.asUser.mutation(api.exercises.rename, { exerciseId: exercise._id, name });
        return `rename ${exercise.name} to ${name}: ${result.status}`;
      }
      case "otherUser": {
        const sessionId = await openSession(other);
        const name = random.pick(NAMES);
        const measures = randomMeasures(random);
        await other.asUser.mutation(api.sets.log, { sessionId, exerciseName: name, ...measures });
        return `other user logs ${name} ${describeMeasures(measures)}`;
      }
      case "cron": {
        const stalled = chance(random, 0.5);
        if (stalled) {
          vi.setSystemTime(Date.now() + STALL_MS + 1_000);
        }
        await t.mutation(internal.exerciseStats.backfillTick, {});
        return `cron tick${stalled ? " after the stall window" : ""}`;
      }
      case "replayPage": {
        const pages = await queuedPages(t);
        if (pages.length === 0) {
          return "replayPage: none queued yet";
        }
        const pending = pages.filter((page) => page.pending);
        const early = pending.length > 0 && chance(random, 0.7);
        const page = early ? random.pick(pending) : random.pick(pages);
        // Pages queued before steps existed carry no step.
        const args = chance(random, 0.1) ? { ...page.args, step: undefined } : page.args;
        await t.mutation(internal.exerciseStats.rebuildPage, args);
        return `replay ${early ? "queued" : "old"} page gen ${args.generation} step ${args.step ?? "none"} cursor ${args.cursor === null ? "null" : "set"} for ${args.exerciseId}`;
      }
    }
  }

  // Older workouts long enough that a rebuild takes several pages and a merge several batches.
  for (let index = 0; index < 4; index += 1) {
    const { setType, ...measures } = randomMeasures(random);
    void setType;
    await me.asUser.mutation(api.sessions.logPast, {
      startedAt: Date.now() - (40 - index * 8) * DAY,
      exercises: [{ name: random.pick(NAMES), sets: Array.from({ length: between(random, 20, 45) }, () => measures) }],
    });
  }
  await drainAll(t);

  let fullAudits = 0;
  let snapshot = await world(t, me.userId);
  for (let step = 0; step < steps; step += 1) {
    vi.setSystemTime(Date.now() + random.pick([0, 0, 1, 1_000, 20_000, MINUTE, 10 * MINUTE, HOUR]));
    const op = pickOp(random);
    ran.set(op, (ran.get(op) ?? 0) + 1);
    let line: string;
    try {
      line = await apply(op, snapshot);
    } catch (error) {
      if (!(error instanceof ConvexError)) {
        fail(step, `${op} threw ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
      }
      line = `${op}: rejected, ${String(error.data)}`;
    }
    const drain = random.pick(["all", "all", "some", "some", "none"] as const);
    let ranJobs = 0;
    if (drain === "all") {
      await drainAll(t);
    } else if (drain === "some") {
      ranJobs = await drainSome(t, between(random, 1, 4));
    }
    history.push(`${step}: ${line} [drain ${drain === "some" ? `${ranJobs} jobs` : drain}]`);

    const problems = drain === "all" ? await audit(t) : await auditBetweenWrites(t);
    if (drain === "all") {
      fullAudits += 1;
    }
    snapshot = await world(t, me.userId);
    try {
      problems.push(...(await readScreens(me, snapshot, step)));
    } catch (error) {
      fail(step, `a reader threw ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
    }
    if (problems.length > 0) {
      fail(step, `${drain === "all" ? "after every job ran" : "between writes"}:\n${problems.join("\n")}`);
    }
  }

  await drainAll(t);
  await t.mutation(internal.exerciseStats.backfillTick, {});
  await drainAll(t);
  const problems = await audit(t);
  if (problems.length > 0) {
    fail(steps, `at the end:\n${problems.join("\n")}`);
  }
  return { ran, fullAudits };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-01T12:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("exercise stats under interleaved writes, rebuild pages, and cron ticks", () => {
  for (const seed of SEEDS) {
    test(`seed ${seed}`, async () => {
      const { ran, fullAudits } = await runSeed(seed, STEPS);
      // Most kinds of operation come up in a run of this length.
      expect(ran.size).toBeGreaterThanOrEqual(12);
      expect(fullAudits).toBeGreaterThan(STEPS / 4);
    }, Math.max(120_000, STEPS * 1_000));
  }
});
