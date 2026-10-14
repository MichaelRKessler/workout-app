// One-off: replace Mike's workout history with the log he sent on 2026-10-14.
// Not for main. Deploy, run in order, then redeploy main without this file:
//   historyImport:backupMeta / backupSets   save the JSON first
//   historyImport:wipe (repeat until done)  deletes every workout and set
//   historyImport:load                      inserts the log below
//   historyImport:summary                   counts to check against the log
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";
import { recordRemovedSets, requestRebuild } from "./lib/exerciseStats";

const EMAIL = "michaelr.kessler@gmail.com";
const TAG = "history-import-";
const MINUTE = 60 * 1000;
// Eastern daylight time covers every date in the log.
const UTC_OFFSET_HOURS = 4;
const START_HOUR = 7;

type Kind = "timed" | "reps";

// Existing exercises are reused when any of these names match; otherwise the first is created.
const EXERCISES: Array<{ key: string; names: string[]; kind: Kind }> = [
  { key: "hang", names: ["Dead hang", "Dead hangs", "Deadhang", "Hang", "Hanging", "Hanging time", "Bar hang"], kind: "timed" },
  { key: "chin", names: ["Chin-up", "Chin-ups", "Chin up", "Chin ups", "Chinup", "Chinups"], kind: "reps" },
  { key: "dips", names: ["Dips", "Dip", "Tricep dip", "Tricep dips", "Chest dip", "Chest dips"], kind: "reps" },
  { key: "situps", names: ["Sit-ups", "Sit-up", "Sit ups", "Sit up", "Situps", "Situp"], kind: "reps" },
];

// Date -> exercise -> values. Hang values are seconds, the rest are reps.
const LOG: Array<{ date: string; entries: Partial<Record<string, number[]>> }> = [
  { date: "2026-06-16", entries: { hang: [30, 38, 15], situps: [20] } },
  { date: "2026-06-17", entries: { hang: [43, 34, 23], situps: [20] } },
  { date: "2026-06-22", entries: { hang: [45, 29, 16], situps: [20, 20, 20] } },
  { date: "2026-06-25", entries: { hang: [51, 40, 30], situps: [20, 20, 20] } },
  { date: "2026-08-30", entries: { hang: [44, 30, 32], dips: [2], situps: [30, 20, 20] } },
  { date: "2026-09-07", entries: { hang: [49, 43, 33], dips: [4, 4], situps: [30, 30, 30] } },
  { date: "2026-09-20", entries: { hang: [20, 30, 10], chin: [1], dips: [5, 5, 3], situps: [30, 30] } },
  { date: "2026-09-25", entries: { chin: [2, 1, 1], dips: [5, 5, 4], situps: [30, 30] } },
  { date: "2026-10-02", entries: { chin: [3.5, 2.5, 2], dips: [6, 5, 6], situps: [30, 30, 30] } },
  { date: "2026-10-09", entries: { chin: [3, 1, 2], dips: [5, 5, 3], situps: [30, 30, 30] } },
];

async function findUser(ctx: QueryCtx, email: string): Promise<Id<"users">> {
  if (email !== EMAIL) {
    throw new Error(`historyImport only runs for ${EMAIL}`);
  }
  const users = await ctx.db
    .query("users")
    .withIndex("email", (q) => q.eq("email", email))
    .take(2);
  if (users.length !== 1) {
    throw new Error(`Expected one user for ${email}, found ${users.length}`);
  }
  return users[0]._id;
}

export const backupMeta = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const userId = await findUser(ctx, args.email);
    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_user_status_and_started", (q) => q.eq("userId", userId))
      .collect();
    const exercises = await ctx.db
      .query("exercises")
      .withIndex("by_user_and_normalized_name", (q) => q.eq("userId", userId))
      .collect();
    const routines = await ctx.db
      .query("routines")
      .withIndex("by_user_and_sort", (q) => q.eq("userId", userId))
      .collect();
    const bodyEntries = await ctx.db
      .query("bodyEntries")
      .withIndex("by_user_and_logged", (q) => q.eq("userId", userId))
      .collect();
    return { userId, exportedAt: Date.now(), sessions, exercises, routines, bodyEntries };
  },
});

export const backupSets = internalQuery({
  args: { email: v.string(), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const userId = await findUser(ctx, args.email);
    return await ctx.db
      .query("sets")
      .withIndex("by_user_and_logged", (q) => q.eq("userId", userId))
      .paginate(args.paginationOpts);
  },
});

// Deletes whole workouts, a page at a time. Run again until done is true.
export const wipe = internalMutation({
  args: { email: v.string() },
  returns: v.object({ sessions: v.number(), sets: v.number(), done: v.boolean() }),
  handler: async (ctx, args) => {
    const userId = await findUser(ctx, args.email);
    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_user_status_and_started", (q) => q.eq("userId", userId))
      .take(50);
    let sets = 0;
    for (const session of sessions) {
      const sessionSets = await ctx.db
        .query("sets")
        .withIndex("by_session_and_exercise", (q) => q.eq("sessionId", session._id))
        .collect();
      for (const set of sessionSets) {
        await ctx.db.delete("sets", set._id);
      }
      await ctx.db.delete("sessions", session._id);
      await recordRemovedSets(ctx, userId, sessionSets);
      sets += sessionSets.length;
    }
    if (sessions.length === 0) {
      // Any set left without a workout goes too.
      const strays = await ctx.db
        .query("sets")
        .withIndex("by_user_and_logged", (q) => q.eq("userId", userId))
        .take(500);
      for (const set of strays) {
        await ctx.db.delete("sets", set._id);
      }
      await recordRemovedSets(ctx, userId, strays);
      return { sessions: 0, sets: strays.length, done: strays.length === 0 };
    }
    return { sessions: sessions.length, sets, done: false };
  },
});

async function exerciseFor(
  ctx: MutationCtx,
  userId: Id<"users">,
  names: string[],
  createdAt: number,
): Promise<{ id: Id<"exercises">; name: string; created: boolean }> {
  for (const name of names) {
    const found = await ctx.db
      .query("exercises")
      .withIndex("by_user_and_normalized_name", (q) =>
        q.eq("userId", userId).eq("normalizedName", name.toLocaleLowerCase()),
      )
      .first();
    if (found) {
      return { id: found._id, name: found.name, created: false };
    }
  }
  const id = await ctx.db.insert("exercises", {
    userId,
    name: names[0],
    normalizedName: names[0].toLocaleLowerCase(),
    createdAt,
  });
  return { id, name: names[0], created: true };
}

export const load = internalMutation({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const userId = await findUser(ctx, args.email);
    const existing = await ctx.db
      .query("sessions")
      .withIndex("by_user_status_and_started", (q) => q.eq("userId", userId))
      .take(1);
    if (existing.length > 0) {
      throw new Error("This account still has workouts. Run wipe until done first.");
    }

    const dayStart = (date: string) => {
      const [y, m, d] = date.split("-").map(Number);
      return Date.UTC(y, m - 1, d, START_HOUR + UTC_OFFSET_HOURS);
    };

    const exercises = new Map<string, { id: Id<"exercises">; name: string; created: boolean; kind: Kind }>();
    for (const spec of EXERCISES) {
      const found = await exerciseFor(ctx, userId, spec.names, dayStart(LOG[0].date) - MINUTE);
      exercises.set(spec.key, { ...found, kind: spec.kind });
    }

    let sessionCount = 0;
    let setCount = 0;
    for (const day of LOG) {
      const startedAt = dayStart(day.date);
      const sessionId = await ctx.db.insert("sessions", {
        userId,
        status: "completed",
        startedAt,
        completedAt: startedAt,
        clientId: `${TAG}session-${day.date}`,
        setCount: 0,
      });
      sessionCount++;
      let clock = startedAt + 2 * MINUTE;
      let index = 0;
      let lastSetAt = startedAt;
      for (const spec of EXERCISES) {
        const values = day.entries[spec.key];
        if (!values) {
          continue;
        }
        const exercise = exercises.get(spec.key)!;
        for (const value of values) {
          await ctx.db.insert("sets", {
            userId,
            sessionId,
            exerciseId: exercise.id,
            weightLb: 0,
            ...(exercise.kind === "timed" ? { durationSec: value } : { reps: value }),
            loggedAt: clock,
            clientId: `${TAG}set-${day.date}-${index}`,
          });
          lastSetAt = clock;
          clock += 2 * MINUTE;
          index++;
          setCount++;
        }
      }
      await ctx.db.patch("sessions", sessionId, {
        completedAt: lastSetAt + 2 * MINUTE,
        setCount: index,
        lastSetAt,
      });
    }

    // Rebuild every exercise the person has, so records from the deleted history go too.
    const all = await ctx.db
      .query("exercises")
      .withIndex("by_user_and_normalized_name", (q) => q.eq("userId", userId))
      .collect();
    for (const exercise of all) {
      await requestRebuild(ctx, userId, exercise._id);
    }

    return {
      sessions: sessionCount,
      sets: setCount,
      exercises: [...exercises.values()].map(({ name, created, kind }) => ({ name, created, kind })),
    };
  },
});

export const summary = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const userId = await findUser(ctx, args.email);
    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_user_status_and_started", (q) => q.eq("userId", userId))
      .collect();
    const sets = await ctx.db
      .query("sets")
      .withIndex("by_user_and_logged", (q) => q.eq("userId", userId))
      .collect();
    const names = new Map<string, string>();
    for (const set of sets) {
      if (!names.has(set.exerciseId)) {
        names.set(set.exerciseId, (await ctx.db.get("exercises", set.exerciseId))?.name ?? "?");
      }
    }
    const byDay: Record<string, Record<string, number[]>> = {};
    for (const set of sets) {
      const day = new Date(set.loggedAt - UTC_OFFSET_HOURS * 60 * MINUTE).toISOString().slice(0, 10);
      const name = names.get(set.exerciseId)!;
      ((byDay[day] ??= {})[name] ??= []).push(set.durationSec ?? set.reps ?? 0);
    }
    const stats = [];
    for (const exerciseId of names.keys()) {
      const row = await ctx.db
        .query("exerciseStats")
        .withIndex("by_user_and_exercise", (q) => q.eq("userId", userId).eq("exerciseId", exerciseId as Id<"exercises">))
        .first();
      stats.push({ name: names.get(exerciseId), ready: row?.ready, setCount: row?.setCount });
    }
    return { sessions: sessions.length, sets: sets.length, byDay, stats };
  },
});
