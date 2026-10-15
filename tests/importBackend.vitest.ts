/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");
const DAY = 24 * 60 * 60 * 1000;

async function signIn(t: ReturnType<typeof convexTest>, name: string) {
  const email = `${name.toLowerCase()}@example.com`;
  const userId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("users", { name, email });
    await ctx.db.insert("allowedEmails", { email, createdAt: Date.now() });
    return id;
  });
  return t.withIdentity({ subject: `${userId}|${name}-session` });
}

describe("import duplicate check", () => {
  test("lists that day's exercises by spelling key and its body entries, for this person only", async () => {
    const t = convexTest(schema, modules);
    const asUser = await signIn(t, "Mike");
    const other = await signIn(t, "Other");
    const dayStart = Math.floor((Date.now() - 10 * DAY) / DAY) * DAY;
    await asUser.mutation(api.sessions.logPast, {
      startedAt: dayStart + 3 * 60 * 60 * 1000,
      exercises: [
        { name: "Sit-ups", sets: [{ reps: 20, setType: "warmup" }] },
        { name: "Chin up", sets: [{ reps: 8 }] },
      ],
    });
    await other.mutation(api.sessions.logPast, {
      startedAt: dayStart + 60 * 60 * 1000,
      exercises: [{ name: "Deadlift", sets: [{ reps: 5, weightLb: 315 }] }],
    });
    await asUser.mutation(api.body.save, { loggedAt: dayStart + 1000, weightLb: 232, waistCm: 86 });

    const [day, empty] = await asUser.query(api.imports.existingDays, {
      days: [
        { key: "a", start: dayStart, end: dayStart + DAY },
        { key: "b", start: dayStart + DAY, end: dayStart + 2 * DAY },
      ],
    });
    expect(day?.key).toBe("a");
    expect(day?.exerciseKeys.sort()).toEqual(["chinup", "situp"]);
    expect(day?.body).toEqual([
      { weightLb: 232, bodyFatPct: null, waistCm: 86, chestCm: null, armCm: null, hipsCm: null, thighCm: null },
    ]);
    expect(empty).toEqual({ key: "b", exerciseKeys: [], body: [] });

    const sets = await t.run(async (ctx) => await ctx.db.query("sets").collect());
    expect(sets.find((row) => row.reps === 20)?.setType).toBe("warmup");

    await expect(
      asUser.query(api.imports.existingDays, { days: [{ key: "x", start: dayStart, end: dayStart + 3 * DAY }] }),
    ).rejects.toThrow("Pick a single day");
  });
});
