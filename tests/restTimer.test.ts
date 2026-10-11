import assert from "node:assert/strict";
import test from "node:test";
import {
  adjustRestSeconds,
  DEFAULT_REST_SECONDS,
  MAX_REST_SECONDS,
  MIN_REST_SECONDS,
  readRestSeconds,
  REST_VIBRATION_PATTERN,
  restEndFrom,
  shiftActiveRest,
  shouldVibrateRest,
  vibrateForRest,
} from "../lib/restTimer.ts";

test("rest length stays between 15 seconds and 5 minutes", () => {
  assert.equal(DEFAULT_REST_SECONDS, 90);
  assert.equal(readRestSeconds(null), 90);
  assert.equal(readRestSeconds(""), 90);
  assert.equal(readRestSeconds("nope"), 90);
  assert.equal(readRestSeconds("120"), 120);
  assert.equal(readRestSeconds("10"), MIN_REST_SECONDS);
  assert.equal(readRestSeconds("999"), MAX_REST_SECONDS);
  assert.equal(adjustRestSeconds(90, 1), 105);
  assert.equal(adjustRestSeconds(90, -1), 75);
  assert.equal(adjustRestSeconds(MIN_REST_SECONDS, -1), MIN_REST_SECONDS);
  assert.equal(adjustRestSeconds(MAX_REST_SECONDS, 1), MAX_REST_SECONDS);
});

test("a running rest shifts with the length, and a finished one does not restart", () => {
  const now = 1_000_000;
  const endsAt = restEndFrom(now, 90);
  assert.equal(endsAt, now + 90_000);
  assert.equal(shiftActiveRest(endsAt, now + 10_000, 90, 105), endsAt + 15_000);
  assert.equal(shiftActiveRest(endsAt, endsAt, 90, 105), endsAt);
  assert.equal(shiftActiveRest(null, now, 90, 105), null);
  assert.equal(shouldVibrateRest(1, false), false);
  assert.equal(shouldVibrateRest(0, false), true);
  assert.equal(shouldVibrateRest(-20, true), false);
});

test("vibration uses one pattern and ignores browsers that cannot vibrate", () => {
  const seen: Array<number | number[]> = [];
  vibrateForRest((pattern) => {
    seen.push(pattern);
    return true;
  });
  assert.deepEqual(seen, [REST_VIBRATION_PATTERN]);
  vibrateForRest(undefined);
  assert.doesNotThrow(() => {
    vibrateForRest(() => {
      throw new Error("blocked");
    });
  });
});
