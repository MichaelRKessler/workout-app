/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");

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
  return { userId, asUser: t.withIdentity({ subject: `${userId}|${name}-session` }) };
}

describe("body weight and measurements", () => {
  test("saves, lists, charts, and does not duplicate a retry", async () => {
    const t = testBackend();
    const { asUser } = await signIn(t, "Michael");
    const other = await signIn(t, "Other");
    const earlier = Date.now() - 2 * 24 * 60 * 60 * 1000;
    const later = Date.now() - 60 * 1000;
    const first = await asUser.mutation(api.body.save, {
      loggedAt: earlier,
      clientId: "bodyclient1",
      weightLb: 230,
    });
    const retry = await asUser.mutation(api.body.save, {
      loggedAt: later,
      clientId: "bodyclient1",
      weightLb: 240,
    });
    expect(retry).toBe(first);
    const second = await asUser.mutation(api.body.save, {
      loggedAt: later,
      weightLb: 232,
      waistCm: 86,
      note: "morning",
    });
    expect(second).not.toBe(first);

    const summary = await asUser.query(api.body.summary, {});
    expect(summary.latest).toMatchObject({ weightLb: 232, waistCm: 86, note: "morning" });
    expect(summary.weightTrend.map((point) => point.weightLb)).toEqual([230, 232]);

    const page = await asUser.query(api.body.list, {
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(page.page.map((entry) => entry.weightLb)).toEqual([232, 230]);

    const hidden = await other.asUser.query(api.body.summary, {});
    expect(hidden.latest).toBeNull();
    expect(hidden.weightTrend).toEqual([]);
    await expect(other.asUser.mutation(api.body.update, { entryId: second, loggedAt: later, weightLb: 1 })).rejects.toThrow(
      "Entry not found",
    );
    await expect(other.asUser.mutation(api.body.remove, { entryId: second })).rejects.toThrow("Entry not found");

    await asUser.mutation(api.body.update, { entryId: second, loggedAt: later, weightLb: 231 });
    expect((await asUser.query(api.body.summary, {})).latest?.weightLb).toBe(231);
    expect((await asUser.query(api.body.summary, {})).latest?.waistCm).toBeNull();
    await asUser.mutation(api.body.remove, { entryId: second });
    expect((await asUser.query(api.body.summary, {})).latest?._id).toBe(first);

    await expect(asUser.mutation(api.body.save, { loggedAt: later })).rejects.toThrow(
      "Add a weight or a measurement",
    );
    await expect(
      asUser.mutation(api.body.save, { loggedAt: Date.now() + 60 * 60 * 1000, weightLb: 200 }),
    ).rejects.toThrow("That date is invalid");
  });

  test("only the owner and the allow list can read the log", async () => {
    const t = testBackend();
    const { asUser } = await signIn(t, "Michael");
    await asUser.mutation(api.body.save, { loggedAt: Date.now() - 1000, weightLb: 200 });
    const blocked = await signIn(t, "Blocked", { email: "blocked@example.com", allow: false });
    await expect(blocked.asUser.query(api.body.summary, {})).rejects.toThrow("You don't have access yet");
    await expect(blocked.asUser.mutation(api.body.save, { loggedAt: Date.now(), weightLb: 180 })).rejects.toThrow(
      "You don't have access yet",
    );
    await expect(t.query(api.body.summary, {})).rejects.toThrow("Not authenticated");
    await expect(t.mutation(api.body.save, { loggedAt: Date.now(), weightLb: 180 })).rejects.toThrow(
      "Not authenticated",
    );
  });

  test("inches follow pounds until a length unit is chosen", async () => {
    const t = testBackend();
    const { userId, asUser } = await signIn(t, "Michael");
    expect(await asUser.query(api.users.preferences, {})).toMatchObject({
      weightUnit: "lb",
      lengthUnit: "in",
    });
    await t.run(async (ctx) => {
      const existing = await ctx.db
        .query("preferences")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .unique();
      if (existing) {
        await ctx.db.delete("preferences", existing._id);
      }
      await ctx.db.insert("preferences", { userId, weightUnit: "kg" });
    });
    expect(await asUser.query(api.users.preferences, {})).toMatchObject({
      weightUnit: "kg",
      lengthUnit: "cm",
    });
    await asUser.mutation(api.users.setLengthUnit, { lengthUnit: "in" });
    await asUser.mutation(api.users.setWeightUnit, { weightUnit: "lb" });
    expect(await asUser.query(api.users.preferences, {})).toMatchObject({
      weightUnit: "lb",
      lengthUnit: "in",
    });
    await asUser.mutation(api.users.setWeightUnit, { weightUnit: "kg" });
    expect(await asUser.query(api.users.preferences, {})).toMatchObject({
      weightUnit: "kg",
      lengthUnit: "in",
    });
    await asUser.mutation(api.users.setProgression, {
      suggestNextWeight: true,
      progressionIncrementLb: 5,
    });
    expect(await asUser.query(api.users.preferences, {})).toMatchObject({
      lengthUnit: "in",
      progressionIncrementLb: 5,
    });
    const blocked = await signIn(t, "Nope", { email: "nope@example.com", allow: false });
    await expect(blocked.asUser.mutation(api.users.setLengthUnit, { lengthUnit: "cm" })).rejects.toThrow(
      "You don't have access yet",
    );
  });

  test("an offline batch saves a weigh-in once", async () => {
    const t = testBackend();
    const { asUser } = await signIn(t, "Michael");
    const loggedAt = Date.now() - 5 * 60 * 1000;
    const batch = {
      sets: [],
      edits: [],
      deletes: [],
      actions: [],
      body: [{ clientId: "offlinebody1", loggedAt, weightLb: 232 }],
    };
    const first = await asUser.mutation(api.offline.accept, batch);
    expect(first.body).toMatchObject([{ clientId: "offlinebody1", status: "applied" }]);
    const second = await asUser.mutation(api.offline.accept, batch);
    expect(second.body[0]?.entryId).toBe(first.body[0]?.entryId);
    const page = await asUser.query(api.body.list, {
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(page.page).toHaveLength(1);
    expect(page.page[0]).toMatchObject({ weightLb: 232, clientId: "offlinebody1" });

    const empty = await asUser.mutation(api.offline.accept, {
      sets: [
        {
          clientId: "setclient01",
          revision: 1,
          removed: false,
          placement: "open" as const,
          sessionClientId: "sessionclient01",
          sessionStartedAt: loggedAt,
          exerciseName: "Bench press",
          reps: 5,
          weightLb: 135,
          loggedAt,
        },
      ],
      edits: [],
      deletes: [],
      actions: [],
    });
    expect(empty.body).toEqual([]);
  });
});

describe("muscle groups on exercises", () => {
  test("an old exercise suggests from its name until someone overrides it", async () => {
    const t = testBackend();
    const { userId, asUser } = await signIn(t, "Michael");
    const exerciseId = await t.run(async (ctx) => {
      return await ctx.db.insert("exercises", {
        userId,
        name: "Bench press",
        normalizedName: "bench press",
        createdAt: 1,
      });
    });
    const suggested = await asUser.query(api.exercises.detail, { exerciseId });
    expect(suggested).toMatchObject({ muscleGroup: "chest", muscleSource: "suggested" });

    await asUser.mutation(api.exercises.setMuscle, { exerciseId, muscleGroup: "shoulders" });
    expect(await asUser.query(api.exercises.detail, { exerciseId })).toMatchObject({
      muscleGroup: "shoulders",
      muscleSource: "saved",
    });
    await asUser.mutation(api.exercises.setRest, { name: "Bench press", restSeconds: 90 });
    expect(await asUser.query(api.exercises.restForName, { name: "Bench press" })).toBe(90);
    expect(await asUser.query(api.exercises.detail, { exerciseId })).toMatchObject({
      muscleGroup: "shoulders",
    });
    await asUser.mutation(api.exercises.setMuscle, { exerciseId, muscleGroup: null });
    expect(await asUser.query(api.exercises.detail, { exerciseId })).toMatchObject({
      muscleGroup: "chest",
      muscleSource: "suggested",
    });
    expect(await asUser.query(api.exercises.restForName, { name: "Bench press" })).toBe(90);

    const other = await signIn(t, "Other");
    await expect(
      other.asUser.mutation(api.exercises.setMuscle, { exerciseId, muscleGroup: "back" }),
    ).rejects.toThrow("Exercise not found");
    const blocked = await signIn(t, "Blocked", { email: "blocked@example.com", allow: false });
    await expect(
      blocked.asUser.mutation(api.exercises.setMuscle, { exerciseId, muscleGroup: "back" }),
    ).rejects.toThrow("You don't have access yet");
  });

  test("a merge does not retag a named exercise with a conflicting group", async () => {
    const t = testBackend();
    const { userId, asUser } = await signIn(t, "Michael");
    const now = Date.now();
    const squatId = await t.run(async (ctx) => {
      return await ctx.db.insert("exercises", {
        userId,
        name: "Squat",
        normalizedName: "squat",
        createdAt: now,
      });
    });
    const curlId = await t.run(async (ctx) => {
      return await ctx.db.insert("exercises", {
        userId,
        name: "Curl",
        normalizedName: "curl",
        createdAt: now,
        muscleGroup: "biceps" as const,
      });
    });
    await asUser.mutation(api.exercises.merge, { fromId: curlId, intoId: squatId });
    expect(await asUser.query(api.exercises.detail, { exerciseId: squatId })).toMatchObject({
      muscleGroup: "quads",
      muscleSource: "suggested",
    });

    const customId = await t.run(async (ctx) => {
      return await ctx.db.insert("exercises", {
        userId,
        name: "Custom move",
        normalizedName: "custom move",
        createdAt: now,
      });
    });
    const taggedId = await t.run(async (ctx) => {
      return await ctx.db.insert("exercises", {
        userId,
        name: "Tagged move",
        normalizedName: "tagged move",
        createdAt: now,
        muscleGroup: "glutes" as const,
      });
    });
    await asUser.mutation(api.exercises.merge, { fromId: taggedId, intoId: customId });
    expect(await asUser.query(api.exercises.detail, { exerciseId: customId })).toMatchObject({
      muscleGroup: "glutes",
      muscleSource: "saved",
    });
  });
});
