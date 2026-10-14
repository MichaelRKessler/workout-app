/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import schema from "../convex/schema";
import catalogueJson from "../lib/demos/catalogue.json";
import { DEMO_ALIASES, demoImageUrls, matchDemo, NO_DEMO, videoSearchUrl, type DemoEntry } from "../lib/demos/match";

const catalogue = catalogueJson as DemoEntry[];
const modules = import.meta.glob("../convex/**/*.ts");

async function signIn(t: ReturnType<typeof convexTest>, name: string) {
  const email = `${name.toLowerCase()}.user@example.com`;
  const userId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("users", { name, email });
    await ctx.db.insert("allowedEmails", { email, createdAt: Date.now() });
    return id;
  });
  return { userId, asUser: t.withIdentity({ subject: `${userId}|${name}-session` }) };
}

async function addExercise(t: ReturnType<typeof convexTest>, userId: Awaited<ReturnType<typeof signIn>>["userId"], name: string) {
  return await t.run(async (ctx) =>
    ctx.db.insert("exercises", { userId, name, normalizedName: name.toLowerCase(), createdAt: Date.now() }),
  );
}

describe("matching names to demos", () => {
  test.each([
    ["Bench press", "Barbell Bench Press - Medium Grip"],
    ["Incline DB press", "Incline Dumbbell Press"],
    ["Pull-ups", "Pullups"],
    ["Chin ups", "Chin-Up"],
    ["Squats", "Barbell Squat"],
    ["RDL", "Romanian Deadlift"],
    ["OHP", "Standing Military Press"],
    ["Lat pull-down", "Wide-Grip Lat Pulldown"],
    ["Dumbbell rows", "One-Arm Dumbbell Row"],
    ["Hammer curls", "Hammer Curls"],
    ["Curl", "Barbell Curl"],
    ["Skullcrushers", "EZ-Bar Skullcrusher"],
    ["Rear delt flyes", "Reverse Flyes"],
    ["Hamstring curls", "Lying Leg Curls"],
    ["Farmer's walk", "Farmer's Walk"],
    ["Goblet squat", "Goblet Squat"],
    ["Smith machine squat", "Smith Machine Squat"],
    ["T-bar row", "T-Bar Row with Handle"],
  ])("%s finds %s", (name, expected) => {
    expect(matchDemo(name, catalogue)?.name).toBe(expected);
  });

  test("a name with no close match finds nothing rather than a guess", () => {
    expect(matchDemo("Burpees", catalogue)).toBeNull();
    expect(matchDemo("Landmine press", catalogue)).toBeNull();
    expect(matchDemo("   ", catalogue)).toBeNull();
  });

  test("every alias points at a catalogue entry", () => {
    const ids = new Set(catalogue.map((entry) => entry.id));
    for (const [name, id] of Object.entries(DEMO_ALIASES)) {
      expect(ids.has(id), `${name} → ${id}`).toBe(true);
      expect(matchDemo(name, catalogue)?.id, name).toBe(id);
    }
  });

  test("photos come from the pinned commit and the video link searches the name", () => {
    const [start, end] = demoImageUrls("Barbell_Squat");
    expect(start).toMatch(/^https:\/\/cdn\.jsdelivr\.net\/gh\/yuhonas\/free-exercise-db@[0-9a-f]{40}\/exercises\/Barbell_Squat\/0\.jpg$/);
    expect(end).toMatch(/\/Barbell_Squat\/1\.jpg$/);
    expect(videoSearchUrl("Bench press")).toBe(
      "https://www.youtube.com/results?search_query=Bench%20press%20exercise%20form",
    );
  });
});

describe("saving a demo choice", () => {
  test("a choice saves, survives a muscle change, and null follows the name again", async () => {
    const t = convexTest(schema, modules);
    const { userId, asUser } = await signIn(t, "Michael");
    const exerciseId = await addExercise(t, userId, "Bench press");

    expect(await asUser.query(api.exercises.demoChoice, { exerciseId })).toEqual({ demoId: null });
    await asUser.mutation(api.exercises.setDemo, { exerciseId, demoId: "Dumbbell_Bench_Press" });
    await asUser.mutation(api.exercises.setMuscle, { exerciseId, muscleGroup: "chest" });
    expect(await asUser.query(api.exercises.demoChoice, { exerciseId })).toEqual({ demoId: "Dumbbell_Bench_Press" });

    await asUser.mutation(api.exercises.setDemo, { exerciseId, demoId: NO_DEMO });
    expect(await asUser.query(api.exercises.demoChoice, { exerciseId })).toEqual({ demoId: "none" });
    await asUser.mutation(api.exercises.setDemo, { exerciseId, demoId: null });
    const stored = await t.run(async (ctx) => ctx.db.get("exercises", exerciseId));
    expect(stored).not.toHaveProperty("demoId");
    expect(stored?.muscleGroup).toBe("chest");
  });

  test("another person can't read or change it, and odd ids are refused", async () => {
    const t = convexTest(schema, modules);
    const owner = await signIn(t, "Michael");
    const other = await signIn(t, "Other");
    const exerciseId = await addExercise(t, owner.userId, "Squat");

    expect(await other.asUser.query(api.exercises.demoChoice, { exerciseId })).toBeNull();
    await expect(
      other.asUser.mutation(api.exercises.setDemo, { exerciseId, demoId: "Barbell_Squat" }),
    ).rejects.toThrow(/not found/i);
    await expect(
      owner.asUser.mutation(api.exercises.setDemo, { exerciseId, demoId: "../evil.jpg" }),
    ).rejects.toThrow(/catalogue/);
    await expect(
      owner.asUser.mutation(api.exercises.setDemo, { exerciseId, demoId: "" }),
    ).rejects.toThrow(/catalogue/);
  });

  test("a merge keeps the kept exercise's choice, or takes the merged one's", async () => {
    const t = convexTest(schema, modules);
    const { userId, asUser } = await signIn(t, "Michael");
    const fromId = await addExercise(t, userId, "DB bench");
    const intoId = await addExercise(t, userId, "Dumbbell bench press");
    await asUser.mutation(api.exercises.setDemo, { exerciseId: fromId, demoId: "Dumbbell_Bench_Press" });

    await asUser.mutation(api.exercises.merge, { fromId, intoId });
    expect(await asUser.query(api.exercises.demoChoice, { exerciseId: intoId })).toEqual({
      demoId: "Dumbbell_Bench_Press",
    });
  });
});
