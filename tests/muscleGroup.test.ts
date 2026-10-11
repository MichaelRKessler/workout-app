import assert from "node:assert/strict";
import test from "node:test";
import {
  formatMuscleSummary,
  muscleCounts,
  muscleGroupToCopy,
  suggestMuscleGroup,
} from "../convex/lib/muscleGroup.ts";

test("common exercise names suggest a primary muscle", () => {
  const cases: Array<[string, string]> = [
    ["Bench Press", "chest"],
    ["Incline dumbbell press", "chest"],
    ["Dip", "chest"],
    ["Tricep dip", "triceps"],
    ["Close-grip bench press", "triceps"],
    ["Skull crusher", "triceps"],
    ["Barbell row", "back"],
    ["Deadlift", "back"],
    ["Pull-up", "back"],
    ["Chin-up", "back"],
    ["Romanian deadlift", "hamstrings"],
    ["RDL", "hamstrings"],
    ["Leg curl", "hamstrings"],
    ["Sumo deadlift", "glutes"],
    ["Hip thrust", "glutes"],
    ["Back squat", "quads"],
    ["Walking lunge", "quads"],
    ["Leg press", "quads"],
    ["Bicep curl", "biceps"],
    ["Hammer curl", "biceps"],
    ["Wrist curl", "other"],
    ["Calf raise", "other"],
    ["Overhead press", "shoulders"],
    ["Upright row", "shoulders"],
    ["Face pull", "shoulders"],
    ["Plank", "core"],
    ["Running", "cardio"],
    ["Rowing", "cardio"],
    ["Something invented", "other"],
  ];
  for (const [name, group] of cases) {
    assert.equal(suggestMuscleGroup(name), group, name);
  }
});

test("a merge keeps the survivor's group and only copies a compatible one", () => {
  assert.equal(
    muscleGroupToCopy({ name: "Squat", muscleGroup: "chest" }, { muscleGroup: "biceps" }),
    null,
  );
  assert.equal(muscleGroupToCopy({ name: "Squat" }, { muscleGroup: "biceps" }), null);
  assert.equal(muscleGroupToCopy({ name: "Squat" }, { muscleGroup: "quads" }), "quads");
  assert.equal(muscleGroupToCopy({ name: "Mystery move" }, { muscleGroup: "biceps" }), "biceps");
  assert.equal(muscleGroupToCopy({ name: "Squat" }, {}), null);
});

test("the weekly line skips zeros and uses the Quads label", () => {
  assert.equal(
    formatMuscleSummary(
      muscleCounts(
        new Map([
          ["chest", 12],
          ["back", 6],
          ["quads", 9],
          ["core", 0],
        ]),
      ),
    ),
    "Chest 12 · Back 6 · Quads 9",
  );
  assert.equal(formatMuscleSummary([]), "");
});
