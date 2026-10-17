import assert from "node:assert/strict";
import test from "node:test";
import {
  addMuscleSets,
  formatMuscleSummary,
  muscleCounts,
  muscleGroupToCopy,
  presentMuscle,
  secondaryMusclesToCopy,
  suggestMuscleGroup,
  suggestSecondaryMuscles,
  type MuscleGroup,
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

test("compound lifts suggest the groups they also work, never the main one", () => {
  const cases: Array<[string, string[]]> = [
    ["Chin-up", ["biceps"]],
    ["Pull-up", ["biceps"]],
    ["Barbell row", ["biceps"]],
    ["Lat pulldown", ["biceps"]],
    ["Upright row", []],
    ["Rowing", []],
    ["Bench Press", ["shoulders", "triceps"]],
    ["Push-up", ["shoulders", "triceps"]],
    ["Dip", ["triceps"]],
    ["Tricep dip", ["chest"]],
    ["Close-grip bench press", ["chest", "shoulders"]],
    ["Overhead press", ["triceps"]],
    ["Back squat", ["glutes"]],
    ["Deadlift", ["hamstrings", "glutes"]],
    ["Romanian deadlift", ["glutes"]],
    ["Hip thrust", ["hamstrings"]],
    ["Bicep curl", []],
    ["Plank", []],
    ["Running", []],
  ];
  for (const [name, groups] of cases) {
    assert.deepEqual(suggestSecondaryMuscles(name, suggestMuscleGroup(name)), groups, name);
  }
});

test("a saved list wins over the suggestion, even when empty", () => {
  assert.deepEqual(presentMuscle({ name: "Chin-up" }), {
    muscleGroup: "back",
    muscleSource: "suggested",
    secondaryMuscles: ["biceps"],
    secondarySource: "suggested",
  });
  assert.deepEqual(presentMuscle({ name: "Chin-up", secondaryMuscles: [] }).secondaryMuscles, []);
  // A saved main group drops out of the list, and order follows the summary.
  assert.deepEqual(
    presentMuscle({ name: "Chin-up", muscleGroup: "biceps", secondaryMuscles: ["core", "biceps", "back"] })
      .secondaryMuscles,
    ["back", "core"],
  );
});

test("also-works groups count half a set in the week", () => {
  const counts = new Map<MuscleGroup, number>();
  addMuscleSets(counts, { name: "Chin-up" }, 4);
  addMuscleSets(counts, { name: "Bicep curl" }, 3);
  assert.deepEqual(muscleCounts(counts), [
    { group: "back", sets: 4 },
    { group: "biceps", sets: 5 },
  ]);
});

test("a merge copies a saved also-works list only onto a matching survivor", () => {
  assert.deepEqual(
    secondaryMusclesToCopy({ name: "Chin up" }, { name: "Chinup", secondaryMuscles: ["biceps", "core"] }),
    ["biceps", "core"],
  );
  assert.equal(
    secondaryMusclesToCopy(
      { name: "Chin up", secondaryMuscles: [] },
      { name: "Chinup", secondaryMuscles: ["biceps"] },
    ),
    null,
  );
  assert.equal(
    secondaryMusclesToCopy({ name: "Squat" }, { name: "Chinup", secondaryMuscles: ["biceps"] }),
    null,
  );
  assert.equal(secondaryMusclesToCopy({ name: "Chin up" }, { name: "Chinup" }), null);
});
