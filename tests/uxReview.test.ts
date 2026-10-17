import assert from "node:assert/strict";
import test from "node:test";
import { pickNextRoutine } from "../convex/lib/nextRoutine.ts";
import { formatDayTitle, formatRecordDetail } from "../lib/format.ts";
import { formatHistoryDayMeta } from "../lib/historyDays.ts";
import { planLeftNote } from "../lib/workoutPlan.ts";
import { formatBodySummary, weightHint } from "../lib/bodyDraft.ts";

test("the next routine follows the last one used and wraps around", () => {
  assert.equal(pickNextRoutine([], null), null);
  assert.equal(pickNextRoutine(["push", "pull", "legs"], null), "push");
  assert.equal(pickNextRoutine(["push", "pull", "legs"], "push"), "pull");
  assert.equal(pickNextRoutine(["push", "pull", "legs"], "legs"), "push");
  assert.equal(pickNextRoutine(["push", "pull", "legs"], "deleted"), "push");
  assert.equal(pickNextRoutine(["solo"], "solo"), "solo");
});

test("finishing early names what is left of the plan", () => {
  assert.equal(planLeftNote(undefined), null);
  assert.equal(
    planLeftNote([
      { sets: [1], targetSets: 3 },
      { sets: [], targetSets: 3 },
      { sets: [], targetSets: 3, skipped: true },
      { sets: [], targetSets: null },
    ]),
    "2 planned exercises not started · 6 planned sets left",
  );
  assert.equal(planLeftNote([{ sets: [1, 2, 3], targetSets: 3 }]), null);
});

test("a day title fits one line and adds the year only for other years", () => {
  const now = new Date(2026, 9, 15).getTime();
  assert.doesNotMatch(formatDayTitle(new Date(2026, 9, 13).getTime(), now), /2026/);
  assert.match(formatDayTitle(new Date(2025, 9, 13).getTime(), now), /2025/);
});

test("an estimated max is shown in whole units", () => {
  const detail = formatRecordDetail(
    { exerciseName: "bench", kind: "both", reps: 8, weightLb: 185, epleyLb: 234.33 },
    "lb",
  );
  assert.equal(detail, "bench · 185 lb · est. 1RM 234 lb");
});

test("Home's workout line can leave out the volume", () => {
  const day = { workoutCount: 1, exercises: [{}, {}] as never[], setCount: 9, volumeLb: 7710, durationMs: 25 * 60_000 };
  assert.equal(formatHistoryDayMeta(day, "lb"), "2 exercises · 9 sets · 7,710 lb · 25 min");
  assert.equal(formatHistoryDayMeta(day, "lb", { volume: false }), "2 exercises · 9 sets · 25 min");
});

test("body lengths read to a tenth and the weight hint is the last weight", () => {
  const summary = formatBodySummary(
    { weightLb: null, bodyFatPct: null, waistCm: 87.4, chestCm: null, armCm: null, hipsCm: null, thighCm: null },
    "lb",
    "in",
  );
  assert.equal(summary, "waist 34.4 in");
  assert.equal(
    formatBodySummary(
      { weightLb: 184, bodyFatPct: null, waistCm: null, chestCm: null, armCm: null, hipsCm: null, thighCm: null },
      "lb",
      "in",
    ),
    "184.0 lb",
  );
  assert.equal(weightHint(183.2, "lb"), "183.2");
  assert.equal(weightHint(null, "lb"), undefined);
});
