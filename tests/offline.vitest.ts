/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");
const NOW = 1_700_000_000_000;

function testBackend() {
  return convexTest(schema, modules);
}

async function signIn(t: ReturnType<typeof testBackend>, name: string, allow = true) {
  const email = `${name.toLowerCase().replace(/[^a-z0-9]+/g, ".")}.user@example.com`;
  const userId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("users", { name, email });
    if (allow) {
      await ctx.db.insert("allowedEmails", { email, createdAt: NOW });
    }
    return id;
  });
  return { userId, asUser: t.withIdentity({ subject: `${userId}|${name}-session` }) };
}

function queuedSet(
  clientId: string,
  overrides?: {
    sessionId?: string;
    removed?: boolean;
    revision?: number;
    weightLb?: number;
    loggedAt?: number;
    placement?: "open" | "completed";
    sessionClientId?: string;
    sessionStartedAt?: number;
    exerciseName?: string;
  },
) {
  return {
    clientId,
    revision: overrides?.revision ?? 1,
    removed: overrides?.removed ?? false,
    placement: overrides?.placement ?? "open",
    ...(overrides?.sessionId ? { sessionId: overrides.sessionId as never } : {}),
    sessionClientId: overrides?.sessionClientId ?? "sessionclient01",
    sessionStartedAt: overrides?.sessionStartedAt ?? NOW,
    exerciseName: overrides?.exerciseName ?? "Bench press",
    reps: 10,
    weightLb: overrides?.weightLb ?? 135,
    loggedAt: overrides?.loggedAt ?? NOW,
  };
}

describe("offline sync", () => {
  test("retries with the same client id do not duplicate the set", async () => {
    const t = testBackend();
    const { asUser } = await signIn(t, "Michael");
    const first = await asUser.mutation(api.offline.accept, {
      sets: [queuedSet("client0001", { loggedAt: NOW - 5_000 })],
      edits: [],
      deletes: [],
      actions: [],
    });
    const second = await asUser.mutation(api.offline.accept, {
      sets: [queuedSet("client0001", { loggedAt: NOW - 5_000, weightLb: 225 })],
      edits: [],
      deletes: [],
      actions: [],
    });

    expect(first.sets[0]?.status).toBe("applied");
    expect(second.sets[0]?.setId).toBe(first.sets[0]?.setId);
    expect(second.sets[0]?.personalRecord).toBeNull();
    const sessionId = first.sets[0]?.sessionId;
    expect(sessionId).toBeTruthy();
    const sets = await asUser.query(api.sets.listForSession, { sessionId: sessionId! });
    expect(sets).toHaveLength(1);
    expect(sets[0]?.weightLb).toBe(135);
    expect(sets[0]?.clientId).toBe("client0001");
    expect(sets[0]?.loggedAt).toBe(NOW - 5_000);
    const open = await asUser.query(api.sessions.getOpen, {});
    expect(open?.startedAt).toBe(NOW - 5_000);
  });

  test("a newer revision updates the set and an older one does not", async () => {
    const t = testBackend();
    const { asUser } = await signIn(t, "Michael");
    const created = await asUser.mutation(api.offline.accept, {
      sets: [queuedSet("client0001")],
      edits: [],
      deletes: [],
      actions: [],
    });
    const updated = await asUser.mutation(api.offline.accept, {
      sets: [queuedSet("client0001", { revision: 2, weightLb: 185 })],
      edits: [],
      deletes: [],
      actions: [],
    });
    const stale = await asUser.mutation(api.offline.accept, {
      sets: [queuedSet("client0001", { revision: 1, weightLb: 45 })],
      edits: [],
      deletes: [],
      actions: [],
    });
    const sessionId = created.sets[0]?.sessionId;
    const sets = await asUser.query(api.sets.listForSession, { sessionId: sessionId! });
    expect(updated.sets[0]?.setId).toBe(created.sets[0]?.setId);
    expect(stale.sets[0]?.status).toBe("applied");
    expect(sets[0]?.weightLb).toBe(185);
  });

  test("removing a queued set deletes it and a second remove is safe", async () => {
    const t = testBackend();
    const { asUser } = await signIn(t, "Michael");
    const created = await asUser.mutation(api.offline.accept, {
      sets: [queuedSet("client0001")],
      edits: [],
      deletes: [],
      actions: [],
    });
    const sessionId = created.sets[0]?.sessionId;
    await asUser.mutation(api.offline.accept, {
      sets: [queuedSet("client0001", { removed: true, revision: 2 })],
      edits: [],
      deletes: [],
      actions: [],
    });
    await asUser.mutation(api.offline.accept, {
      sets: [queuedSet("client0001", { removed: true, revision: 2 })],
      edits: [],
      deletes: [],
      actions: [],
    });
    expect(await asUser.query(api.sets.listForSession, { sessionId: sessionId! })).toHaveLength(0);
  });

  test("sets without a session join the open workout, and a past workout does not", async () => {
    const t = testBackend();
    const { asUser } = await signIn(t, "Michael");
    const sessionId = await asUser.mutation(api.sessions.start, {});
    const joined = await asUser.mutation(api.offline.accept, {
      sets: [queuedSet("client0001", { sessionClientId: "phoneworkout1" })],
      edits: [],
      deletes: [],
      actions: [],
    });
    expect(joined.sets[0]?.sessionId).toBe(sessionId);

    const past = await asUser.mutation(api.offline.accept, {
      sets: [
        queuedSet("client0002", {
          placement: "completed",
          sessionClientId: "pastworkout01",
          loggedAt: NOW - 86_400_000,
        }),
      ],
      edits: [],
      deletes: [],
      actions: [],
    });
    expect(past.sets[0]?.sessionId).not.toBe(sessionId);
    const saved = await asUser.query(api.sessions.get, { sessionId: past.sets[0]!.sessionId! });
    expect(saved?.status).toBe("completed");
    expect(await asUser.query(api.sessions.getOpen, {})).toMatchObject({ _id: sessionId });

    const again = await asUser.mutation(api.offline.accept, {
      sets: [
        queuedSet("client0002", {
          placement: "completed",
          sessionClientId: "pastworkout01",
          loggedAt: NOW - 86_400_000,
        }),
      ],
      edits: [],
      deletes: [],
      actions: [],
    });
    expect(again.sets[0]?.setId).toBe(past.sets[0]?.setId);
  });

  test("a bad set is rejected without dropping the good one, and auth is required", async () => {
    const t = testBackend();
    const { asUser } = await signIn(t, "Michael");
    const blocked = await signIn(t, "Stranger", false);
    const ownerSession = await asUser.mutation(api.sessions.start, {});
    const other = await signIn(t, "Other");

    const mixed = await asUser.mutation(api.offline.accept, {
      sets: [
        queuedSet("bad id", { exerciseName: "Squat" }),
        queuedSet("client0002", { exerciseName: "Squat", weightLb: 225 }),
      ],
      edits: [],
      deletes: [],
      actions: [],
    });
    expect(mixed.sets[0]?.status).toBe("rejected");
    expect(mixed.sets[1]?.status).toBe("applied");
    expect(await asUser.query(api.sets.listForSession, { sessionId: mixed.sets[1]!.sessionId! })).toHaveLength(1);

    const stolen = await other.asUser.mutation(api.offline.accept, {
      sets: [queuedSet("client0099", { sessionId: ownerSession })],
      edits: [],
      deletes: [],
      actions: [],
    });
    expect(stolen.sets[0]?.status).toBe("rejected");
    expect(stolen.sets[0]?.message).toBe("Workout not found");

    await expect(
      blocked.asUser.mutation(api.offline.accept, {
        sets: [queuedSet("client0003")],
        edits: [],
        deletes: [],
        actions: [],
      }),
    ).rejects.toThrow("You don't have access yet");
    await expect(
      t.mutation(api.offline.accept, {
        sets: [queuedSet("client0003")],
        edits: [],
        deletes: [],
        actions: [],
      }),
    ).rejects.toThrow("Not authenticated");
  });

  test("finishing offline records the time the workout was finished", async () => {
    const t = testBackend();
    const { asUser } = await signIn(t, "Michael");
    const saved = await asUser.mutation(api.offline.accept, {
      sets: [queuedSet("client0001", { loggedAt: NOW - 60_000 })],
      edits: [],
      deletes: [],
      actions: [
        {
          actionId: "action0001",
          kind: "complete",
          sessionClientId: "sessionclient01",
          note: "solid",
          requestedAt: NOW - 30_000,
        },
      ],
    });
    const sessionId = saved.sets[0]?.sessionId;
    expect(saved.actions[0]?.status).toBe("applied");
    const session = await asUser.query(api.sessions.get, { sessionId: sessionId! });
    expect(session?.status).toBe("completed");
    expect(session?.completedAt).toBe(NOW - 30_000);
    expect(session?.note).toBe("solid");
    expect(await asUser.query(api.sessions.getOpen, {})).toBeNull();

    const replay = await asUser.mutation(api.offline.accept, {
      sets: [],
      edits: [],
      deletes: [],
      actions: [
        {
          actionId: "action0001",
          kind: "complete",
          sessionId,
          sessionClientId: "sessionclient01",
          requestedAt: NOW - 30_000,
        },
      ],
    });
    expect(replay.actions[0]?.status).toBe("applied");
    expect((await asUser.query(api.sessions.get, { sessionId: sessionId! }))?.completedAt).toBe(
      NOW - 30_000,
    );
  });

  test("sets saved before client ids existed still list", async () => {
    const t = testBackend();
    const { asUser, userId } = await signIn(t, "Michael");
    const sessionId = await asUser.mutation(api.sessions.start, {});
    await t.run(async (ctx) => {
      const exerciseId = await ctx.db.insert("exercises", {
        userId,
        name: "Squat",
        normalizedName: "squat",
        createdAt: NOW,
      });
      await ctx.db.insert("sets", {
        userId,
        sessionId,
        exerciseId,
        reps: 5,
        weightLb: 185,
        loggedAt: NOW,
      });
    });
    const listed = await asUser.query(api.sets.listForSession, { sessionId });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.clientId).toBeNull();
    expect(listed[0]?.weightLb).toBe(185);
  });

  test("a past workout does not reuse another day's client id", async () => {
    const t = testBackend();
    const { asUser } = await signIn(t, "Michael");
    const day = 86_400_000;
    const first = await asUser.mutation(api.offline.accept, {
      sets: [
        queuedSet("client0001", {
          placement: "completed",
          sessionClientId: "pastworkout01",
          sessionStartedAt: NOW - 2 * day,
          loggedAt: NOW - 2 * day,
        }),
      ],
      edits: [],
      deletes: [],
      actions: [],
    });
    const otherDay = await asUser.mutation(api.offline.accept, {
      sets: [
        queuedSet("client0002", {
          placement: "completed",
          sessionClientId: "pastworkout01",
          sessionStartedAt: NOW - 10 * day,
          loggedAt: NOW - 10 * day,
        }),
      ],
      edits: [],
      deletes: [],
      actions: [],
    });
    const sameDay = await asUser.mutation(api.offline.accept, {
      sets: [
        queuedSet("client0003", {
          placement: "completed",
          sessionClientId: "pastworkout01",
          sessionStartedAt: NOW - 2 * day,
          loggedAt: NOW - 2 * day + 1000,
        }),
      ],
      edits: [],
      deletes: [],
      actions: [],
    });
    expect(otherDay.sets[0]?.sessionId).not.toBe(first.sets[0]?.sessionId);
    expect(sameDay.sets[0]?.sessionId).toBe(first.sets[0]?.sessionId);
    const firstSession = await asUser.query(api.sessions.get, {
      sessionId: first.sets[0]!.sessionId!,
    });
    const otherSession = await asUser.query(api.sessions.get, {
      sessionId: otherDay.sets[0]!.sessionId!,
    });
    expect(firstSession?.sets).toHaveLength(2);
    expect(otherSession?.sets).toHaveLength(1);
  });

  test("a deleted workout id still saves the queued set on its own", async () => {
    const t = testBackend();
    const { asUser } = await signIn(t, "Michael");
    const openId = await asUser.mutation(api.sessions.start, {});
    const goneId = await t.run(async (ctx) => {
      const open = await ctx.db.get("sessions", openId);
      if (!open) {
        throw new Error("Expected the open workout");
      }
      const id = await ctx.db.insert("sessions", {
        userId: open.userId,
        status: "open",
        startedAt: NOW,
      });
      await ctx.db.delete("sessions", id);
      return id;
    });
    const saved = await asUser.mutation(api.offline.accept, {
      sets: [
        queuedSet("client0001", {
          sessionId: goneId,
          sessionClientId: "recovered0001",
        }),
      ],
      edits: [],
      deletes: [],
      actions: [],
    });
    expect(saved.sets[0]?.status).toBe("applied");
    expect(saved.sets[0]?.sessionId).not.toBe(openId);
    expect(saved.sets[0]?.sessionId).not.toBe(goneId);
    const created = await asUser.query(api.sessions.get, { sessionId: saved.sets[0]!.sessionId! });
    expect(created?.sets).toHaveLength(1);
    expect((await asUser.query(api.sessions.get, { sessionId: openId }))?.sets).toHaveLength(0);
  });

  test("a removed client id cannot be brought back by a later revision", async () => {
    const t = testBackend();
    const { asUser } = await signIn(t, "Michael");
    const created = await asUser.mutation(api.offline.accept, {
      sets: [queuedSet("client0001")],
      edits: [],
      deletes: [],
      actions: [],
    });
    const removed = await asUser.mutation(api.offline.accept, {
      sets: [
        queuedSet("client0001", {
          removed: true,
          revision: 2,
          loggedAt: Date.now() + 10 * 60 * 1000,
        }),
      ],
      edits: [],
      deletes: [],
      actions: [],
    });
    const resurrected = await asUser.mutation(api.offline.accept, {
      sets: [queuedSet("client0001", { revision: 3, weightLb: 400 })],
      edits: [],
      deletes: [],
      actions: [],
    });
    expect(removed.sets[0]?.status).toBe("applied");
    // A distinct answer, so the phone drops its copy instead of keeping a pending ghost.
    expect(resurrected.sets[0]?.status).toBe("removed");
    expect(resurrected.sets[0]?.setId).toBeNull();
    expect(
      await asUser.query(api.sets.listForSession, { sessionId: created.sets[0]!.sessionId! }),
    ).toHaveLength(0);
  });

  test("a batch that removes the best scores its new sets without it", async () => {
    const t = testBackend();
    const { asUser } = await signIn(t, "Michael");
    const first = await asUser.mutation(api.offline.accept, {
      sets: [queuedSet("client0001", { weightLb: 200, loggedAt: NOW - 60_000 })],
      edits: [],
      deletes: [],
      actions: [],
    });
    expect(first.sets[0]?.personalRecord).toEqual(expect.objectContaining({ weightLb: 200 }));

    // The new set comes first in the batch; the removal still lands before it is scored.
    const second = await asUser.mutation(api.offline.accept, {
      sets: [
        queuedSet("client0002", { weightLb: 150 }),
        queuedSet("client0001", { removed: true, revision: 2, weightLb: 200, loggedAt: NOW - 60_000 }),
      ],
      edits: [],
      deletes: [],
      actions: [],
    });
    expect(second.sets[0]?.personalRecord).toEqual(expect.objectContaining({ kind: "both", weightLb: 150 }));

    const third = await asUser.mutation(api.offline.accept, {
      sets: [queuedSet("client0003", { weightLb: 120, loggedAt: NOW + 1_000 })],
      edits: [],
      deletes: [{ deleteId: "delete0001", setId: second.sets[0]!.setId! }],
      actions: [],
    });
    expect(third.deletes[0]?.status).toBe("applied");
    expect(third.sets[0]?.personalRecord).toEqual(expect.objectContaining({ kind: "both", weightLb: 120 }));
  });

  test("a batch that removes a workout's newest set and adds another counts each set once", async () => {
    const t = testBackend();
    const { asUser } = await signIn(t, "Michael");
    const first = await asUser.mutation(api.offline.accept, {
      sets: [queuedSet("client0001", { loggedAt: NOW - 60_000 })],
      edits: [],
      deletes: [],
      actions: [],
    });
    const sessionId = first.sets[0]!.sessionId!;
    const stored = async () => await t.run(async (ctx) => await ctx.db.get("sessions", sessionId));

    // Undo the synced set and log the next one, both while offline.
    await asUser.mutation(api.offline.accept, {
      sets: [
        queuedSet("client0001", { removed: true, revision: 2, loggedAt: NOW - 60_000 }),
        queuedSet("client0002", { loggedAt: NOW - 30_000 }),
      ],
      edits: [],
      deletes: [],
      actions: [],
    });
    expect(await stored()).toMatchObject({ setCount: 1, lastSetAt: NOW - 30_000 });

    const [second] = await asUser.query(api.sets.listForSession, { sessionId });
    await asUser.mutation(api.offline.accept, {
      sets: [queuedSet("client0003", { loggedAt: NOW - 10_000 })],
      edits: [],
      deletes: [{ deleteId: "delete0001", setId: second!._id }],
      actions: [],
    });
    expect(await stored()).toMatchObject({ setCount: 1, lastSetAt: NOW - 10_000 });
  });

  test("a batch that removes one queued set and deletes the newest keeps the workout's count", async () => {
    const t = testBackend();
    const { asUser } = await signIn(t, "Michael");
    const first = await asUser.mutation(api.offline.accept, {
      sets: [
        queuedSet("client0001", { loggedAt: NOW - 60_000 }),
        queuedSet("client0002", { loggedAt: NOW - 50_000 }),
        queuedSet("client0003", { loggedAt: NOW - 40_000 }),
      ],
      edits: [],
      deletes: [],
      actions: [],
    });
    const sessionId = first.sets[0]!.sessionId!;

    await asUser.mutation(api.offline.accept, {
      sets: [queuedSet("client0001", { removed: true, revision: 2, loggedAt: NOW - 60_000 })],
      edits: [],
      deletes: [{ deleteId: "delete0001", setId: first.sets[2]!.setId! }],
      actions: [],
    });
    const stored = await t.run(async (ctx) => await ctx.db.get("sessions", sessionId));
    expect(stored).toMatchObject({ setCount: 1, lastSetAt: NOW - 50_000 });
  });

  test("an edit and a delete of one set in a batch both apply", async () => {
    const t = testBackend();
    const { asUser } = await signIn(t, "Michael");
    const created = await asUser.mutation(api.offline.accept, {
      sets: [queuedSet("client0001")],
      edits: [],
      deletes: [],
      actions: [],
    });
    const setId = created.sets[0]!.setId!;
    const both = await asUser.mutation(api.offline.accept, {
      sets: [],
      edits: [{ editId: "edit000001", setId, reps: 5, weightLb: 145 }],
      deletes: [{ deleteId: "delete0001", setId }],
      actions: [],
    });
    expect(both.edits[0]?.status).toBe("applied");
    expect(both.deletes[0]?.status).toBe("applied");
    expect(
      await asUser.query(api.sets.listForSession, { sessionId: created.sets[0]!.sessionId! }),
    ).toHaveLength(0);
  });

  test("an edit of a set deleted on another device is answered removed", async () => {
    const t = testBackend();
    const { asUser } = await signIn(t, "Michael");
    const created = await asUser.mutation(api.offline.accept, {
      sets: [queuedSet("client0001")],
      edits: [],
      deletes: [],
      actions: [],
    });
    await asUser.mutation(api.offline.accept, {
      sets: [],
      edits: [],
      deletes: [{ deleteId: "delete0001", setId: created.sets[0]!.setId! }],
      actions: [],
    });
    const edited = await asUser.mutation(api.offline.accept, {
      sets: [queuedSet("client0001", { revision: 2, weightLb: 185 })],
      edits: [],
      deletes: [],
      actions: [],
    });
    expect(edited.sets[0]).toMatchObject({ status: "removed", setId: null, sessionId: null });
  });

  test("an older phone that sends its clock is still shifted onto server time", async () => {
    const t = testBackend();
    const { asUser } = await signIn(t, "Michael");
    const fastNow = Date.now() + 60 * 60 * 1000;
    const fastLogged = fastNow - 30_000;
    const fast = await asUser.mutation(api.offline.accept, {
      clientNow: fastNow,
      sets: [
        queuedSet("clientfast01", {
          sessionClientId: "fastsession01",
          sessionStartedAt: fastLogged,
          loggedAt: fastLogged,
        }),
      ],
      edits: [],
      deletes: [],
      actions: [],
    });
    expect(fast.sets[0]?.status).toBe("applied");
    const fastSet = (
      await asUser.query(api.sets.listForSession, { sessionId: fast.sets[0]!.sessionId! })
    )[0];
    expect(fastSet?.loggedAt).toBeLessThanOrEqual(Date.now());
    expect(fastSet?.loggedAt ?? 0).toBeGreaterThan(Date.now() - 2 * 60 * 1000);

    const skew = 3 * 24 * 60 * 60 * 1000;
    const slowNow = Date.now() - skew;
    const slowLogged = slowNow - 30_000;
    const slow = await asUser.mutation(api.offline.accept, {
      clientNow: slowNow,
      sets: [
        queuedSet("clientslow01", {
          sessionClientId: "slowsession01",
          sessionStartedAt: slowLogged,
          loggedAt: slowLogged,
        }),
      ],
      edits: [],
      deletes: [],
      actions: [],
    });
    const slowSet = (
      await asUser.query(api.sets.listForSession, { sessionId: slow.sets[0]!.sessionId! })
    )[0];
    expect(slowSet?.loggedAt).toBeLessThanOrEqual(Date.now());
    expect(slowSet?.loggedAt ?? 0).toBeGreaterThan(Date.now() - 2 * 60 * 1000);
  });

  test("a measured clock offset does not count a late delivery as clock error", async () => {
    const t = testBackend();
    const { asUser } = await signIn(t, "Michael");
    // Built 20 minutes ago on a correct clock, delivered now.
    const logged = Date.now() - 21 * 60_000;
    const late = await asUser.mutation(api.offline.accept, {
      clockOffsetMs: 0,
      sets: [
        queuedSet("clientlate01", {
          sessionClientId: "latesession01",
          sessionStartedAt: logged - 60_000,
          loggedAt: logged,
        }),
      ],
      edits: [],
      deletes: [],
      actions: [],
    });
    expect(late.serverNow).toBeGreaterThanOrEqual(logged);
    const rows = await asUser.query(api.sets.listForSession, { sessionId: late.sets[0]!.sessionId! });
    expect(rows[0]?.loggedAt).toBe(logged);
  });

  test("a measured clock offset corrects a fast or slow phone", async () => {
    const t = testBackend();
    const hour = 60 * 60 * 1000;
    const day = 24 * hour;
    const fastUser = await signIn(t, "Fast");
    const fastLogged = Date.now() + hour - 30_000;
    const fast = await fastUser.asUser.mutation(api.offline.accept, {
      clockOffsetMs: -hour,
      sets: [
        queuedSet("clientfast01", {
          sessionClientId: "fastsession01",
          sessionStartedAt: fastLogged,
          loggedAt: fastLogged,
        }),
      ],
      edits: [],
      deletes: [],
      actions: [],
    });
    const fastRows = await fastUser.asUser.query(api.sets.listForSession, {
      sessionId: fast.sets[0]!.sessionId!,
    });
    expect(fastRows[0]?.loggedAt).toBe(fastLogged - hour);

    const slowUser = await signIn(t, "Slow");
    const slowLogged = Date.now() - 3 * day - 30_000;
    const slow = await slowUser.asUser.mutation(api.offline.accept, {
      clockOffsetMs: 3 * day,
      sets: [
        queuedSet("clientslow01", {
          sessionClientId: "slowsession01",
          sessionStartedAt: slowLogged,
          loggedAt: slowLogged,
        }),
      ],
      edits: [],
      deletes: [],
      actions: [],
    });
    const slowRows = await slowUser.asUser.query(api.sets.listForSession, {
      sessionId: slow.sets[0]!.sessionId!,
    });
    expect(slowRows[0]?.loggedAt).toBe(slowLogged + 3 * day);
  });

  test("an offset past a year is ignored, and no reading leaves times unshifted but not in the future", async () => {
    const t = testBackend();
    const day = 24 * 60 * 60 * 1000;
    const wildUser = await signIn(t, "Wild");
    const logged = Date.now() - 5 * 60_000;
    const wild = await wildUser.asUser.mutation(api.offline.accept, {
      clockOffsetMs: 400 * day,
      sets: [
        queuedSet("clientwild01", {
          sessionClientId: "wildsession01",
          sessionStartedAt: logged,
          loggedAt: logged,
        }),
      ],
      edits: [],
      deletes: [],
      actions: [],
    });
    const wildRows = await wildUser.asUser.query(api.sets.listForSession, {
      sessionId: wild.sets[0]!.sessionId!,
    });
    expect(wildRows[0]?.loggedAt).toBe(logged);

    const bareUser = await signIn(t, "Bare");
    const ahead = Date.now() + 60 * 60 * 1000;
    const bare = await bareUser.asUser.mutation(api.offline.accept, {
      sets: [
        queuedSet("clientbare01", {
          sessionClientId: "baresession01",
          sessionStartedAt: ahead,
          loggedAt: ahead,
        }),
      ],
      edits: [],
      deletes: [],
      actions: [],
    });
    expect(bare.sets[0]?.status).toBe("applied");
    const bareRows = await bareUser.asUser.query(api.sets.listForSession, {
      sessionId: bare.sets[0]!.sessionId!,
    });
    expect(bareRows[0]?.loggedAt).toBeLessThanOrEqual(Date.now());
    expect(bareRows[0]?.loggedAt ?? 0).toBeGreaterThan(Date.now() - 2 * 60 * 1000);
  });

  test("the server clock can be read for a first reading", async () => {
    const t = testBackend();
    const { asUser } = await signIn(t, "Michael");
    const before = Date.now();
    const serverNow = await asUser.mutation(api.offline.serverTime, {});
    expect(serverNow).toBeGreaterThanOrEqual(before);
    expect(serverNow).toBeLessThanOrEqual(Date.now());
    await expect(t.mutation(api.offline.serverTime, {})).rejects.toThrow("Not authenticated");
  });

  test("a past workout sent in two batches with different clock readings stays one workout", async () => {
    const t = testBackend();
    const { asUser, userId } = await signIn(t, "Michael");
    const startedAt = Date.now() - 3 * 24 * 60 * 60 * 1000;
    const past = {
      placement: "completed" as const,
      sessionClientId: "pastsession01",
      sessionStartedAt: startedAt,
    };
    const first = await asUser.mutation(api.offline.accept, {
      clockOffsetMs: 0,
      sets: [queuedSet("clientpast01", { ...past, loggedAt: startedAt })],
      edits: [],
      deletes: [],
      actions: [],
    });
    const second = await asUser.mutation(api.offline.accept, {
      clockOffsetMs: 5 * 60_000,
      sets: [queuedSet("clientpast02", { ...past, loggedAt: startedAt + 1000 })],
      edits: [],
      deletes: [],
      actions: [],
    });
    // An older phone's clock at send time moves with delivery delay too.
    const third = await asUser.mutation(api.offline.accept, {
      clientNow: Date.now() - 5 * 60_000,
      sets: [queuedSet("clientpast03", { ...past, loggedAt: startedAt + 2000 })],
      edits: [],
      deletes: [],
      actions: [],
    });
    const sessionId = first.sets[0]!.sessionId!;
    expect(second.sets[0]?.sessionId).toBe(sessionId);
    expect(third.sets[0]?.sessionId).toBe(sessionId);
    const sessions = await t.run(async (ctx) =>
      (await ctx.db.query("sessions").collect()).filter((session) => session.userId === userId),
    );
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.clientStartedAt).toBe(startedAt);
    expect((await asUser.query(api.sessions.get, { sessionId }))?.sets).toHaveLength(3);
  });

  test("a finish for a workout the cron already closed still saves the note and end time", async () => {
    const t = testBackend();
    const { asUser } = await signIn(t, "Michael");
    const saved = await asUser.mutation(api.offline.accept, {
      sets: [queuedSet("client0001", { loggedAt: NOW - 60_000 })],
      edits: [],
      deletes: [],
      actions: [
        {
          actionId: "action0001",
          kind: "complete" as const,
          sessionClientId: "sessionclient01",
          requestedAt: NOW - 30_000,
        },
      ],
    });
    const sessionId = saved.sets[0]!.sessionId!;
    const later = await asUser.mutation(api.offline.accept, {
      sets: [],
      edits: [],
      deletes: [],
      actions: [
        {
          actionId: "action0002",
          kind: "complete" as const,
          sessionId,
          sessionClientId: "sessionclient01",
          note: "after the cron",
          requestedAt: NOW - 10_000,
        },
      ],
    });
    expect(later.actions[0]?.status).toBe("applied");
    const session = await asUser.query(api.sessions.get, { sessionId });
    expect(session?.note).toBe("after the cron");
    expect(session?.completedAt).toBe(NOW - 10_000);
  });
});
