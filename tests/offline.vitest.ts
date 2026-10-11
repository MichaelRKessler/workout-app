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
    sessionStartedAt: NOW,
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
});
