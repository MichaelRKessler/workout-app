import { describe, expect, test } from "vitest";
import {
  epleyOneRepMax,
  personalRecordForBatch,
  personalRecordForSet,
  summarizeEfforts,
  trendFromSets,
  volumeLb,
} from "../convex/lib/records";

describe("estimated one-rep max", () => {
  test("uses the Epley formula and skips bodyweight", () => {
    expect(epleyOneRepMax(225, 5)).toBe(262.5);
    expect(epleyOneRepMax(135, 10)).toBe(180);
    expect(epleyOneRepMax(100, 1)).toBeCloseTo(103.33, 2);
    expect(epleyOneRepMax(0, 20)).toBeNull();
  });
});

describe("personal records", () => {
  test("the first set counts, and a tie does not", () => {
    expect(
      personalRecordForSet("bench press", { reps: 5, weightLb: 135 }, []),
    ).toMatchObject({ kind: "both", epleyLb: 157.5 });
    expect(
      personalRecordForSet("bench press", { reps: 5, weightLb: 135 }, [
        { reps: 5, weightLb: 135 },
      ]),
    ).toBeNull();
    // 155×2 is heavier than 135, but its Epley (165.33) stays under 135×10 (180).
    expect(
      personalRecordForSet("bench press", { reps: 2, weightLb: 155 }, [
        { reps: 10, weightLb: 135 },
      ]),
    ).toMatchObject({ kind: "weight" });
    expect(
      personalRecordForSet("bench press", { reps: 12, weightLb: 135 }, [
        { reps: 5, weightLb: 155 },
      ])?.kind,
    ).toBe("epley");
    expect(
      personalRecordForSet("push-ups", { reps: 20, weightLb: 0 }, []),
    ).toMatchObject({ kind: "reps", reps: 20 });
    expect(
      personalRecordForSet("push-ups", { reps: 15, weightLb: 0 }, [
        { reps: 20, weightLb: 0 },
      ]),
    ).toBeNull();
  });

  test("a batch reports the last set that set a record", () => {
    const record = personalRecordForBatch(
      "squat",
      [
        { reps: 5, weightLb: 185 },
        { reps: 5, weightLb: 205 },
      ],
      [{ reps: 5, weightLb: 135 }],
    );
    expect(record).toMatchObject({ kind: "both", weightLb: 205 });
  });
});

describe("best efforts and volume", () => {
  test("keeps the heaviest load and the best estimate, and ignores bodyweight in volume", () => {
    const efforts = summarizeEfforts([
      { _id: "light", sessionId: "a", reps: 10, weightLb: 135, loggedAt: 1 },
      { _id: "heavy", sessionId: "b", reps: 3, weightLb: 225, loggedAt: 2 },
      // 185×12 estimates 259 lb, above 225×3 (247.5), without being the heaviest load.
      { _id: "volume", sessionId: "c", reps: 12, weightLb: 185, loggedAt: 3 },
      { _id: "bw", sessionId: "d", reps: 20, weightLb: 0, loggedAt: 4 },
    ]);
    expect(efforts.bestWeight?.setId).toBe("heavy");
    expect(efforts.bestEpley?.setId).toBe("volume");
    expect(efforts.bestBodyweight?.reps).toBe(20);
    expect(volumeLb([
      { reps: 10, weightLb: 100 },
      { reps: 20, weightLb: 0 },
    ])).toBe(1000);
  });

  test("the trend is one point per workout, oldest first", () => {
    const trend = trendFromSets(
      [
        { _id: "1", sessionId: "new", reps: 5, weightLb: 200, loggedAt: 20, sessionStartedAt: 20 },
        { _id: "2", sessionId: "old", reps: 5, weightLb: 150, loggedAt: 10, sessionStartedAt: 10 },
        { _id: "3", sessionId: "old", reps: 8, weightLb: 140, loggedAt: 11, sessionStartedAt: 10 },
      ],
      10,
    );
    expect(trend.unit).toBe("lb");
    expect(trend.points.map((point) => point.sessionId)).toEqual(["old", "new"]);
    expect(trend.points[0]?.value).toBe(epleyOneRepMax(140, 8));
  });
});
