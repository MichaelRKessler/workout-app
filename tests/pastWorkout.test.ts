import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultPastWorkoutTime,
  fromDatetimeLocalValue,
  toDatetimeLocalValue,
} from "../lib/pastWorkout.ts";

test("datetime-local values round trip in the local time zone", () => {
  const timestamp = new Date(2026, 9, 11, 18, 5, 0, 0).getTime();
  const value = toDatetimeLocalValue(timestamp);
  assert.match(value, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  assert.equal(fromDatetimeLocalValue(value), timestamp);
  assert.equal(fromDatetimeLocalValue("not-a-time"), null);
  assert.equal(fromDatetimeLocalValue("2026-10-11T18:05:30"), null);
});

test("the default past time is about an hour ago", () => {
  const now = new Date(2026, 9, 11, 18, 5, 40, 0).getTime();
  const picked = defaultPastWorkoutTime(now);
  assert.ok(picked < now);
  assert.ok(now - picked >= 60 * 60 * 1000);
  assert.ok(now - picked < 2 * 60 * 60 * 1000);
  assert.equal(new Date(picked).getSeconds(), 0);
});
