import assert from "node:assert/strict";
import test from "node:test";
import { exerciseIconKind } from "../lib/exerciseIcon.ts";

test("barbell lifts get the barbell", () => {
  for (const name of ["Bench press", "Squat", "Deadlift", "Romanian deadlift", "Overhead press", "Push press"]) {
    assert.equal(exerciseIconKind(name), "barbell", name);
  }
});

test("equipment words win over the movement", () => {
  assert.equal(exerciseIconKind("Dumbbell bench press"), "dumbbell");
  assert.equal(exerciseIconKind("Incline DB press"), "dumbbell");
  assert.equal(exerciseIconKind("Dumbbell row"), "dumbbell");
  assert.equal(exerciseIconKind("Goblet squat"), "kettlebell");
  assert.equal(exerciseIconKind("Kettlebell swings"), "kettlebell");
  assert.equal(exerciseIconKind("Leg press"), "machine");
  assert.equal(exerciseIconKind("Lat pulldown"), "machine");
  assert.equal(exerciseIconKind("Seated cable row"), "machine");
});

test("bodyweight movements get the figure", () => {
  for (const name of ["Push-ups", "pushups", "Pull ups", "Chin-up", "Dips", "Plank", "Walking lunges", "Air squat"]) {
    assert.equal(exerciseIconKind(name), "bodyweight", name);
  }
});

test("anything else falls back to the neutral icon", () => {
  assert.equal(exerciseIconKind("Bike intervals"), "other");
  assert.equal(exerciseIconKind("Calf raises"), "other");
  assert.equal(exerciseIconKind("Farmer carry"), "other");
  assert.equal(exerciseIconKind(""), "other");
});
