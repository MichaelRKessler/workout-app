import assert from "node:assert/strict";
import test from "node:test";
import {
  assertWeekRange,
  localWeekFirstDay,
  startOfLocalWeek,
  weekIndexFor,
  weekRange,
  workoutStreak,
} from "../convex/lib/week.ts";

test("weeks start at local midnight on the requested first day", () => {
  const wednesday = new Date(2026, 9, 14, 15, 30, 0, 0);
  const monday = startOfLocalWeek(wednesday.getTime(), 1);
  const mondayDate = new Date(monday);
  assert.equal(mondayDate.getDay(), 1);
  assert.equal(mondayDate.getHours(), 0);
  assert.equal(mondayDate.getMinutes(), 0);
  assert.equal(mondayDate.getDate(), 12);

  const sunday = startOfLocalWeek(wednesday.getTime(), 7);
  const sundayDate = new Date(sunday);
  assert.equal(sundayDate.getDay(), 0);
  assert.equal(sundayDate.getDate(), 11);
  assert.ok(sunday <= wednesday.getTime());
  assert.ok(wednesday.getTime() - sunday < 7 * 24 * 60 * 60 * 1000);
});

test("a week range is strictly increasing and about seven days apart", () => {
  const range = weekRange(new Date(2026, 9, 11, 18, 0, 0, 0).getTime(), 1, 8);
  assert.equal(range.weekStarts.length, 8);
  assertWeekRange(range.weekStarts, range.weekEndsAt);
  const last = range.weekStarts[range.weekStarts.length - 1];
  assert.equal(last !== undefined && new Date(last).getDay(), 1);
});

test("streaks survive the current week until it ends empty", () => {
  assert.equal(workoutStreak([]), 0);
  assert.equal(workoutStreak([false, false, false]), 0);
  assert.equal(workoutStreak([true, true, false]), 2);
  assert.equal(workoutStreak([true, false, true]), 1);
  assert.equal(workoutStreak([true, true, true]), 3);
  assert.equal(workoutStreak([false, true, false]), 1);
});

test("a workout lands in the week that contains its start", () => {
  const starts = [1_000, 1_000 + 7 * 24 * 60 * 60 * 1000];
  const end = starts[1]! + 7 * 24 * 60 * 60 * 1000;
  assert.equal(weekIndexFor(starts[0]!, starts, end), 0);
  assert.equal(weekIndexFor(starts[1]! + 1000, starts, end), 1);
  assert.equal(weekIndexFor(starts[0]! - 1, starts, end), null);
  assert.equal(weekIndexFor(end, starts, end), null);
});

test("week ranges reject gaps that are not about a week", () => {
  const week = 7 * 24 * 60 * 60 * 1000;
  assert.throws(() => assertWeekRange([0, week / 2], week), /seven days/);
  assert.throws(() => assertWeekRange([0], week), /at least two weeks/);
  assert.doesNotThrow(() => assertWeekRange([0, week], week * 2));
});

test("en-US weeks start on Sunday when the runtime exposes week info", () => {
  const locale = new Intl.Locale("en-US") as Intl.Locale & {
    weekInfo?: { firstDay?: number };
  };
  if (locale.weekInfo?.firstDay === undefined) {
    assert.equal(localWeekFirstDay("en-US"), 1);
    return;
  }
  assert.equal(localWeekFirstDay("en-US"), 7);
});
