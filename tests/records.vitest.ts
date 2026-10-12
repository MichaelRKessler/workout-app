import { describe, expect, test } from "vitest";
import {
  achievedRecord,
  announcedRecords,
  caloriesRecord,
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
      { weightLb: 0, durationSec: 60 },
      { reps: 5, weightLb: 50, distanceM: 2000 },
    ])).toBe(1250);
  });

  test("timed and distance records stay separate from lifting", () => {
    expect(
      personalRecordForSet("plank", { weightLb: 0, durationSec: 60 }, []),
    ).toMatchObject({ kind: "duration", durationSec: 60 });
    expect(
      personalRecordForSet("plank", { weightLb: 0, durationSec: 45 }, [
        { weightLb: 0, durationSec: 60 },
      ]),
    ).toBeNull();
    expect(
      personalRecordForSet("plank", { weightLb: 20, durationSec: 60 }, [
        { weightLb: 0, durationSec: 60 },
      ]),
    ).toMatchObject({ kind: "duration" });
    expect(
      personalRecordForSet("row", { weightLb: 0, distanceM: 2000 }, []),
    ).toMatchObject({ kind: "distance" });
    expect(
      personalRecordForSet("row", { weightLb: 0, distanceM: 2000, durationSec: 400 }, [
        { weightLb: 0, distanceM: 2000, durationSec: 500 },
      ]),
    ).toMatchObject({ kind: "distance" });
    expect(
      personalRecordForSet("row", { weightLb: 0, distanceM: 2000, durationSec: 400 }, [
        { weightLb: 0, distanceM: 2000 },
      ]),
    ).toBeNull();
    expect(
      personalRecordForSet("bench press", { reps: 5, weightLb: 135 }, [
        { weightLb: 0, durationSec: 600 },
      ]),
    ).toMatchObject({ kind: "both" });

    const distanceTrend = trendFromSets(
      [
        {
          _id: "a",
          sessionId: "old",
          weightLb: 0,
          distanceM: 1000,
          loggedAt: 1,
          sessionStartedAt: 1,
        },
        {
          _id: "b",
          sessionId: "new",
          weightLb: 0,
          distanceM: 2000,
          loggedAt: 2,
          sessionStartedAt: 2,
        },
      ],
      10,
    );
    expect(distanceTrend.unit).toBe("m");
    expect(distanceTrend.points.map((point) => point.value)).toEqual([1000, 2000]);
    expect(distanceTrend.points.map((point) => point.calories)).toEqual([null, null]);
  });

  test("the most calories in a session is a record, and it does not change time or distance", () => {
    const bike = (
      sessionId: string,
      calories: number,
      extra: { setType?: "warmup" | "drop" | "failure" | "working"; distanceM?: number; durationSec?: number } = {},
    ) => ({
      weightLb: 0,
      durationSec: extra.durationSec ?? 1800,
      distanceM: extra.distanceM ?? 19312,
      calories,
      sessionId,
      setType: extra.setType,
    });

    expect(caloriesRecord("bike", [bike("s1", 450)], [])).toMatchObject({
      kind: "calories",
      calories: 450,
    });
    expect(caloriesRecord("bike", [bike("s2", 450)], [bike("s1", 450)])).toBeNull();
    expect(caloriesRecord("bike", [bike("s2", 500)], [bike("s1", 450)])).toMatchObject({
      calories: 500,
    });
    expect(
      caloriesRecord(
        "bike",
        [
          bike("s1", 100, { setType: "warmup" }),
          bike("s1", 50, { setType: "drop" }),
          bike("s1", 200, { setType: "failure" }),
          bike("s1", 250),
        ],
        [],
      ),
    ).toMatchObject({ calories: 450 });
    expect(caloriesRecord("bike", [bike("s1", 200)], [bike("s1", 250)])).toMatchObject({
      calories: 450,
    });
    expect(
      caloriesRecord("bike", [bike("s1", 900, { setType: "warmup" })], [bike("s1", 450)]),
    ).toBeNull();
    expect(
      caloriesRecord("bike", [bike("morning", 450), bike("evening", 200)], []),
    ).toMatchObject({ calories: 450 });
    expect(
      caloriesRecord("bike", [bike("morning", 450), bike("evening", 600)], []),
    ).toMatchObject({ calories: 600 });

    const faster = announcedRecords(
      "bike",
      [bike("s2", 500, { durationSec: 400 })],
      [bike("s1", 100, { durationSec: 500 })],
    );
    expect(faster.records.map((record) => record.kind)).toEqual(["distance", "calories"]);
    expect(faster.headline?.kind).toBe("distance");

    const sameRide = announcedRecords(
      "bike",
      [bike("s2", 500, { durationSec: 500 })],
      [bike("s1", 100, { durationSec: 400 })],
    );
    expect(sameRide.records.map((record) => record.kind)).toEqual(["calories"]);
    expect(sameRide.headline?.kind).toBe("calories");
    expect(
      personalRecordForSet("bike", { weightLb: 0, distanceM: 19312, durationSec: 500, calories: 900 }, [
        { weightLb: 0, distanceM: 19312, durationSec: 400 },
      ]),
    ).toBeNull();

    expect(
      volumeLb([
        { reps: 5, weightLb: 100, calories: 300 },
        { weightLb: 0, durationSec: 60, calories: 450 },
      ]),
    ).toBe(500);

    const efforts = summarizeEfforts([
      { _id: "warm", sessionId: "a", weightLb: 0, durationSec: 600, calories: 900, loggedAt: 1, setType: "warmup" },
      { _id: "ride", sessionId: "a", weightLb: 0, durationSec: 1800, distanceM: 19312, calories: 200, loggedAt: 2 },
      { _id: "extra", sessionId: "a", weightLb: 0, durationSec: 600, calories: 250, loggedAt: 3 },
      { _id: "later", sessionId: "b", weightLb: 0, durationSec: 1800, distanceM: 19312, calories: 400, loggedAt: 4 },
    ]);
    expect(efforts.bestCalories).toEqual({ sessionId: "a", calories: 450, loggedAt: 2 });
    expect(efforts.bestDistance?.distanceM).toBe(19312);

    const trend = trendFromSets(
      [
        {
          _id: "ride",
          sessionId: "a",
          weightLb: 0,
          durationSec: 1800,
          distanceM: 19312,
          calories: 450,
          loggedAt: 2,
          sessionStartedAt: 1,
        },
        {
          _id: "warm",
          sessionId: "a",
          weightLb: 0,
          durationSec: 300,
          calories: 80,
          loggedAt: 1,
          sessionStartedAt: 1,
          setType: "warmup",
        },
      ],
      10,
    );
    expect(trend.unit).toBe("m");
    expect(trend.points[0]?.calories).toBe(450);
    expect(trend.points[0]?.volumeLb).toBe(0);
    expect(trend.points[0]?.bestDistanceSet).toEqual({
      reps: null,
      weightLb: 0,
      durationSec: 1800,
      distanceM: 19312,
    });
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
    expect(trend.points[0]?.volumeLb).toBe(8 * 140 + 5 * 150);
    expect(trend.points[0]?.topWeightLb).toBe(150);
    expect(trend.points[0]?.bestWeightSet).toMatchObject({ reps: 5, weightLb: 150 });
    expect(trend.points[0]?.bestEpleySet).toMatchObject({ reps: 8, weightLb: 140 });
  });

  test("warm-ups and drops stay off the record series, and drops stay in volume", () => {
    const trend = trendFromSets(
      [
        {
          _id: "warm",
          sessionId: "warm-only",
          reps: 10,
          weightLb: 300,
          loggedAt: 1,
          sessionStartedAt: 1,
          setType: "warmup",
        },
        {
          _id: "drop",
          sessionId: "work",
          reps: 8,
          weightLb: 100,
          loggedAt: 2,
          sessionStartedAt: 2,
          setType: "drop",
        },
        {
          _id: "work",
          sessionId: "work",
          reps: 5,
          weightLb: 135,
          loggedAt: 3,
          sessionStartedAt: 2,
          setType: "working",
        },
      ],
      10,
    );
    expect(trend.points.map((point) => point.sessionId)).toEqual(["work"]);
    expect(trend.points[0]?.value).toBe(epleyOneRepMax(135, 5));
    expect(trend.points[0]?.volumeLb).toBe(8 * 100 + 5 * 135);
    expect(trend.points[0]?.topWeightLb).toBe(135);
    expect(trend.points[0]?.epleyLb).toBe(epleyOneRepMax(135, 5));
    expect(trend.points[0]?.bestEpleySet).toMatchObject({ reps: 5, weightLb: 135 });
  });

  test("warm-ups skip records and volume, and drop sets skip records only", () => {
    expect(
      personalRecordForSet("bench press", { reps: 10, weightLb: 95, setType: "warmup" }, []),
    ).toBeNull();
    expect(
      personalRecordForSet("bench press", { reps: 5, weightLb: 135, setType: "working" }, [
        { reps: 10, weightLb: 225, setType: "warmup" },
        { reps: 3, weightLb: 185, setType: "drop" },
      ]),
    ).toMatchObject({ kind: "both" });
    expect(
      personalRecordForSet("bench press", { reps: 3, weightLb: 185, setType: "drop" }, []),
    ).toBeNull();
    expect(
      personalRecordForSet("bench press", { reps: 4, weightLb: 155, setType: "failure" }, [
        { reps: 5, weightLb: 135 },
      ]),
    ).toMatchObject({ kind: "both" });
    expect(
      volumeLb([
        { reps: 10, weightLb: 45, setType: "warmup" },
        { reps: 8, weightLb: 100, setType: "drop" },
        { reps: 5, weightLb: 50, setType: "failure" },
      ]),
    ).toBe(1050);
    const efforts = summarizeEfforts([
      { _id: "warm", sessionId: "a", reps: 10, weightLb: 300, loggedAt: 1, setType: "warmup" },
      { _id: "work", sessionId: "a", reps: 5, weightLb: 135, loggedAt: 2, setType: "working" },
    ]);
    expect(efforts.bestWeight?.setId).toBe("work");
  });
});

describe("records achieved in one workout", () => {
  test("merges a heavier load and a later estimate into one line", () => {
    const record = achievedRecord(
      "bench press",
      [
        { reps: 2, weightLb: 155 },
        { reps: 12, weightLb: 140 },
      ],
      [{ reps: 10, weightLb: 135 }],
    );
    expect(record).toMatchObject({ kind: "both", weightLb: 155, epleyLb: 196 });
  });

  test("warm-ups and drop sets do not become the workout record", () => {
    expect(
      achievedRecord(
        "bench press",
        [
          { reps: 10, weightLb: 300, setType: "warmup" },
          { reps: 3, weightLb: 225, setType: "drop" },
        ],
        [],
      ),
    ).toBeNull();
    expect(
      achievedRecord(
        "bench press",
        [
          { reps: 10, weightLb: 95, setType: "warmup" },
          { reps: 5, weightLb: 135, setType: "working" },
        ],
        [],
      ),
    ).toMatchObject({ kind: "both", weightLb: 135 });
  });
});
