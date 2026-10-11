import assert from "node:assert/strict";
import test from "node:test";
import {
  STALE_CLOSE_MS,
  STALE_END_MARGIN_MS,
  STALE_PROMPT_MS,
  abandonedCompletedAt,
  plannedCompletedAt,
  shouldCloseAbandoned,
  workoutLooksStale,
} from "../convex/lib/sessionTiming.ts";

const startedAt = 1_000_000;
const lastSetAt = startedAt + 30 * 60 * 1000;

test("a workout looks stale four hours after the last set, unless the user kept going", () => {
  const justBefore = lastSetAt + STALE_PROMPT_MS - 1;
  const atThreshold = lastSetAt + STALE_PROMPT_MS;
  assert.equal(workoutLooksStale(justBefore, startedAt, lastSetAt, null), false);
  assert.equal(workoutLooksStale(atThreshold, startedAt, lastSetAt, null), true);
  assert.equal(workoutLooksStale(atThreshold, startedAt, null, null), false);
  assert.equal(
    workoutLooksStale(atThreshold, startedAt, lastSetAt, atThreshold - 1000),
    false,
  );
});

test("the cron waits six hours, then ends the workout just after the last set", () => {
  const now = lastSetAt + STALE_CLOSE_MS;
  assert.equal(shouldCloseAbandoned(now - 1, startedAt, lastSetAt, null), false);
  assert.equal(shouldCloseAbandoned(now, startedAt, lastSetAt, null), true);
  assert.equal(shouldCloseAbandoned(now, startedAt, lastSetAt, now - 1000), false);
  assert.equal(
    abandonedCompletedAt(now, startedAt, lastSetAt),
    lastSetAt + STALE_END_MARGIN_MS,
  );
});

test("finishing an active workout uses now, and a stale one uses the last set plus the margin", () => {
  const activeNow = lastSetAt + 20 * 60 * 1000;
  assert.equal(
    plannedCompletedAt({
      now: activeNow,
      startedAt,
      lastSetAt,
    }),
    activeNow,
  );

  const staleNow = lastSetAt + STALE_PROMPT_MS;
  assert.equal(
    plannedCompletedAt({
      now: staleNow,
      startedAt,
      lastSetAt,
    }),
    lastSetAt + STALE_END_MARGIN_MS,
  );

  const chosen = lastSetAt + 60 * 1000;
  assert.equal(
    plannedCompletedAt({
      now: staleNow,
      startedAt,
      lastSetAt,
      explicit: chosen,
    }),
    chosen,
  );
  assert.throws(
    () =>
      plannedCompletedAt({
        now: staleNow,
        startedAt,
        lastSetAt,
        explicit: staleNow + 1,
      }),
    /future/,
  );
});
