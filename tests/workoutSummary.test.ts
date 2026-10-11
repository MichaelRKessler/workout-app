import assert from "node:assert/strict";
import test from "node:test";
import {
  ASSUMED_SET_MS,
  formatSummaryMinutes,
  summarizeSessions,
  summaryMinutes,
} from "../lib/workoutSummary.ts";

const MINUTE = 60_000;

test("strength gaps count 30 seconds of work and the rest as rest", () => {
  const summary = summarizeSessions([
    {
      startedAt: 0,
      completedAt: 10 * MINUTE,
      sets: [
        { exerciseId: "bench", reps: 5, weightLb: 135, loggedAt: 3 * MINUTE },
        { exerciseId: "bench", reps: 5, weightLb: 135, loggedAt: 6 * MINUTE },
        { exerciseId: "bench", reps: 5, weightLb: 135, loggedAt: 9 * MINUTE },
      ],
    },
  ]);
  assert.equal(summary.totalMs, 10 * MINUTE);
  assert.equal(summary.activeMs, 3 * ASSUMED_SET_MS);
  assert.equal(summary.restMs, 10 * MINUTE - 3 * ASSUMED_SET_MS);
  assert.equal(summary.exerciseCount, 1);
  assert.equal(summary.setCount, 3);
  assert.equal(summary.volumeLb, 3 * 5 * 135);
  assert.deepEqual(summaryMinutes(summary.totalMs ?? 0, summary.activeMs ?? 0), {
    total: 10,
    active: 2,
    rest: 8,
  });
});

test("timed sets use their duration, and warm-ups stay out of sets and volume", () => {
  const summary = summarizeSessions([
    {
      startedAt: 0,
      completedAt: 5 * MINUTE,
      sets: [
        {
          exerciseId: "bench",
          reps: 10,
          weightLb: 45,
          setType: "warmup",
          loggedAt: MINUTE,
        },
        {
          exerciseId: "plank",
          reps: null,
          weightLb: 0,
          durationSec: 60,
          loggedAt: 3 * MINUTE,
        },
        {
          exerciseId: "row",
          reps: null,
          weightLb: 0,
          distanceM: 2000,
          durationSec: 90,
          loggedAt: 5 * MINUTE,
        },
      ],
    },
  ]);
  assert.equal(summary.warmupCount, 1);
  assert.equal(summary.setCount, 2);
  assert.equal(summary.exerciseCount, 2);
  assert.equal(summary.volumeLb, 0);
  assert.equal(summary.distanceM, 2000);
  // The warm-up still takes the assumed 30 seconds of the clock.
  assert.equal(summary.activeMs, ASSUMED_SET_MS + 150_000);
  assert.equal(summary.restMs, 5 * MINUTE - ASSUMED_SET_MS - 150_000);
});

test("a past workout with no length omits the clock, and two sessions do not share a rest gap", () => {
  const summary = summarizeSessions([
    {
      startedAt: 1_000,
      completedAt: 1_000,
      sets: [{ exerciseId: "squat", reps: 5, weightLb: 200, loggedAt: 1_000 }],
    },
    {
      startedAt: 10 * MINUTE,
      completedAt: 12 * MINUTE,
      sets: [{ exerciseId: "squat", reps: 3, weightLb: 220, setType: "drop", loggedAt: 11 * MINUTE }],
    },
  ]);
  assert.equal(summary.totalMs, 2 * MINUTE);
  assert.equal(summary.activeMs, ASSUMED_SET_MS);
  assert.equal(summary.setCount, 2);
  assert.equal(summary.volumeLb, 5 * 200 + 3 * 220);
  assert.equal(formatSummaryMinutes(0), "0 min");
  assert.equal(formatSummaryMinutes(90), "1 h 30 min");
});