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
      setType: "working",
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
      setType: "working",
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
      setType: "working",
      source: "default",
    });
    expect(prefillValues("curl", [], null)).toEqual({
      kind: "strength",
      reps: "10",
      weight: "0",
      duration: "",
      distance: "",
      rpe: "",
      setType: "working",
      source: "default",
    });
  });

  test("a routine target fills the gap before the default of 10 at 0", () => {
    const routine = { reps: 8, weightLb: 95, durationSec: null, distanceM: null };
    expect(prefillValues("curl", [], null, routine)).toEqual({
      kind: "strength",
      reps: "8",
      weight: "95",
      duration: "",
      distance: "",
      rpe: "",
      setType: "working",
      source: "routine",
    });
    expect(prefillValues("bench press", session, previous, routine).source).toBe("session");
    expect(prefillValues("deadlift", session, previous, routine).source).toBe("previous");
    expect(
      prefillValues("curl", [], null, {
        reps: null,
        weightLb: 45,
        durationSec: null,
        distanceM: null,
      }).source,
    ).toBe("default");
  });

  test("a previous-workout result only applies to the same exercise", () => {
    const history = { normalizedName: "deadlift", sets: previous };
    expect(previousSetsForName("squat", history)).toBeNull();
    expect(previousSetsForName("deadlift", null)).toBeNull();
    expect(previousSetsForName(" Deadlift ", history)).toEqual(previous);
  });

  test("a previous warm-up does not fill the next workout", () => {
    expect(
      prefillValues(
        "bench press",
        [],
        [
          { reps: 10, weightLb: 45, setType: "warmup" },
          { reps: 5, weightLb: 135, setType: "working" },
        ],
      ),
    ).toMatchObject({ reps: "5", weight: "135", setType: "working", source: "previous" });
    expect(
      prefillValues("bench press", [], [{ reps: 10, weightLb: 45, setType: "warmup" }], {
        reps: 8,
        weightLb: 95,
        durationSec: null,
        distanceM: null,
      }).source,
    ).toBe("routine");
  });
});
