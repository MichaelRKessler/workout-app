import assert from "node:assert/strict";
import test from "node:test";
import {
  describeSet,
  formatDuration,
  formatElapsed,
  formatLastTime,
  formatSetShort,
  pluralize,
} from "../lib/format.ts";

test("set labels are compact in lists and spelled out for screen readers", () => {
  assert.equal(formatSetShort({ reps: 10, weightLb: 135 }), "10×135");
  assert.equal(formatSetShort({ reps: 8, weightLb: 52.5 }), "8×52.5");
  assert.equal(formatSetShort({ reps: 20, weightLb: 0 }), "20×BW");
  assert.equal(describeSet({ reps: 6, weightLb: 155 }), "6 reps at 155 lb");
  assert.equal(describeSet({ reps: 1, weightLb: 0 }), "1 rep, bodyweight");
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
