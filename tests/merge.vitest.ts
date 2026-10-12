/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { MERGE_BATCH } from "../convex/lib/exerciseMerge";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");

function testBackend() {
  return convexTest(schema, modules);
}

async function signIn(
  t: ReturnType<typeof testBackend>,
  name: string,
  options?: { allow?: boolean },
) {
  const email = `${name.toLowerCase().replace(/[^a-z0-9]+/g, ".")}.merge@example.com`;
  const userId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("users", { name, email });
    if (options?.allow !== false) {
      await ctx.db.insert("allowedEmails", { email, createdAt: Date.now() });
    }
    return id;
  });
  return { userId, asUser: t.withIdentity({ subject: `${userId}|${name}-session` }) };
}

describe("merging exercises", () => {
  test("keeps a superset label on a finished workout", async () => {
    const t = testBackend();
    const { asUser } = await signIn(t, "Michael");
    const other = await signIn(t, "Someone else");
    const routineId = await asUser.mutation(api.routines.create, {
      name: "Arms",
      exercises: [
        { name: "Curls", targetSets: 3, targetReps: 12, supersetId: "arms" },
        { name: "Pushdown", targetSets: 3, targetReps: 12, supersetId: "arms" },
      ],
    });
    const started = await asUser.mutation(api.routines.begin, { routineId });
    expect(started.status).toBe("started");
    const open = await asUser.query(api.sessions.getOpen, {});
    if (!open) {
      throw new Error("Expected an open workout");
    }
    await asUser.mutation(api.sets.log, {
      sessionId: open._id,
      exerciseName: "Curls",
      reps: 12,
      weightLb: 30,
    });
    await asUser.mutation(api.sets.log, {
      sessionId: open._id,
      exerciseName: "Pushdown",
      reps: 12,
      weightLb: 50,
    });
    await asUser.mutation(api.sessions.complete, { sessionId: open._id });

    await asUser.mutation(api.sessions.logPast, {
      startedAt: Date.now() - 60 * 60 * 1000,
      exercises: [{ name: "Curl", sets: [{ reps: 8, weightLb: 25 }] }],
    });
    const library = await asUser.query(api.exercises.list, {});
    const from = library.exercises.find((exercise) => exercise.name === "Curls");
    const into = library.exercises.find((exercise) => exercise.name === "Curl");
    if (!from || !into) {
      throw new Error("Expected both exercises");
    }

    await expect(
      other.asUser.mutation(api.exercises.merge, { fromId: from._id, intoId: into._id }),
    ).rejects.toThrow(/not found/i);
    await expect(
      t.mutation(api.exercises.merge, { fromId: from._id, intoId: into._id }),
    ).rejects.toThrow("Not authenticated");

    const merged = await asUser.mutation(api.exercises.merge, {
      fromId: from._id,
      intoId: into._id,
    });
    expect(merged).toMatchObject({ name: "Curl", continuing: false });

    const finished = await asUser.query(api.sessions.get, { sessionId: open._id });
    const grouped = finished?.exercises.filter((exercise) => exercise.name !== "Shrug") ?? [];
    expect(grouped.map((exercise) => exercise.name)).toEqual(["Curl", "Pushdown"]);
    expect(grouped[0]?.supersetId).toBeTruthy();
    expect(grouped[0]?.supersetId).toBe(grouped[1]?.supersetId);

    const routine = await asUser.query(api.routines.get, { routineId });
    expect(routine?.exercises.map((exercise) => exercise.name)).toEqual(["Curl", "Pushdown"]);
    expect(routine?.exercises[0]?.supersetId).toBe(routine?.exercises[1]?.supersetId);

    const exported = await asUser.query(api.exportData.sets, {
      paginationOpts: { numItems: 20, cursor: null },
    });
    const curl = exported.page.find((row) => row.exercise === "Curl" && row.reps === 12);
    const pushdown = exported.page.find((row) => row.exercise === "Pushdown");
    expect(curl?.superset).toBeTruthy();
    expect(curl?.superset).toBe(pushdown?.superset);

    const again = await asUser.mutation(api.sessions.repeat, { sessionIds: [open._id] });
    expect(again.status).toBe("started");
    const repeated = await asUser.query(api.sessions.getOpen, {});
    if (!repeated) {
      throw new Error("Expected the repeated workout");
    }
    expect(repeated.plan.map((item) => item.name)).toEqual(["Curl", "Pushdown"]);
    expect(repeated.plan[0]?.supersetId).toBeTruthy();
    expect(repeated.plan[0]?.supersetId).toBe(repeated.plan[1]?.supersetId);

    await asUser.mutation(api.sessions.discard, { sessionId: repeated._id });
    const saved = await asUser.mutation(api.routines.createFromSessions, {
      name: "Arms again",
      sessionIds: [open._id],
    });
    const fromHistory = await asUser.query(api.routines.get, { routineId: saved });
    expect(fromHistory?.exercises.map((exercise) => exercise.name)).toEqual(["Curl", "Pushdown"]);
    expect(fromHistory?.exercises[0]?.supersetId).toBe(fromHistory?.exercises[1]?.supersetId);
  });

  test("moves a long history in batches and stops when access is gone", async () => {
    const t = testBackend();
    const owner = await signIn(t, "Michael");
    const blocked = await signIn(t, "Blocked", { allow: false });
    const total = MERGE_BATCH + 1;

    const seeded = await t.run(async (ctx) => {
      const fromId = await ctx.db.insert("exercises", {
        userId: owner.userId,
        name: "Curls",
        normalizedName: "curls",
        createdAt: 1,
      });
      const intoId = await ctx.db.insert("exercises", {
        userId: owner.userId,
        name: "Curl",
        normalizedName: "curl",
        createdAt: 2,
      });
      const pushdownId = await ctx.db.insert("exercises", {
        userId: owner.userId,
        name: "Pushdown",
        normalizedName: "pushdown",
        createdAt: 3,
      });
      const sessionId = await ctx.db.insert("sessions", {
        userId: owner.userId,
        status: "completed",
        startedAt: 1_000,
        completedAt: 2_000,
        plan: [
          { exerciseId: fromId, supersetId: "arms" },
          { exerciseId: pushdownId, supersetId: "arms" },
        ],
      });
      for (let index = 0; index < total; index += 1) {
        await ctx.db.insert("sets", {
          userId: owner.userId,
          sessionId,
          exerciseId: fromId,
          reps: 10,
          weightLb: 30,
          loggedAt: 1_000 + index,
        });
      }
      const blockedFrom = await ctx.db.insert("exercises", {
        userId: blocked.userId,
        name: "Curls",
        normalizedName: "curls",
        createdAt: 4,
      });
      const blockedInto = await ctx.db.insert("exercises", {
        userId: blocked.userId,
        name: "Curl",
        normalizedName: "curl",
        createdAt: 5,
      });
      const blockedSession = await ctx.db.insert("sessions", {
        userId: blocked.userId,
        status: "completed",
        startedAt: 1_000,
        completedAt: 2_000,
      });
      await ctx.db.insert("sets", {
        userId: blocked.userId,
        sessionId: blockedSession,
        exerciseId: blockedFrom,
        reps: 10,
        weightLb: 30,
        loggedAt: 1_000,
      });
      return { fromId, intoId, pushdownId, sessionId, blockedFrom, blockedInto };
    });

    vi.useFakeTimers();
    try {
      const first = await owner.asUser.mutation(api.exercises.merge, {
        fromId: seeded.fromId,
        intoId: seeded.intoId,
      });
      expect(first).toEqual({ moved: MERGE_BATCH, name: "Curl", continuing: true });

      const mid = await t.run(async (ctx) => {
        const from = await ctx.db.get("exercises", seeded.fromId);
        const remaining = await ctx.db
          .query("sets")
          .withIndex("by_user_exercise_and_logged", (q) =>
            q.eq("userId", owner.userId).eq("exerciseId", seeded.fromId),
          )
          .take(10);
        const session = await ctx.db.get("sessions", seeded.sessionId);
        return { fromName: from?.name ?? null, remaining: remaining.length, plan: session?.plan };
      });
      expect(mid.fromName).toBe("Curls");
      expect(mid.remaining).toBe(1);
      expect(mid.plan?.map((item) => item.exerciseId)).toEqual([seeded.intoId, seeded.pushdownId]);
      expect(mid.plan?.[0]?.supersetId).toBe("arms");
      expect(mid.plan?.[1]?.supersetId).toBe("arms");

      await t.finishAllScheduledFunctions(() => {
        vi.runAllTimers();
      });
    } finally {
      vi.useRealTimers();
    }

    const after = await t.run(async (ctx) => {
      const from = await ctx.db.get("exercises", seeded.fromId);
      const onSource = await ctx.db
        .query("sets")
        .withIndex("by_user_exercise_and_logged", (q) =>
          q.eq("userId", owner.userId).eq("exerciseId", seeded.fromId),
        )
        .take(10);
      const onTarget = await ctx.db
        .query("sets")
        .withIndex("by_user_exercise_and_logged", (q) =>
          q.eq("userId", owner.userId).eq("exerciseId", seeded.intoId),
        )
        .take(total + 5);
      const session = await ctx.db.get("sessions", seeded.sessionId);
      return { from, onSource: onSource.length, onTarget: onTarget.length, plan: session?.plan };
    });
    expect(after.from).toBeNull();
    expect(after.onSource).toBe(0);
    expect(after.onTarget).toBe(total);
    expect(after.plan?.[0]?.exerciseId).toBe(seeded.intoId);
    expect(after.plan?.[0]?.supersetId).toBe(after.plan?.[1]?.supersetId);

    await t.mutation(internal.exercises.continueMerge, {
      userId: owner.userId,
      fromId: seeded.fromId,
      intoId: seeded.intoId,
    });
    const stillGone = await t.run(async (ctx) => await ctx.db.get("exercises", seeded.fromId));
    expect(stillGone).toBeNull();

    await t.run(async (ctx) => {
      await ctx.db.patch("exercises", seeded.blockedFrom, { mergingInto: seeded.blockedInto });
    });
    const stopped = await t.mutation(internal.exercises.continueMerge, {
      userId: blocked.userId,
      fromId: seeded.blockedFrom,
      intoId: seeded.blockedInto,
    });
    expect(stopped).toBeNull();
    const blockedStill = await t.run(async (ctx) => {
      const exercise = await ctx.db.get("exercises", seeded.blockedFrom);
      const sets = await ctx.db
        .query("sets")
        .withIndex("by_user_exercise_and_logged", (q) =>
          q.eq("userId", blocked.userId).eq("exerciseId", seeded.blockedFrom),
        )
        .take(5);
      return { name: exercise?.name ?? null, sets: sets.length, merging: exercise?.mergingInto };
    });
    // Stopped for lost access, it shows as a normal exercise again.
    expect(blockedStill).toEqual({ name: "Curls", sets: 1, merging: undefined });
  });

  test("a running merge shows in the library, blocks chained merges, and survives a lost target", async () => {
    const t = testBackend();
    const owner = await signIn(t, "Michael");
    const seeded = await t.run(async (ctx) => {
      const make = async (name: string, createdAt: number) =>
        await ctx.db.insert("exercises", {
          userId: owner.userId,
          name,
          normalizedName: name.toLowerCase(),
          createdAt,
        });
      const fromId = await make("Curls", 1);
      const intoId = await make("Curl", 2);
      const otherId = await make("Hammer curl", 3);
      const sessionId = await ctx.db.insert("sessions", {
        userId: owner.userId,
        status: "completed",
        startedAt: 1_000,
        completedAt: 2_000,
      });
      for (let index = 0; index < MERGE_BATCH + 1; index += 1) {
        await ctx.db.insert("sets", {
          userId: owner.userId,
          sessionId,
          exerciseId: fromId,
          reps: 10,
          weightLb: 30,
          loggedAt: 1_000 + index,
        });
      }
      // Planned Curls but logged none of it.
      const planOnly = await ctx.db.insert("sessions", {
        userId: owner.userId,
        status: "completed",
        startedAt: 3_000,
        completedAt: 4_000,
        plan: [{ exerciseId: fromId }],
      });
      return { fromId, intoId, otherId, planOnly };
    });

    vi.useFakeTimers();
    try {
      const first = await owner.asUser.mutation(api.exercises.merge, {
        fromId: seeded.fromId,
        intoId: seeded.intoId,
      });
      expect(first.continuing).toBe(true);

      const library = await owner.asUser.query(api.exercises.browse, {
        paginationOpts: { numItems: 10, cursor: null },
      });
      const curls = library.page.find((item) => item._id === seeded.fromId);
      expect(curls?.mergingInto).toBe("Curl");

      // The kept exercise can't be merged away, and nothing can merge into the
      // one being emptied, until this merge finishes.
      await expect(
        owner.asUser.mutation(api.exercises.merge, { fromId: seeded.intoId, intoId: seeded.otherId }),
      ).rejects.toThrow(/still moving onto Curl/);
      await expect(
        owner.asUser.mutation(api.exercises.merge, { fromId: seeded.otherId, intoId: seeded.fromId }),
      ).rejects.toThrow(/Curls is still being merged/);

      await t.finishAllScheduledFunctions(() => {
        vi.runAllTimers();
      });
    } finally {
      vi.useRealTimers();
    }

    const planOnly = await t.run(async (ctx) => await ctx.db.get("sessions", seeded.planOnly));
    expect(planOnly?.plan?.[0]?.exerciseId).toBe(seeded.intoId);
    const kept = await t.run(async (ctx) => await ctx.db.get("exercises", seeded.intoId));
    expect(kept?.pendingPlanScans).toBeUndefined();

    // While finished plans are still being repointed, the kept exercise can't
    // be merged away.
    await t.run(async (ctx) => {
      await ctx.db.patch("exercises", seeded.intoId, { pendingPlanScans: 1 });
    });
    await expect(
      owner.asUser.mutation(api.exercises.merge, { fromId: seeded.intoId, intoId: seeded.otherId }),
    ).rejects.toThrow(/still being updated/);

    // A merge started before this check whose target is gone stops cleanly.
    const lost = await t.run(async (ctx) => {
      const fromId = await ctx.db.insert("exercises", {
        userId: owner.userId,
        name: "Rows",
        normalizedName: "rows",
        createdAt: 5,
      });
      const intoId = await ctx.db.insert("exercises", {
        userId: owner.userId,
        name: "Row",
        normalizedName: "row",
        createdAt: 6,
      });
      await ctx.db.patch("exercises", fromId, { mergingInto: intoId });
      await ctx.db.delete("exercises", intoId);
      return { fromId, intoId };
    });
    await t.mutation(internal.exercises.continueMerge, { userId: owner.userId, ...lost });
    const rows = await t.run(async (ctx) => await ctx.db.get("exercises", lost.fromId));
    expect(rows?.name).toBe("Rows");
    expect(rows?.mergingInto).toBeUndefined();
  });
});
