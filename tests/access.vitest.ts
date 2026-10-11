/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { ADMIN_EMAIL } from "../convex/lib/accessControl";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");

function testBackend() {
  return convexTest(schema, modules);
}

async function createUser(
  t: ReturnType<typeof testBackend>,
  email: string,
  options?: { allow?: boolean; name?: string },
) {
  const userId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("users", {
      name: options?.name ?? "Lifter",
      email,
    });
    if (options?.allow) {
      await ctx.db.insert("allowedEmails", {
        email: email.trim().toLowerCase(),
        createdAt: Date.now(),
      });
    }
    return id;
  });
  return {
    userId,
    asUser: t.withIdentity({ subject: `${userId}|session` }),
  };
}

describe("allow list", () => {
  test("an allow-listed email can use workouts, and a missing email cannot", async () => {
    const t = testBackend();
    const allowed = await createUser(t, "friend@example.com", { allow: true });
    const blocked = await createUser(t, "stranger@example.com");

    const sessionId = await allowed.asUser.mutation(api.sessions.start, {});
    await allowed.asUser.mutation(api.sets.log, {
      sessionId,
      exerciseName: "squat",
      reps: 5,
      weightLb: 185,
    });
    expect(await allowed.asUser.query(api.exercises.list, {})).toMatchObject({
      exercises: [{ name: "squat" }],
    });
    const history = await allowed.asUser.query(api.sessions.listHistory, {
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(history.page).toHaveLength(0);
    expect(await allowed.asUser.query(api.users.viewer, {})).toMatchObject({
      email: "friend@example.com",
    });

    await expect(blocked.asUser.mutation(api.sessions.start, {})).rejects.toThrow(
      "You don't have access yet",
    );
    await expect(blocked.asUser.query(api.exercises.list, {})).rejects.toThrow(
      "You don't have access yet",
    );
    await expect(blocked.asUser.query(api.sets.listForSession, { sessionId })).rejects.toThrow(
      "You don't have access yet",
    );
    await expect(
      blocked.asUser.query(api.sessions.listHistory, {
        paginationOpts: { numItems: 10, cursor: null },
      }),
    ).rejects.toThrow("You don't have access yet");
    await expect(blocked.asUser.query(api.users.viewer, {})).rejects.toThrow(
      "You don't have access yet",
    );
    await expect(
      blocked.asUser.mutation(api.sessions.discard, { sessionId }),
    ).rejects.toThrow("You don't have access yet");
    await expect(blocked.asUser.mutation(api.sets.log, {
      sessionId,
      exerciseName: "squat",
      reps: 5,
      weightLb: 185,
    })).rejects.toThrow("You don't have access yet");
    const [logged] = await allowed.asUser.query(api.sets.listForSession, { sessionId });
    if (!logged) {
      throw new Error("Expected a logged set");
    }
    await expect(
      blocked.asUser.query(api.sets.recentForExercise, { exerciseName: "squat" }),
    ).rejects.toThrow("You don't have access yet");
    await expect(blocked.asUser.query(api.exercises.namesForVoice, {})).rejects.toThrow(
      "You don't have access yet",
    );
    await expect(
      blocked.asUser.mutation(api.sets.update, {
        setId: logged._id,
        reps: 4,
        weightLb: 100,
      }),
    ).rejects.toThrow("You don't have access yet");
    await expect(blocked.asUser.query(api.users.preferences, {})).rejects.toThrow(
      "You don't have access yet",
    );
    await expect(
      blocked.asUser.mutation(api.users.setWeightUnit, { weightUnit: "kg" }),
    ).rejects.toThrow("You don't have access yet");
    await expect(
      blocked.asUser.mutation(api.users.setProgression, {
        suggestNextWeight: false,
        progressionIncrementLb: 5,
      }),
    ).rejects.toThrow("You don't have access yet");
    await expect(
      blocked.asUser.mutation(api.exercises.setRest, { name: "squat", restSeconds: 120 }),
    ).rejects.toThrow("You don't have access yet");
    await expect(blocked.asUser.query(api.exercises.restForName, { name: "squat" })).rejects.toThrow(
      "You don't have access yet",
    );
    await expect(
      blocked.asUser.mutation(api.sets.logWorkout, {
        sessionId,
        exercises: [{ exerciseName: "squat", sets: [{ reps: 5, weightLb: 185 }] }],
      }),
    ).rejects.toThrow("You don't have access yet");
    await expect(
      blocked.asUser.query(api.exercises.browse, {
        paginationOpts: { numItems: 10, cursor: null },
      }),
    ).rejects.toThrow("You don't have access yet");
    await expect(
      blocked.asUser.mutation(api.exercises.rename, {
        exerciseId: logged.exerciseId,
        name: "nope",
      }),
    ).rejects.toThrow("You don't have access yet");
    await expect(
      blocked.asUser.mutation(api.exercises.merge, {
        fromId: logged.exerciseId,
        intoId: logged.exerciseId,
      }),
    ).rejects.toThrow("You don't have access yet");
    await expect(
      blocked.asUser.mutation(api.sessions.setNote, { sessionId, note: "note" }),
    ).rejects.toThrow("You don't have access yet");
  });

  test("the admin email is allowed without a row, in any case, and is the only admin", async () => {
    const t = testBackend();
    const admin = await createUser(t, "  MichaelR.Kessler@gmail.com  ", {
      name: "Michael",
    });
    const friend = await createUser(t, "friend@example.com", { allow: true });

    const sessionId = await admin.asUser.mutation(api.sessions.start, {});
    const status = await admin.asUser.query(api.access.myStatus, {});
    expect(status).toMatchObject({
      email: ADMIN_EMAIL,
      allowed: true,
      isAdmin: true,
    });
    expect(sessionId).toBeTruthy();

    const friendStatus = await friend.asUser.query(api.access.myStatus, {});
    expect(friendStatus.isAdmin).toBe(false);
    expect(friendStatus.allowed).toBe(true);

    await expect(friend.asUser.query(api.access.listAllowed, {})).rejects.toThrow(
      "Admin access required",
    );
    await expect(friend.asUser.query(api.access.listPending, {})).rejects.toThrow(
      "Admin access required",
    );
    await expect(
      friend.asUser.mutation(api.access.addEmail, { email: "other@example.com" }),
    ).rejects.toThrow("Admin access required");
    await expect(
      friend.asUser.mutation(api.access.removeEmail, { email: "friend@example.com" }),
    ).rejects.toThrow("Admin access required");
    await expect(friend.asUser.mutation(api.access.ensureAdmin, {})).rejects.toThrow(
      "Admin access required",
    );

    const stranger = await createUser(t, "stranger@example.com");
    await expect(
      stranger.asUser.mutation(api.access.addEmail, { email: "other@example.com" }),
    ).rejects.toThrow("You don't have access yet");
    await expect(t.mutation(api.access.addEmail, { email: "other@example.com" })).rejects.toThrow(
      "Not authenticated",
    );
    await expect(t.mutation(api.sessions.start, {})).rejects.toThrow("Not authenticated");
  });

  test("admin can add and remove emails, but not the admin email", async () => {
    const t = testBackend();
    const admin = await createUser(t, ADMIN_EMAIL, { name: "Michael" });
    const friend = await createUser(t, "Friend@Example.com");

    await expect(friend.asUser.mutation(api.sessions.start, {})).rejects.toThrow(
      "You don't have access yet",
    );
    await admin.asUser.mutation(api.access.addEmail, { email: "  Friend@Example.COM " });
    const sessionId = await friend.asUser.mutation(api.sessions.start, {});
    expect(sessionId).toBeTruthy();

    const listed = await admin.asUser.query(api.access.listAllowed, {});
    expect(listed.map((entry) => entry.email)).toEqual([
      "friend@example.com",
      ADMIN_EMAIL,
    ]);
    expect(listed.find((entry) => entry.email === ADMIN_EMAIL)?.isAdmin).toBe(true);

    await expect(
      admin.asUser.mutation(api.access.removeEmail, { email: "MichaelR.Kessler@gmail.com" }),
    ).rejects.toThrow("The admin email cannot be removed");
    await admin.asUser.mutation(api.access.removeEmail, { email: "friend@example.com" });
    await expect(friend.asUser.query(api.sessions.getOpen, {})).rejects.toThrow(
      "You don't have access yet",
    );

    const open = await t.run(async (ctx) => {
      return await ctx.db.get("sessions", sessionId);
    });
    expect(open?.userId).toBe(friend.userId);
  });

  test("taking access away hides workouts and putting it back restores them", async () => {
    const t = testBackend();
    const admin = await createUser(t, ADMIN_EMAIL);
    const friend = await createUser(t, "friend@example.com", { allow: true });
    const sessionId = await friend.asUser.mutation(api.sessions.start, {});
    await friend.asUser.mutation(api.sets.log, {
      sessionId,
      exerciseName: "deadlift",
      reps: 3,
      weightLb: 225,
    });

    await admin.asUser.mutation(api.access.removeEmail, { email: "friend@example.com" });
    await expect(friend.asUser.query(api.sessions.getOpen, {})).rejects.toThrow(
      "You don't have access yet",
    );

    await admin.asUser.mutation(api.access.addEmail, { email: "friend@example.com" });
    const open = await friend.asUser.query(api.sessions.getOpen, {});
    expect(open?._id).toBe(sessionId);
    const sets = await friend.asUser.query(api.sets.listForSession, { sessionId });
    expect(sets.map((set) => set.exerciseName)).toEqual(["deadlift"]);
  });

  test("request access is one pending row per email", async () => {
    const t = testBackend();
    const stranger = await createUser(t, "  Stranger@Example.com ");

    const first = await stranger.asUser.mutation(api.access.requestAccess, {
      note: "  I train with Michael  ",
    });
    const second = await stranger.asUser.mutation(api.access.requestAccess, {
      note: "please please please",
    });
    expect(first).toEqual({ status: "pending", alreadyRequested: false });
    expect(second).toEqual({ status: "pending", alreadyRequested: true });

    const status = await stranger.asUser.query(api.access.myStatus, {});
    expect(status.allowed).toBe(false);
    expect(status.request).toEqual({
      status: "pending",
      note: "I train with Michael",
    });

    const pending = await t.run(async (ctx) => {
      return await ctx.db.query("accessRequests").take(10);
    });
    expect(pending).toHaveLength(1);
    expect(pending[0]?.email).toBe("stranger@example.com");

    await expect(
      stranger.asUser.mutation(api.access.requestAccess, { note: "x".repeat(281) }),
    ).rejects.toThrow("Note must be 280 characters or less");
    const afterLongNote = await t.run(async (ctx) => {
      return await ctx.db.query("accessRequests").take(10);
    });
    expect(afterLongNote).toHaveLength(1);
  });

  test("approve adds the email, deny does not, and a denied person can ask again", async () => {
    const t = testBackend();
    const admin = await createUser(t, ADMIN_EMAIL);
    const stranger = await createUser(t, "stranger@example.com");
    await stranger.asUser.mutation(api.access.requestAccess, { note: "hi" });
    const [request] = await admin.asUser.query(api.access.listPending, {});
    if (!request) {
      throw new Error("expected a pending request");
    }

    await expect(
      stranger.asUser.mutation(api.access.approve, { requestId: request._id }),
    ).rejects.toThrow("You don't have access yet");
    await expect(
      stranger.asUser.mutation(api.access.deny, { requestId: request._id }),
    ).rejects.toThrow("You don't have access yet");

    await admin.asUser.mutation(api.access.deny, { requestId: request._id });
    await expect(stranger.asUser.mutation(api.sessions.start, {})).rejects.toThrow(
      "You don't have access yet",
    );
    expect(await admin.asUser.query(api.access.listPending, {})).toEqual([]);
    const denied = await stranger.asUser.query(api.access.myStatus, {});
    expect(denied.request?.status).toBe("denied");

    const again = await stranger.asUser.mutation(api.access.requestAccess, {});
    expect(again.alreadyRequested).toBe(false);
    const [next] = await admin.asUser.query(api.access.listPending, {});
    if (!next) {
      throw new Error("expected a new pending request");
    }
    await admin.asUser.mutation(api.access.approve, { requestId: next._id });
    expect((await stranger.asUser.query(api.access.myStatus, {})).allowed).toBe(true);
    await stranger.asUser.mutation(api.sessions.start, {});
    await expect(
      admin.asUser.mutation(api.access.approve, { requestId: next._id }),
    ).rejects.toThrow("This request is no longer pending");

    const rows = await t.run(async (ctx) => {
      const all = await ctx.db.query("accessRequests").take(10);
      return all.filter((row) => row.email === "stranger@example.com");
    });
    expect(rows.filter((row) => row.status === "pending")).toHaveLength(0);
    expect(rows.filter((row) => row.status === "approved")).toHaveLength(1);
  });

  test("adding an email closes its pending request", async () => {
    const t = testBackend();
    const admin = await createUser(t, ADMIN_EMAIL);
    const stranger = await createUser(t, "stranger@example.com");
    await stranger.asUser.mutation(api.access.requestAccess, {});
    await admin.asUser.mutation(api.access.addEmail, { email: "stranger@example.com" });
    expect(await admin.asUser.query(api.access.listPending, {})).toEqual([]);
    expect((await stranger.asUser.query(api.access.myStatus, {})).allowed).toBe(true);
  });

  test("sign-in seeds the admin and flags an account that is not allow-listed", async () => {
    const t = testBackend();
    const stranger = await createUser(t, "Stranger@Example.com");
    const admin = await createUser(t, "MichaelR.Kessler@gmail.com");

    const blocked = await t.mutation(internal.access.recordSignIn, {
      userId: stranger.userId,
      email: "Stranger@Example.com",
    });
    const allowed = await t.mutation(internal.access.recordSignIn, {
      userId: admin.userId,
      email: "MichaelR.Kessler@gmail.com",
    });
    expect(blocked).toEqual({ allowed: false });
    expect(allowed).toEqual({ allowed: true });

    const flags = await t.run(async (ctx) => {
      const rows = await ctx.db.query("signInFlags").take(10);
      const adminRow = await ctx.db
        .query("allowedEmails")
        .withIndex("by_email", (q) => q.eq("email", ADMIN_EMAIL))
        .unique();
      return { rows, adminRow };
    });
    expect(flags.adminRow?.email).toBe(ADMIN_EMAIL);
    expect(flags.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: stranger.userId, allowed: false }),
        expect.objectContaining({ userId: admin.userId, allowed: true }),
      ]),
    );

    await admin.asUser.mutation(api.access.ensureAdmin, {});
    const listed = await admin.asUser.query(api.access.listAllowed, {});
    expect(listed.filter((entry) => entry.email === ADMIN_EMAIL)).toHaveLength(1);
  });

  test("batch saves, undo, and keep going require the allow list", async () => {
    const t = testBackend();
    const allowed = await createUser(t, "friend@example.com", { allow: true });
    const blocked = await createUser(t, "stranger@example.com");
    const sessionId = await allowed.asUser.mutation(api.sessions.start, {});
    const ids = (
      await allowed.asUser.mutation(api.sets.logMany, {
        sessionId,
        exerciseName: "squat",
        sets: [{ reps: 5, weightLb: 135 }],
      })
    ).setIds;

    await expect(
      blocked.asUser.mutation(api.sets.logMany, {
        sessionId,
        exerciseName: "squat",
        sets: [{ reps: 5, weightLb: 145 }],
      }),
    ).rejects.toThrow("You don't have access yet");
    await expect(
      blocked.asUser.mutation(api.sets.removeMany, { setIds: ids }),
    ).rejects.toThrow("You don't have access yet");
    await expect(
      blocked.asUser.mutation(api.sessions.keepGoing, { sessionId }),
    ).rejects.toThrow("You don't have access yet");
    await expect(
      blocked.asUser.mutation(api.sessions.complete, {
        sessionId,
        completedAt: Date.now(),
      }),
    ).rejects.toThrow("You don't have access yet");

    const sets = await allowed.asUser.query(api.sets.listForSession, { sessionId });
    expect(sets).toHaveLength(1);
    expect((await allowed.asUser.query(api.sessions.getOpen, {}))?.resumedAt).toBeNull();
  });
});
