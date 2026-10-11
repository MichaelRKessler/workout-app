import assert from "node:assert/strict";
import test from "node:test";
import {
  moveItem,
  normalizeRoutineName,
  normalizeTargets,
  planFromPerformedSets,
  planProgress,
  repointExercises,
  routinePrefillFromTarget,
} from "../convex/lib/routinePlan.ts";
import { formatRoutineTarget, suggestRoutineName } from "../lib/format.ts";
import { calendarDayKey, groupHistoryDays } from "../lib/historyDays.ts";
import { loadPendingPlan, loadRoutineCache, savePendingPlan, saveRoutineCache } from "../lib/offline/routineCache.ts";
import { loadSnapshot, saveSnapshot, type KeyValueStore } from "../lib/offline/storage.ts";
import { prefillValues, setFromPrefill } from "../lib/prefill.ts";
import { blankRoutineExercise, routineDraftToPayload } from "../lib/routineDraft.ts";
import { splitWorkoutPlan, type VisiblePlanItem } from "../lib/workoutPlan.ts";
import { toPounds } from "../convex/lib/units.ts";
import type { SetLine } from "../lib/groupSets.ts";

function memoryStore(): KeyValueStore {
  const values = new Map<string, string>();
  return {
    get: (key) => values.get(key) ?? null,
    set: (key, value) => {
      values.set(key, value);
    },
    remove: (key) => {
      values.delete(key);
    },
    keys: () => [...values.keys()],
  };
}

test("routine names and targets stay inside the saved limits", () => {
  assert.equal(normalizeRoutineName("  Push   day "), "Push day");
  assert.throws(() => normalizeRoutineName("   "), /1 to 40/);
  assert.throws(() => normalizeRoutineName("x".repeat(41)), /1 to 40/);
  assert.deepEqual(
    normalizeTargets({
      targetSets: 3,
      targetReps: 10,
      targetWeightLb: 135,
      targetDurationSec: null,
      targetDistanceM: null,
    }),
    { targetSets: 3, targetReps: 10, targetWeightLb: 135 },
  );
  assert.deepEqual(normalizeTargets({ targetWeightLb: 0, targetReps: 10 }), {
    targetReps: 10,
    targetWeightLb: 0,
  });
  assert.throws(
    () => normalizeTargets({ targetReps: 10, targetDurationSec: 60 }),
    /reps, a time, or a distance/,
  );
  assert.throws(() => normalizeTargets({ targetSets: 0 }), /1 to 30/);
  assert.throws(() => normalizeTargets({ targetWeightLb: 2001 }), /2000/);
});

test("a merge repoints exercise ids and drops a duplicate", () => {
  const kept = repointExercises(
    [
      { exerciseId: "bench", targetReps: 10 },
      { exerciseId: "row", targetReps: 8 },
    ],
    "press",
    "bench",
  );
  assert.equal(kept.changed, false);

  const moved = repointExercises(
    [
      { exerciseId: "press", targetReps: 5 },
      { exerciseId: "row", targetReps: 8 },
    ],
    "press",
    "bench",
  );
  assert.equal(moved.changed, true);
  assert.deepEqual(
    moved.items.map((item) => item.exerciseId),
    ["bench", "row"],
  );
  assert.equal(moved.items[0]?.targetReps, 5);

  const duplicate = repointExercises(
    [
      { exerciseId: "bench", targetReps: 10 },
      { exerciseId: "press", targetReps: 5 },
    ],
    "press",
    "bench",
  );
  assert.deepEqual(
    duplicate.items.map((item) => item.exerciseId),
    ["bench"],
  );
  assert.equal(duplicate.items[0]?.targetReps, 10);

  const laterKept = repointExercises(
    [
      { exerciseId: "press", targetReps: 5 },
      { exerciseId: "bench", targetReps: 10 },
    ],
    "press",
    "bench",
  );
  assert.deepEqual(laterKept.items, [{ exerciseId: "bench", targetReps: 10 }]);
});

test("reorder stays inside the list", () => {
  assert.deepEqual(moveItem(["a", "b", "c"], 2, -1), ["a", "c", "b"]);
  assert.deepEqual(moveItem(["a", "b"], 0, -1), ["a", "b"]);
  assert.deepEqual(moveItem(["a", "b"], 1, 1), ["a", "b"]);
});

test("performed sets become a target only when they match", () => {
  const plan = planFromPerformedSets([
    {
      exerciseId: "bench",
      reps: 8,
      weightLb: 155,
      durationSec: null,
      distanceM: null,
      loggedAt: 30,
    },
    {
      exerciseId: "squat",
      reps: 5,
      weightLb: 225,
      durationSec: null,
      distanceM: null,
      loggedAt: 10,
    },
    {
      exerciseId: "squat",
      reps: 5,
      weightLb: 225,
      durationSec: null,
      distanceM: null,
      loggedAt: 20,
    },
    {
      exerciseId: "bench",
      reps: 6,
      weightLb: 155,
      durationSec: null,
      distanceM: null,
      loggedAt: 40,
    },
    {
      exerciseId: "plank",
      reps: null,
      weightLb: 0,
      durationSec: 60,
      distanceM: null,
      loggedAt: 50,
    },
    {
      exerciseId: "row",
      reps: null,
      weightLb: 0,
      durationSec: 480,
      distanceM: 2000,
      loggedAt: 60,
    },
  ]);
  assert.deepEqual(
    plan.map((item) => item.exerciseId),
    ["squat", "bench", "plank", "row"],
  );
  assert.deepEqual(plan[0], {
    exerciseId: "squat",
    targetSets: 2,
    targetReps: 5,
    targetWeightLb: 225,
  });
  assert.deepEqual(plan[1], { exerciseId: "bench", targetSets: 2 });
  assert.deepEqual(plan[2], {
    exerciseId: "plank",
    targetSets: 1,
    targetDurationSec: 60,
  });
  assert.deepEqual(plan[3], {
    exerciseId: "row",
    targetSets: 1,
    targetDurationSec: 480,
    targetDistanceM: 2000,
  });
});

test("checklist progress uses the target count, then a skip", () => {
  assert.deepEqual(planProgress(0, 3, false), { done: false, label: "0 of 3" });
  assert.deepEqual(planProgress(3, 3, false), { done: true, label: "3 of 3" });
  assert.deepEqual(planProgress(4, 3, false), { done: true, label: "3 of 3" });
  assert.deepEqual(planProgress(0, null, false), { done: false, label: null });
  assert.deepEqual(planProgress(1, null, false), { done: true, label: null });
  assert.deepEqual(planProgress(0, 3, true), { done: true, label: "Skipped" });
});

test("a routine target is used only after the last logged set", () => {
  const routine = { reps: 8, weightLb: 95, durationSec: null, distanceM: null };
  assert.equal(routinePrefillFromTarget({ targetSets: 3 }), null);
  assert.equal(prefillValues("curl", [], null, routine).source, "routine");
  assert.equal(prefillValues("curl", [], null, routine).reps, "8");
  assert.equal(
    prefillValues(
      "curl",
      [],
      [{ reps: 6, weightLb: 145 }],
      routine,
    ).source,
    "previous",
  );
  assert.equal(
    prefillValues(
      "curl",
      [{ exerciseName: "curl", reps: 4, weightLb: 50 }],
      null,
      routine,
    ).source,
    "session",
  );
  assert.equal(
    prefillValues("curl", [], null, { reps: null, weightLb: 45, durationSec: null, distanceM: null })
      .source,
    "default",
  );
  assert.deepEqual(setFromPrefill(prefillValues("curl", [], null, routine)), {
    reps: 8,
    weightLb: 95,
    setType: "working",
  });
});

test("routine labels include the display unit", () => {
  assert.equal(
    formatRoutineTarget({ targetSets: 3, targetReps: 10, targetWeightLb: 135 }),
    "3×10 · 135 lb",
  );
  assert.equal(
    formatRoutineTarget({ targetSets: 3, targetReps: 10, targetWeightLb: 0 }),
    "3×10 · bodyweight",
  );
  assert.equal(
    formatRoutineTarget({
      targetSets: 3,
      targetReps: 10,
      targetWeightLb: toPounds(60, "kg"),
    }, "kg"),
    "3×10 · 60 kg",
  );
  assert.equal(formatRoutineTarget({ targetSets: 3, targetDurationSec: 60 }), "3×1:00");
  assert.equal(
    formatRoutineTarget({ targetSets: 2, targetDistanceM: 5000, targetDurationSec: 1500 }),
    "2×5 km in 25:00",
  );
  assert.equal(formatRoutineTarget({ targetSets: 3 }), "3 sets");
  assert.equal(formatRoutineTarget({}), null);
  assert.equal(
    suggestRoutineName(new Date(2026, 9, 11, 9).getTime()),
    "Sunday",
  );
});

test("history days follow the local calendar, not UTC midnight", () => {
  const morning = new Date(2026, 9, 11, 8).getTime();
  const evening = new Date(2026, 9, 11, 20).getTime();
  const next = new Date(2026, 9, 12, 7).getTime();
  assert.equal(calendarDayKey(morning), calendarDayKey(evening));
  assert.notEqual(calendarDayKey(morning), calendarDayKey(next));
  const session = (id: string, startedAt: number) => ({
    id,
    startedAt,
    completedAt: startedAt + 60_000,
    volumeLb: 0,
    exercises: [],
  });
  const days = groupHistoryDays([
    session("later", evening),
    session("earlier", morning),
    session("next", next),
  ]);
  assert.deepEqual(
    days.map((day) => day.sessionIds),
    [["next"], ["earlier", "later"]],
  );
});

test("the editor turns a draft into stored pounds and rejects duplicates", () => {
  const blank = blankRoutineExercise("1");
  assert.equal(blank.kind, "none");
  const saved = routineDraftToPayload(
    [
      {
        ...blank,
        name: "  Squat ",
        kind: "strength",
        sets: "3",
        reps: "5",
        weight: "60",
      },
    ],
    "kg",
  );
  assert.equal(saved.ok, true);
  if (saved.ok) {
    assert.equal(saved.exercises[0]?.name, "Squat");
    assert.equal(saved.exercises[0]?.targetSets, 3);
    assert.equal(saved.exercises[0]?.targetReps, 5);
    assert.equal(saved.exercises[0]?.targetWeightLb, toPounds(60, "kg"));
  }
  const names = routineDraftToPayload(
    [
      { ...blank, key: "1", name: "Bench" },
      { ...blank, key: "2", name: "bench" },
    ],
    "lb",
  );
  assert.equal(names.ok, false);
  const timed = routineDraftToPayload(
    [{ ...blank, name: "Plank", kind: "timed", sets: "3", duration: "1:00" }],
    "lb",
  );
  assert.equal(timed.ok, true);
  if (timed.ok) {
    assert.equal(timed.exercises[0]?.targetDurationSec, 60);
    assert.equal(timed.exercises[0]?.targetSets, 3);
  }
});

test("cached routines and older snapshots without a plan still load", () => {
  const store = memoryStore();
  saveRoutineCache(store, "michael@example.com", [
    {
      _id: "routine-1",
      name: "Push day",
      exerciseCount: 1,
      exerciseNames: ["Bench press"],
      exercises: [
        {
          exerciseId: "bench",
          name: "Bench press",
          targetSets: 3,
          targetReps: 10,
          targetWeightLb: 135,
          targetDurationSec: null,
          targetDistanceM: null,
        },
      ],
    },
  ]);
  assert.equal(loadRoutineCache(store, "Michael@example.com")?.[0]?.name, "Push day");

  saveSnapshot(store, "michael@example.com", {
    session: null,
    sets: [],
    plan: null,
  });
  const raw = store.get("workout-offline:snapshot:michael@example.com");
  assert.ok(raw);
  const older = JSON.parse(raw) as { plan?: unknown };
  delete older.plan;
  store.set("workout-offline:snapshot:michael@example.com", JSON.stringify(older));
  assert.equal(loadSnapshot(store, "michael@example.com")?.plan, null);

  savePendingPlan(store, "michael@example.com", {
    startedAt: 10,
    name: "Leg day",
    routineId: "routine-1",
    exercises: [
      {
        exerciseId: "squat",
        name: "Squat",
        targetSets: 3,
        targetReps: 5,
        targetWeightLb: 225,
        targetDurationSec: null,
        targetDistanceM: null,
        skipped: false,
      },
    ],
  });
  assert.equal(loadPendingPlan(store, "michael@example.com")?.name, "Leg day");
});

test("the workout plan keeps routine order and parks extra exercises after it", () => {
  const plan: VisiblePlanItem[] = [
    {
      exerciseId: "squat",
      name: "Squat",
      targetSets: 3,
      targetReps: 5,
      targetWeightLb: 225,
      targetDurationSec: null,
      targetDistanceM: null,
      skipped: false,
    },
    {
      exerciseId: "bench",
      name: "Bench",
      targetSets: null,
      targetReps: null,
      targetWeightLb: null,
      targetDurationSec: null,
      targetDistanceM: null,
      skipped: false,
    },
  ];
  const squat: SetLine = {
    _id: "set-1",
    exerciseId: "squat",
    exerciseName: "Back squat",
    reps: 5,
    weightLb: 225,
    durationSec: null,
    distanceM: null,
    rpe: null,
    loggedAt: 1,
  };
  const curl: SetLine = {
    ...squat,
    _id: "set-2",
    exerciseId: "curl",
    exerciseName: "Curl",
    loggedAt: 2,
  };
  const split = splitWorkoutPlan(plan, [
    { exerciseId: "curl", name: "Curl", sets: [curl] },
    { exerciseId: "squat", name: "Back squat", sets: [squat] },
  ]);
  assert.deepEqual(
    split.rows.map((row) => row.name),
    ["Back squat", "Bench"],
  );
  assert.equal(split.rows[0]?.sets.length, 1);
  assert.equal(split.rows[1]?.sets.length, 0);
  assert.equal(split.extras[0]?.name, "Curl");
});
