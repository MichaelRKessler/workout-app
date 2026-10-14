import assert from "node:assert/strict";
import test from "node:test";
import { formatExerciseName } from "../convex/lib/exerciseName.ts";

test("collapses whitespace and keeps the typed capitalization", () => {
  assert.deepEqual(formatExerciseName("  Bench   press "), {
    name: "Bench press",
    normalizedName: "benchpress",
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

test("treats hyphens, spaces and plurals as the same exercise", () => {
  const keys = ["Sit ups", "Sit-ups", "situps", "Sit-up", "SIT UP"].map(
    (name) => formatExerciseName(name)?.normalizedName,
  );
  assert.deepEqual(new Set(keys), new Set(["situp"]));
  assert.equal(formatExerciseName("Chin ups")?.normalizedName, formatExerciseName("Chin-up")?.normalizedName);
  assert.equal(formatExerciseName("Push-Ups")?.normalizedName, formatExerciseName("pushup")?.normalizedName);
});

test("keeps words ending in ss and strips es from presses and crunches", () => {
  assert.equal(formatExerciseName("Bench press")?.normalizedName, "benchpress");
  assert.equal(formatExerciseName("Bench presses")?.normalizedName, "benchpress");
  assert.equal(formatExerciseName("Crunches")?.normalizedName, formatExerciseName("crunch")?.normalizedName);
  assert.equal(formatExerciseName("Lunges")?.normalizedName, formatExerciseName("Lunge")?.normalizedName);
  assert.equal(formatExerciseName("Chest flies")?.normalizedName, formatExerciseName("Chest fly")?.normalizedName);
  assert.equal(formatExerciseName("Farmer's carries")?.normalizedName, formatExerciseName("farmers carry")?.normalizedName);
});

test("keeps different exercises apart", () => {
  assert.notEqual(formatExerciseName("Pull-ups")?.normalizedName, formatExerciseName("Push-ups")?.normalizedName);
  assert.notEqual(formatExerciseName("Leg press")?.normalizedName, formatExerciseName("Leg curl")?.normalizedName);
});

test("gives a name of only punctuation a key", () => {
  assert.equal(formatExerciseName("???")?.normalizedName, "???");
});
