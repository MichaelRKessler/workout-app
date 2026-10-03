import assert from "node:assert/strict";
import test from "node:test";
import { formatExerciseName } from "../convex/lib/exerciseName.ts";

test("collapses whitespace and keeps the typed capitalization", () => {
  assert.deepEqual(formatExerciseName("  Bench   press "), {
    name: "Bench press",
    normalizedName: "bench press",
  });
});

test("treats names that differ only by case as the same exercise", () => {
  const first = formatExerciseName("Push-ups");
  const second = formatExerciseName("push-ups");
  assert.equal(first?.normalizedName, second?.normalizedName);
  assert.equal(first?.name, "Push-ups");
});

test("rejects an empty name", () => {
  assert.equal(formatExerciseName("   "), null);
});

test("rejects a name longer than 80 characters", () => {
  assert.equal(formatExerciseName("a".repeat(81)), null);
});
