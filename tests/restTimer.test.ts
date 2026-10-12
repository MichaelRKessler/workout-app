import assert from "node:assert/strict";
import test from "node:test";
import { readRestChime, restChimeStored, shouldPlayRestChime } from "../lib/restChime.ts";
import {
  adjustRestSeconds,
  bumpRest,
  DEFAULT_REST_SECONDS,
  MAX_REST_SECONDS,
  MIN_REST_SECONDS,
  readRestSeconds,
  readSavedRest,
  REST_STEP_SECONDS,
  REST_VIBRATION_PATTERN,
  restEndFrom,
  restIntervalActive,
  savedRestValue,
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
  assert.equal(adjustRestSeconds(90, 1), 120);
  assert.equal(adjustRestSeconds(90, -1), 60);
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

test("rest steps by 30 seconds everywhere and stops ticking at zero", () => {
  assert.equal(REST_STEP_SECONDS, 30);
  assert.equal(adjustRestSeconds(MIN_REST_SECONDS, 1), 45);
  const endsAt = restEndFrom(1_000, 30);
  assert.equal(restIntervalActive(endsAt, endsAt - 1), true);
  assert.equal(restIntervalActive(endsAt, endsAt), false);
  assert.equal(restIntervalActive(null, endsAt), false);
});

test("the rest chime is on until it is turned off, and skip stays quiet", () => {
  assert.equal(readRestChime(null), true);
  assert.equal(readRestChime("on"), true);
  assert.equal(readRestChime("off"), false);
  assert.equal(restChimeStored(true), "on");
  assert.equal(restChimeStored(false), "off");
  assert.equal(
    shouldPlayRestChime({ enabled: true, remainingMs: 0, alreadyPlayed: false, skipped: false }),
    true,
  );
  assert.equal(
    shouldPlayRestChime({ enabled: false, remainingMs: 0, alreadyPlayed: false, skipped: false }),
    false,
  );
  assert.equal(
    shouldPlayRestChime({ enabled: true, remainingMs: 0, alreadyPlayed: false, skipped: true }),
    false,
  );
  assert.equal(
    shouldPlayRestChime({ enabled: true, remainingMs: 20, alreadyPlayed: false, skipped: false }),
    false,
  );
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

test("+30 s after rest is done starts 30 more seconds, not a whole rest", () => {
  const now = 1_000_000;
  const done = bumpRest({ endsAt: now - 5_000, now, seconds: 90, direction: 1 });
  assert.equal(done.endsAt, now + REST_STEP_SECONDS * 1000);
  assert.equal(done.seconds, 90);
  assert.equal(done.restarted, true);
});

test("−30 s after rest is done only shortens the next rest", () => {
  const now = 1_000_000;
  const done = bumpRest({ endsAt: now, now, seconds: 120, direction: -1 });
  assert.equal(done.endsAt, now);
  assert.equal(done.seconds, 90);
  assert.equal(done.restarted, false);
});

test("a running rest moves its end, and no rest yet starts one", () => {
  const now = 1_000_000;
  const running = bumpRest({ endsAt: now + 60_000, now, seconds: 90, direction: 1 });
  assert.equal(running.endsAt, now + 90_000);
  assert.equal(running.seconds, 120);
  assert.equal(running.restarted, false);

  const idle = bumpRest({ endsAt: null, now, seconds: 90, direction: -1 });
  assert.equal(idle.endsAt, now + 60_000);
  assert.equal(idle.seconds, 60);
  assert.equal(idle.restarted, true);
});

test("a saved rest comes back only for the same workout", () => {
  const now = 1_000_000;
  const stored = savedRestValue({ workout: "100", endsAt: now + 60_000, seconds: 90, skipped: false });
  assert.deepEqual(readSavedRest(stored, "100", now), {
    workout: "100",
    endsAt: now + 60_000,
    seconds: 90,
    skipped: false,
  });
  assert.equal(readSavedRest(stored, "200", now), null);
  assert.equal(readSavedRest(null, "100", now), null);
  assert.equal(readSavedRest("not json", "100", now), null);
  assert.equal(readSavedRest("null", "100", now), null);
  assert.equal(readSavedRest(JSON.stringify({ workout: "100", endsAt: "soon" }), "100", now), null);
});

test("a saved rest is kept after it ends, and a far future end is dropped", () => {
  const now = 1_000_000;
  const ended = savedRestValue({ workout: "100", endsAt: now - 5_000, seconds: 120, skipped: true });
  assert.equal(readSavedRest(ended, "100", now)?.skipped, true);
  const far = savedRestValue({ workout: "100", endsAt: now + (MAX_REST_SECONDS + 60) * 1000, seconds: 90, skipped: false });
  assert.equal(readSavedRest(far, "100", now), null);
  const odd = JSON.stringify({ workout: "100", endsAt: now + 10_000, seconds: 9999 });
  assert.equal(readSavedRest(odd, "100", now)?.seconds, MAX_REST_SECONDS);
  assert.equal(readSavedRest(odd, "100", now)?.skipped, false);
});
