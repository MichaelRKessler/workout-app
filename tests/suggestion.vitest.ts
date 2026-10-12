import { describe, expect, test } from "vitest";
import { fromPounds, toPounds } from "../convex/lib/units";
import { formatSuggestion, suggestNext } from "../lib/suggestion";

const options = { enabled: true, incrementLb: 5 };

describe("suggested next weight", () => {
  test("adds the increment when every working set hit the same reps", () => {
    expect(
      suggestNext(
        [
          { reps: 5, weightLb: 135 },
          { reps: 5, weightLb: 135 },
        ],
        options,
      ),
    ).toEqual({ kind: "weight", weightLb: 140 });
  });

  test("uses a routine target and ignores warm-ups and drop sets", () => {
    expect(
      suggestNext(
        [
          { reps: 10, weightLb: 45, setType: "warmup" },
          { reps: 5, weightLb: 135, setType: "working" },
          { reps: 5, weightLb: 135, setType: "failure" },
          { reps: 8, weightLb: 95, setType: "drop" },
        ],
        { ...options, routine: { targetSets: 2, targetReps: 5 } },
      ),
    ).toEqual({ kind: "weight", weightLb: 140 });
  });

  test("stays quiet when reps differ, a target was missed, or suggestions are off", () => {
    expect(
      suggestNext(
        [
          { reps: 5, weightLb: 135 },
          { reps: 4, weightLb: 135 },
        ],
        options,
      ),
    ).toBeNull();
    expect(
      suggestNext(
        [
          { reps: 5, weightLb: 135 },
          { reps: 3, weightLb: 135 },
        ],
        { ...options, routine: { targetReps: 5, targetSets: 2 } },
      ),
    ).toBeNull();
    expect(
      suggestNext([{ reps: 5, weightLb: 135 }], { enabled: false, incrementLb: 5 }),
    ).toBeNull();
  });

  test("skips timed work and suggests two more reps for bodyweight", () => {
    expect(suggestNext([{ weightLb: 0, durationSec: 60 }], options)).toBeNull();
    expect(suggestNext([{ reps: 12, weightLb: 0 }], options)).toEqual({ kind: "reps", reps: 14 });
    expect(formatSuggestion({ kind: "weight", weightLb: 140 }, "lb")).toBe("Try 140 lb today");
    expect(formatSuggestion({ kind: "reps", reps: 14 }, "lb")).toBe("Try 14 reps today");
  });

  test("calories on a set do not change the next weight", () => {
    const withCalories = [
      { reps: 5, weightLb: 135, calories: 80 },
      { reps: 5, weightLb: 135, calories: 90 },
    ];
    expect(suggestNext(withCalories, options)).toEqual({ kind: "weight", weightLb: 140 });
    expect(
      suggestNext([{ weightLb: 0, durationSec: 1800, distanceM: 19312, calories: 450 }], options),
    ).toBeNull();
  });

  test("a kilogram default is 2.5 kg, not a conversion of 5 lb", () => {
    const next = suggestNext([{ reps: 8, weightLb: toPounds(60, "kg") }], {
      enabled: true,
      incrementLb: toPounds(2.5, "kg"),
      unit: "kg",
    });
    expect(next).toEqual({ kind: "weight", weightLb: toPounds(62.5, "kg") });
  });

  test("repeated kilogram steps stay on the plate", () => {
    let weightLb = toPounds(60, "kg");
    for (let step = 0; step < 9; step += 1) {
      const next = suggestNext([{ reps: 8, weightLb }], {
        enabled: true,
        incrementLb: toPounds(2.5, "kg"),
        unit: "kg",
      });
      expect(next?.kind).toBe("weight");
      if (next?.kind === "weight") {
        weightLb = next.weightLb;
      }
    }
    expect(fromPounds(weightLb, "kg")).toBe(82.5);
    expect(formatSuggestion({ kind: "weight", weightLb }, "kg")).toBe("Try 82.5 kg today");
  });
});
