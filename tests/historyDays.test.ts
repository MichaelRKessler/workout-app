import assert from "node:assert/strict";
import test from "node:test";
import {
  calendarDayBounds,
  calendarDayKey,
  canonicalExerciseIds,
  civilMonth,
  formatHistoryDayMeta,
  groupHistoryDays,
  groupPerformedSets,
  markedDayKeys,
  monthCells,
  monthWindow,
  shiftMonth,
  visibleHistoryDays,
  weekdayIndex,
  type HistorySession,
} from "../lib/historyDays.ts";
import type { SetLine } from "../lib/groupSets.ts";

const HOUR = 60 * 60 * 1000;
const LA = "America/Los_Angeles";
const AUCKLAND = "Pacific/Auckland";

function session(overrides: Partial<HistorySession> & Pick<HistorySession, "id" | "startedAt">): HistorySession {
  return {
    completedAt: overrides.startedAt,
    volumeLb: 0,
    exercises: [],
    ...overrides,
  };
}

function line(overrides: Partial<SetLine> & Pick<SetLine, "_id" | "exerciseId" | "loggedAt">): SetLine {
  return {
    exerciseName: "Exercise",
    reps: 5,
    weightLb: 100,
    durationSec: null,
    distanceM: null,
    rpe: null,
    ...overrides,
  };
}

test("a calendar day follows the requested time zone, including midnight", () => {
  const justBeforeLaMidnight = Date.parse("2026-10-11T06:59:00.000Z");
  const justAfterLaMidnight = Date.parse("2026-10-11T07:01:00.000Z");
  assert.equal(calendarDayKey(justBeforeLaMidnight, "UTC"), "2026-10-11");
  assert.equal(calendarDayKey(justBeforeLaMidnight, LA), "2026-10-10");
  assert.equal(calendarDayKey(justAfterLaMidnight, LA), "2026-10-11");

  const bounds = calendarDayBounds("2026-10-11", LA);
  assert.ok(bounds);
  assert.equal(bounds.end - bounds.start, 24 * HOUR);
  assert.equal(calendarDayKey(bounds.start, LA), "2026-10-11");
  assert.equal(calendarDayKey(bounds.start - 1, LA), "2026-10-10");
  assert.equal(calendarDayKey(bounds.end - 1, LA), "2026-10-11");
  assert.equal(calendarDayKey(bounds.end, LA), "2026-10-12");

  assert.equal(calendarDayKey(Date.UTC(2026, 9, 11, 0, 0, 0), "UTC"), "2026-10-11");
  assert.equal(calendarDayKey(Date.UTC(2026, 9, 10, 23, 59, 59), "UTC"), "2026-10-10");
});

test("Auckland keeps an evening UTC workout on the next local date", () => {
  const lateUtc = Date.parse("2026-10-10T10:30:00.000Z");
  const nextUtcHour = Date.parse("2026-10-10T11:30:00.000Z");
  assert.equal(calendarDayKey(lateUtc, "UTC"), "2026-10-10");
  assert.equal(calendarDayKey(nextUtcHour, "UTC"), "2026-10-10");
  assert.equal(calendarDayKey(lateUtc, AUCKLAND), "2026-10-10");
  assert.equal(calendarDayKey(nextUtcHour, AUCKLAND), "2026-10-11");

  const bounds = calendarDayBounds("2026-10-11", AUCKLAND);
  assert.ok(bounds);
  assert.equal(calendarDayKey(bounds.start, AUCKLAND), "2026-10-11");
  assert.equal(calendarDayKey(bounds.end - 1, AUCKLAND), "2026-10-11");
  assert.equal(calendarDayKey(bounds.end, AUCKLAND), "2026-10-12");
});

test("daylight-saving midnights stay inside the short and long local days", () => {
  const spring = calendarDayBounds("2026-03-08", LA);
  const fall = calendarDayBounds("2026-11-01", LA);
  assert.ok(spring);
  assert.ok(fall);
  assert.equal(spring.end - spring.start, 23 * HOUR);
  assert.equal(fall.end - fall.start, 25 * HOUR);
  assert.equal(calendarDayKey(spring.end - 1, LA), "2026-03-08");
  assert.equal(calendarDayKey(spring.end, LA), "2026-03-09");
  assert.equal(calendarDayKey(fall.end - 1, LA), "2026-11-01");
  assert.equal(calendarDayKey(fall.end, LA), "2026-11-02");
  assert.equal(calendarDayBounds("2026-02-31", LA), null);
  assert.equal(calendarDayBounds("2026-10-11T00:00", LA), null);
});

test("sessions on one local day combine in the order exercises were first performed", () => {
  const monday = calendarDayBounds("2026-10-12", LA);
  assert.ok(monday);
  const morning = monday.start + 8 * HOUR;
  const evening = monday.start + 18 * HOUR;
  const days = groupHistoryDays(
    [
      session({
        id: "evening",
        startedAt: evening,
        completedAt: evening + 40 * 60 * 1000,
        volumeLb: 500.1,
        exercises: [
          { exerciseId: "bench", name: "bench press", setCount: 2 },
          { exerciseId: "row", name: "row", setCount: 3 },
        ],
      }),
      session({
        id: "other-day",
        startedAt: monday.start - HOUR,
        completedAt: monday.start - 30 * 60 * 1000,
        volumeLb: 100,
        exercises: [{ exerciseId: "run", name: "run", setCount: 1 }],
      }),
      session({
        id: "morning",
        startedAt: morning,
        completedAt: morning + 50 * 60 * 1000,
        volumeLb: 1000.14,
        exercises: [
          { exerciseId: "squat", name: "squat", setCount: 3 },
          { exerciseId: "bench", name: "bench press", setCount: 1 },
        ],
      }),
      session({
        id: "live",
        status: "open",
        startedAt: morning + HOUR,
        completedAt: morning + HOUR,
        volumeLb: 9999,
        exercises: [{ exerciseId: "squat", name: "squat", setCount: 8 }],
      }),
    ],
    LA,
  );

  assert.deepEqual(
    days.map((day) => day.dayKey),
    ["2026-10-12", "2026-10-11"],
  );
  const combined = days[0];
  assert.ok(combined);
  assert.deepEqual(combined.sessionIds, ["morning", "evening"]);
  assert.equal(combined.workoutCount, 2);
  assert.equal(combined.setCount, 9);
  assert.equal(combined.volumeLb, 1500.24);
  assert.equal(combined.durationMs, 90 * 60 * 1000);
  assert.deepEqual(
    combined.exercises.map((exercise) => [exercise.exerciseId, exercise.setCount]),
    [
      ["squat", 3],
      ["bench", 3],
      ["row", 3],
    ],
  );
  assert.equal(
    formatHistoryDayMeta(combined, "lb"),
    "2 workouts · 3 exercises · 9 sets · 1,500 lb · 1 h 30 min",
  );
  assert.match(formatHistoryDayMeta(combined, "kg"), /680 kg/);
  assert.equal(days[1]?.workoutCount, 1);
  assert.equal(formatHistoryDayMeta(days[1]!, "lb").startsWith("1 exercise"), true);
});

test("a workout belongs to the day it started, even when it ends after midnight", () => {
  const start = Date.parse("2026-10-10T06:00:00.000Z");
  const days = groupHistoryDays(
    [
      session({
        id: "late",
        startedAt: start,
        completedAt: start + 3 * HOUR,
        volumeLb: 0,
        exercises: [{ exerciseId: "squat", name: "squat", setCount: 1 }],
      }),
    ],
    LA,
  );
  assert.equal(calendarDayKey(start, LA), "2026-10-09");
  assert.equal(calendarDayKey(start + 3 * HOUR, LA), "2026-10-10");
  assert.equal(days[0]?.dayKey, "2026-10-09");
  assert.equal(days[0]?.durationMs, 3 * HOUR);
});

test("a past workout with no recorded length does not add time", () => {
  const at = Date.parse("2026-10-11T18:00:00.000Z");
  const days = groupHistoryDays(
    [
      session({
        id: "past",
        startedAt: at,
        completedAt: at,
        exercises: [{ exerciseId: "push", name: "push-ups", setCount: 1 }],
      }),
    ],
    "UTC",
  );
  assert.equal(days[0]?.durationMs, 0);
  assert.equal(formatHistoryDayMeta(days[0]!, "lb").includes("min"), false);
});

test("the oldest loaded day stays hidden while another page may still extend it", () => {
  const tz = "UTC";
  const sessions = ["2026-10-11", "2026-10-10", "2026-10-09"].flatMap((day, index) => {
    const bounds = calendarDayBounds(day, tz);
    assert.ok(bounds);
    return [
      session({
        id: `${day}-a`,
        startedAt: bounds.start + HOUR,
        exercises: [{ exerciseId: `ex-${index}`, name: "lift", setCount: 1 }],
      }),
      session({
        id: `${day}-b`,
        startedAt: bounds.start + 2 * HOUR,
        exercises: [{ exerciseId: `ex-${index}`, name: "lift", setCount: 1 }],
      }),
    ];
  });

  const partial = visibleHistoryDays(sessions, true, tz);
  assert.deepEqual(
    partial.map((day) => day.dayKey),
    ["2026-10-11", "2026-10-10"],
  );
  assert.equal(partial[0]?.workoutCount, 2);

  const done = visibleHistoryDays(sessions, false, tz);
  assert.deepEqual(
    done.map((day) => day.dayKey),
    ["2026-10-11", "2026-10-10", "2026-10-09"],
  );

  const only = visibleHistoryDays(sessions.filter((item) => item.id.startsWith("2026-10-11")), true, tz);
  assert.deepEqual(
    only.map((day) => day.dayKey),
    ["2026-10-11"],
  );
});

test("sets from both workouts group by the first time that exercise was performed", () => {
  const groups = groupPerformedSets([
    line({ _id: "e-row", exerciseId: "row", exerciseName: "row", loggedAt: 400 }),
    line({ _id: "m-bench", exerciseId: "bench", exerciseName: "bench press", loggedAt: 200, reps: 8 }),
    line({ _id: "e-bench", exerciseId: "bench", exerciseName: "bench press", loggedAt: 300, reps: 6 }),
    line({ _id: "m-squat", exerciseId: "squat", exerciseName: "squat", loggedAt: 100 }),
    line({
      _id: "pending-bench",
      exerciseId: "local:bench-press",
      exerciseName: "Bench Press",
      loggedAt: 500,
      pending: true,
    }),
  ]);
  assert.deepEqual(
    groups.map((group) => [group.exerciseId, group.sets.map((set) => set._id)]),
    [
      ["squat", ["m-squat"]],
      ["bench", ["m-bench", "e-bench"]],
      ["row", ["e-row"]],
      ["local:bench-press", ["pending-bench"]],
    ],
  );

  const unified = groupPerformedSets(
    canonicalExerciseIds([
      line({ _id: "saved", exerciseId: "bench", exerciseName: "bench press", loggedAt: 200 }),
      line({
        _id: "pending",
        exerciseId: "local:bench-press",
        exerciseName: "Bench Press",
        loggedAt: 500,
      }),
    ]),
  );
  assert.equal(unified.length, 1);
  assert.equal(unified[0]?.exerciseId, "bench");
  assert.deepEqual(
    unified[0]?.sets.map((set) => set._id),
    ["saved", "pending"],
  );
});

test("a month grid is Sunday-first and a window is the local month", () => {
  const cells = monthCells(2026, 10, "UTC");
  assert.ok(cells);
  const inMonth = cells.filter((cell) => cell.inMonth);
  assert.equal(inMonth.length, 31);
  assert.equal(inMonth[0]?.dayKey, "2026-10-01");
  assert.equal(inMonth[30]?.dayKey, "2026-10-31");
  assert.equal(cells.length % 7, 0);
  assert.equal(weekdayIndex(Date.parse("2026-10-11T12:00:00.000Z"), "UTC"), 0);

  const october = monthWindow(2026, 10, "UTC");
  assert.ok(october);
  assert.equal(october.end - october.start, 31 * 24 * HOUR);
  assert.equal(calendarDayKey(october.start, "UTC"), "2026-10-01");
  assert.equal(calendarDayKey(october.end, "UTC"), "2026-11-01");

  const march = monthWindow(2026, 3, LA);
  assert.ok(march);
  assert.equal(march.end - march.start, 31 * 24 * HOUR - HOUR);

  assert.deepEqual(shiftMonth(2026, 12, 1), { year: 2027, month: 1 });
  assert.deepEqual(shiftMonth(2026, 1, -1), { year: 2025, month: 12 });
  assert.deepEqual(civilMonth(Date.parse("2026-10-11T06:30:00.000Z"), LA), {
    year: 2026,
    month: 10,
  });
  assert.deepEqual(civilMonth(Date.parse("2026-10-01T06:30:00.000Z"), LA), {
    year: 2026,
    month: 9,
  });

  const marks = markedDayKeys(
    [Date.parse("2026-10-11T15:00:00.000Z"), Date.parse("2026-10-11T23:00:00.000Z")],
    "UTC",
  );
  assert.equal(marks.get("2026-10-11"), 2);
  assert.equal(markedDayKeys([Date.parse("2026-10-11T06:30:00.000Z")], LA).get("2026-10-10"), 1);
});
