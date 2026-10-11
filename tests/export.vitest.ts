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
  options?: { allow?: boolean },
) {
  const email = `${name.toLowerCase().replace(/[^a-z0-9]+/g, ".")}.export@example.com`;
  const userId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("users", { name, email });
    if (options?.allow !== false) {
      await ctx.db.insert("allowedEmails", { email, createdAt: Date.now() });
    }
    return id;
  });
  return { userId, asUser: t.withIdentity({ subject: `${userId}|${name}-session` }) };
}

describe("spreadsheet export", () => {
  test("is owner scoped, allow-listed, and paginated", async () => {
    const t = testBackend();
    await expect(
      t.query(api.exportData.sets, { paginationOpts: { numItems: 10, cursor: null } }),
    ).rejects.toThrow("Not authenticated");

    const blocked = await signIn(t, "Blocked", { allow: false });
    await expect(
      blocked.asUser.query(api.exportData.sets, {
        paginationOpts: { numItems: 10, cursor: null },
      }),
    ).rejects.toThrow("don't have access");

    const owner = await signIn(t, "Michael");
    const other = await signIn(t, "Other");
    const sessionId = await owner.asUser.mutation(api.sessions.start, {});
    await owner.asUser.mutation(api.sets.log, {
      sessionId,
      exerciseName: "Curl",
      reps: 12,
      weightLb: 30,
    });
    await owner.asUser.mutation(api.sets.log, {
      sessionId,
      exerciseName: "Curl",
      reps: 10,
      weightLb: 35,
    });
    const otherSession = await other.asUser.mutation(api.sessions.start, {});
    await other.asUser.mutation(api.sets.log, {
      sessionId: otherSession,
      exerciseName: "Squat",
      reps: 5,
      weightLb: 200,
    });

    const first = await owner.asUser.query(api.exportData.sets, {
      paginationOpts: { numItems: 1, cursor: null },
    });
    expect(first.page).toHaveLength(1);
    expect(first.page[0]?.exercise).toBe("Curl");
    expect(first.page[0]?.weightLb).toBe(30);
    expect(first.isDone).toBe(false);

    const second = await owner.asUser.query(api.exportData.sets, {
      paginationOpts: { numItems: 10, cursor: first.continueCursor },
    });
    expect(second.page.map((row) => row.exercise)).toEqual(["Curl"]);
    expect(second.page.some((row) => row.exercise === "Squat")).toBe(false);
    expect(second.isDone).toBe(true);

    const theirs = await other.asUser.query(api.exportData.sets, {
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(theirs.page.map((row) => row.exercise)).toEqual(["Squat"]);
  });
});
