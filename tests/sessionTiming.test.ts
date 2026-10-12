import assert from "node:assert/strict";
import test from "node:test";
import {
  EMPTY_SESSION_CLOSE_MS,
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

test("a workout looks stale two hours after the last set, unless the user kept going", () => {
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

test("the cron waits four hours, then ends the workout just after the last set", () => {
  const now = lastSetAt + STALE_CLOSE_MS;
  assert.equal(shouldCloseAbandoned(now - 1, startedAt, lastSetAt, null), false);
  assert.equal(shouldCloseAbandoned(now, startedAt, lastSetAt, null), true);
  assert.equal(shouldCloseAbandoned(now, startedAt, lastSetAt, now - 1000), false);
  assert.equal(
    abandonedCompletedAt(now, startedAt, lastSetAt),
    lastSetAt + STALE_END_MARGIN_MS,
  );
});

test("one hour since the last set stays open no matter when the workout started", () => {
  const now = 20 * 60 * 60 * 1000;
  const lastSetAt = now - 60 * 60 * 1000;
  const startedAt = now - 12 * 60 * 60 * 1000;
  assert.equal(STALE_PROMPT_MS, 2 * 60 * 60 * 1000);
  assert.equal(STALE_CLOSE_MS, 4 * 60 * 60 * 1000);
  assert.equal(workoutLooksStale(now, startedAt, lastSetAt, null), false);
  assert.equal(shouldCloseAbandoned(now, startedAt, lastSetAt, null), false);

  const prompted = lastSetAt + STALE_PROMPT_MS;
  assert.equal(workoutLooksStale(prompted, startedAt, lastSetAt, null), true);
  assert.equal(shouldCloseAbandoned(prompted, startedAt, lastSetAt, null), false);

  const closing = lastSetAt + STALE_CLOSE_MS;
  assert.equal(shouldCloseAbandoned(closing - 1, startedAt, lastSetAt, null), false);
  assert.equal(shouldCloseAbandoned(closing, startedAt, lastSetAt, null), true);
  assert.equal(
    abandonedCompletedAt(closing, startedAt, lastSetAt),
    lastSetAt + STALE_END_MARGIN_MS,
  );

  const emptyStart = now - STALE_CLOSE_MS;
  assert.equal(EMPTY_SESSION_CLOSE_MS, 24 * 60 * 60 * 1000);
  assert.equal(workoutLooksStale(now, emptyStart, null, null), false);
  assert.equal(shouldCloseAbandoned(now, emptyStart, null, null), false);
  const emptyClose = emptyStart + EMPTY_SESSION_CLOSE_MS;
  assert.equal(shouldCloseAbandoned(emptyClose - 1, emptyStart, null, null), false);
  assert.equal(shouldCloseAbandoned(emptyClose, emptyStart, null, null), true);
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
