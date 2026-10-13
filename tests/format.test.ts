import assert from "node:assert/strict";
import test from "node:test";
import { formatWeightAmount, toPounds } from "../convex/lib/units.ts";
import {
  describeSet,
  formatDuration,
  formatElapsed,
  formatLastTime,
  formatPersonalRecord,
  formatPersonalRecords,
  formatRecordDetail,
  formatSetShort,
  formatVolumeLb,
  formatWorkoutLength,
  pluralize,
  streakLabel,
} from "../lib/format.ts";

test("set labels are compact in lists and spelled out for screen readers", () => {
  assert.equal(formatSetShort({ reps: 10, weightLb: 135 }), "10×135");
  assert.equal(formatSetShort({ reps: 8, weightLb: 52.5 }), "8×52.5");
  assert.equal(formatSetShort({ reps: 20, weightLb: 0 }), "20×BW");
  assert.equal(describeSet({ reps: 6, weightLb: 155 }), "6 reps at 155 lb");
  assert.equal(describeSet({ reps: 10, weightLb: 95, setType: "warmup" }), "10 reps at 95 lb, warm-up");
  assert.equal(describeSet({ reps: 8, weightLb: 100, setType: "drop" }), "8 reps at 100 lb, drop set");
  assert.equal(describeSet({ reps: 6, weightLb: 155, setType: "failure" }), "6 reps at 155 lb, to failure");
  assert.equal(describeSet({ reps: 1, weightLb: 0 }), "1 rep, bodyweight");
  assert.equal(formatSetShort({ reps: null, weightLb: 0, durationSec: 60 }), "1:00");
  assert.equal(describeSet({ reps: null, weightLb: 0, durationSec: 60 }), "1 minute, bodyweight");
  assert.equal(formatSetShort({ reps: null, weightLb: 0, distanceM: 2000 }), "2 km");
  assert.equal(
    formatSetShort({ reps: null, weightLb: 0, durationSec: 1800, distanceM: 19312, calories: 450 }),
    "12 mi in 30:00 · 450 cal",
  );
  assert.equal(
    describeSet({ reps: null, weightLb: 0, durationSec: 1800, distanceM: 19312, calories: 450 }),
    "12 miles in 30 minutes, 450 calories",
  );
  assert.equal(
    formatSetShort({ reps: 5, weightLb: 220.46, rpe: 8 }, "kg"),
    "5×100 RPE 8",
  );
  assert.equal(formatWeightAmount(toPounds(100, "kg"), "kg"), "100");
  assert.equal(formatWeightAmount(toPounds(2.5, "kg"), "kg"), "2.5");
});

test("last time summarizes the previous workout", () => {
  assert.equal(formatLastTime([]), null);
  assert.equal(
    formatLastTime([
      { reps: 10, weightLb: 135 },
      { reps: 10, weightLb: 135 },
      { reps: 10, weightLb: 135 },
    ]),
    "Last time: 3×10 @ 135",
  );
  assert.equal(
    formatLastTime([
      { reps: 10, weightLb: 45, setType: "warmup" },
      { reps: 5, weightLb: 135, setType: "working" },
    ]),
    "Last time: 1×5 @ 135",
  );
  assert.equal(formatLastTime([{ reps: 10, weightLb: 45, setType: "warmup" }]), null);
  assert.equal(
    formatLastTime([
      { reps: 20, weightLb: 0 },
      { reps: 20, weightLb: 0 },
    ]),
    "Last time: 2×20 bodyweight",
  );
  assert.equal(
    formatLastTime([
      { reps: 10, weightLb: 135 },
      { reps: 8, weightLb: 145.5 },
    ]),
    "Last time: 10×135, 8×145.5",
  );
});

test("the workout clock reads like a stopwatch", () => {
  assert.equal(formatElapsed(0), "0:00");
  assert.equal(formatElapsed(-5000), "0:00");
  assert.equal(formatElapsed(65_400), "1:05");
  assert.equal(formatElapsed(32 * 60_000 + 14_000), "32:14");
  assert.equal(formatElapsed(3_725_000), "1:02:05");
});

test("workout length rounds to minutes", () => {
  assert.equal(formatDuration(20_000), "1 min");
  assert.equal(formatDuration(52 * 60_000), "52 min");
  assert.equal(formatDuration(60 * 60_000), "1 h");
  assert.equal(formatDuration(65 * 60_000), "1 h 5 min");
});

test("counts pick the right noun", () => {
  assert.equal(pluralize(1, "set"), "1 set");
  assert.equal(pluralize(12, "set"), "12 sets");
  assert.equal(pluralize(2, "exercise"), "2 exercises");
});

test("a past workout with no recorded length hides the duration", () => {
  assert.equal(formatWorkoutLength(1_000, 1_000), null);
  assert.equal(formatWorkoutLength(2_000, 1_000), null);
  assert.equal(formatWorkoutLength(0, 52 * 60_000), "52 min");
});

test("volume, streaks, and personal records have stable labels", () => {
  assert.equal(formatVolumeLb(0), "0 lb");
  assert.equal(formatVolumeLb(9420.4), "9,420 lb");
  assert.equal(formatVolumeLb(220.46 * 5, "kg"), "500 kg");
  assert.equal(streakLabel(0), "No streak yet");
  assert.equal(streakLabel(1), "1-week streak");
  assert.equal(streakLabel(4), "4-week streak");
  assert.equal(
    formatPersonalRecord({
      exerciseName: "bench press",
      kind: "both",
      reps: 5,
      weightLb: 225,
      epleyLb: 262.5,
    }),
    "New PR · bench press · 225 lb · est. 1RM 262.5 lb",
  );
  assert.equal(
    formatPersonalRecord({
      exerciseName: "push-ups",
      kind: "reps",
      reps: 20,
      weightLb: 0,
      epleyLb: null,
    }),
    "New PR · push-ups · 20 reps",
  );
  assert.equal(
    formatPersonalRecord({
      exerciseName: "plank",
      kind: "duration",
      reps: null,
      weightLb: 0,
      epleyLb: null,
      durationSec: 90,
    }),
    "New PR · plank · 1:30",
  );
  assert.equal(
    formatPersonalRecord({
      exerciseName: "row",
      kind: "distance",
      reps: null,
      weightLb: 0,
      epleyLb: null,
      distanceM: 2000,
      durationSec: 480,
    }),
    "New PR · row · 2 km in 8:00",
  );
  assert.equal(
    formatPersonalRecord({
      exerciseName: "bike",
      kind: "calories",
      reps: null,
      weightLb: 0,
      epleyLb: null,
      calories: 450,
    }),
    "New PR · bike · 450 cal",
  );
  assert.equal(
    formatPersonalRecords([
      {
        exerciseName: "bike",
        kind: "distance",
        reps: null,
        weightLb: 0,
        epleyLb: null,
        distanceM: 19312,
      },
      {
        exerciseName: "bike",
        kind: "calories",
        reps: null,
        weightLb: 0,
        epleyLb: null,
        calories: 450,
      },
    ]),
    "New PRs · bike",
  );
});

test("record detail drops the New PR lead-in for lists under a records heading", () => {
  assert.equal(
    formatRecordDetail({
      exerciseName: "row",
      kind: "distance",
      reps: null,
      weightLb: 0,
      epleyLb: null,
      distanceM: 5050,
      durationSec: 1200,
    }),
    "row · 5.05 km in 20:00",
  );
});
