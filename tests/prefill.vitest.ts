import { describe, expect, test } from "vitest";
import { prefillValues, previousSetsForName } from "../lib/prefill";

const session = [
  { exerciseName: "squat", reps: 5, weightLb: 225 },
  { exerciseName: "bench press", reps: 8, weightLb: 135 },
  { exerciseName: "Bench press", reps: 6, weightLb: 155 },
];

const previous = [
  { reps: 10, weightLb: 95 },
  { reps: 6, weightLb: 145 },
];

describe("set form prefill", () => {
  test("the open workout's last set of that exercise wins", () => {
    expect(prefillValues("bench press", session, previous)).toEqual({
      kind: "strength",
      reps: "6",
      weight: "155",
      duration: "",
      distance: "",
      rpe: "",
      source: "session",
    });
    expect(prefillValues("  Bench   Press ", session, null).source).toBe("session");
  });

  test("otherwise the previous workout's last set is used, never a different exercise", () => {
    expect(prefillValues("deadlift", session, previous)).toEqual({
      kind: "strength",
      reps: "6",
      weight: "145",
      duration: "",
      distance: "",
      rpe: "",
      source: "previous",
    });
    expect(
      prefillValues("curl", [{ exerciseName: "squat", reps: 5, weightLb: 225 }], null),
    ).toEqual({
      kind: "strength",
      reps: "10",
      weight: "0",
      duration: "",
      distance: "",
      rpe: "",
      source: "default",
    });
    expect(prefillValues("curl", [], null)).toEqual({
      kind: "strength",
      reps: "10",
      weight: "0",
      duration: "",
      distance: "",
      rpe: "",
      source: "default",
    });
  });

  test("a previous-workout result only applies to the same exercise", () => {
    const history = { normalizedName: "deadlift", sets: previous };
    expect(previousSetsForName("squat", history)).toBeNull();
    expect(previousSetsForName("deadlift", null)).toBeNull();
    expect(previousSetsForName(" Deadlift ", history)).toEqual(previous);
  });
});
