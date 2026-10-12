import assert from "node:assert/strict";
import test from "node:test";
import {
  bodyCsv,
  collectPages,
  readStoredZip,
  routinesCsv,
  setsCsv,
  zipStored,
} from "../lib/spreadsheet.ts";

test("set export includes pounds, kilograms, and the display unit", () => {
  const csv = setsCsv(
    [
      {
        loggedAt: Date.UTC(2026, 0, 2, 15, 0, 0),
        workoutStartedAt: Date.UTC(2026, 0, 2, 14, 0, 0),
        workoutId: "workout-1",
        exercise: "Curl",
        setType: "working",
        reps: 12,
        weightLb: 30,
        durationSec: null,
        distanceM: null,
        calories: 450,
        rpe: 8,
        note: "easy, \"then\" hard",
        superset: "arms",
      },
    ],
    "kg",
    "UTC",
  );
  const [header, row] = csv.trim().split("\n");
  assert.ok(header?.includes("weight_lb"));
  assert.ok(header?.includes("weight_kg"));
  assert.ok(header?.includes("display_unit"));
  assert.ok(header?.includes("calories"));
  assert.ok(row?.includes("450"));
  assert.ok(row?.includes("Curl"));
  assert.ok(row?.includes("kg"));
  assert.ok(row?.includes("\"easy, \"\"then\"\" hard\""));
});

test("body and routine files keep their own units", () => {
  const body = bodyCsv(
    [
      {
        loggedAt: Date.UTC(2026, 0, 2),
        weightLb: 180,
        bodyFatPct: null,
        waistCm: 80,
        chestCm: null,
        armCm: null,
        hipsCm: null,
        thighCm: null,
        note: null,
      },
    ],
    "lb",
    "in",
    "UTC",
  );
  assert.ok(body.includes("waist_cm"));
  assert.ok(body.includes("length_unit"));
  const routines = routinesCsv(
    [
      {
        routine: "Arms",
        sortIndex: 0,
        exerciseOrder: 1,
        exercise: "Curl",
        superset: "arms",
        targetSets: 3,
        targetReps: 12,
        targetWeightLb: 30,
        targetDurationSec: null,
        targetDistanceM: null,
        targetCalories: null,
        restSeconds: 90,
      },
    ],
    "lb",
  );
  assert.equal(routines.trim().split("\n").length, 2);
  assert.ok(routines.includes("weight_unit"));
  assert.ok(routines.includes("arms"));
});

test("the zip round-trips three stored files", () => {
  const files = readStoredZip(
    zipStored([
      { name: "sets.csv", text: "date\n" },
      { name: "body.csv", text: "weight\n" },
      { name: "routines.csv", text: "name\n" },
    ]),
  );
  assert.deepEqual(
    files.map((file) => file.name),
    ["sets.csv", "body.csv", "routines.csv"],
  );
  assert.equal(files[1]?.text, "weight\n");
});

test("page collection stops when the cursor is exhausted", async () => {
  const loaded = await collectPages(async (cursor) => {
    if (cursor === null) {
      return { page: [1], isDone: false, continueCursor: "next" };
    }
    return { page: [2], isDone: true, continueCursor: "" };
  });
  assert.deepEqual(loaded, { rows: [1, 2], complete: true });
});
