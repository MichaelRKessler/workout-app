import { describe, expect, test } from "vitest";
import {
  absorbSet,
  comparisonPoints,
  emptyBests,
  type Bests,
  type JudgedSet,
} from "../convex/lib/recordBests";
import { announcedRecords, stampFromRecord } from "../convex/lib/records";
import type { SetType } from "../convex/lib/setType";
import { seeded } from "./seeded";

/**
 * Few distinct values, so ties are common: equal weight, equal time at the
 * same distance, equal session calories.
 */
function randomSet(random: ReturnType<typeof seeded>, index: number, sessionId: string): JudgedSet {
  const kind = random.pick(["strength", "bodyweight", "timed", "distance", "distance"]);
  const setType = random.pick<SetType>(["working", "working", "working", "warmup", "drop", "failure"]);
  const calories = random.next() < 0.3 ? random.pick([10, 20, 30, 50]) : null;
  const base = { setId: `set${index}`, sessionId, loggedAt: 1_000 + index, calories, setType };
  if (kind === "strength") {
    return {
      ...base,
      reps: random.pick([1, 3, 5, 5, 8, 10]),
      weightLb: random.pick([100, 135, 135, 185, 225]),
      durationSec: random.next() < 0.1 ? 40 : null,
      distanceM: null,
    };
  }
  if (kind === "bodyweight") {
    return { ...base, reps: random.pick([5, 8, 10, 12]), weightLb: 0, durationSec: null, distanceM: null };
  }
  if (kind === "timed") {
    return { ...base, reps: null, weightLb: random.pick([0, 0, 20, 45]), durationSec: random.pick([30, 60, 60, 90]), distanceM: null };
  }
  return {
    ...base,
    reps: random.next() < 0.2 ? 5 : null,
    weightLb: random.pick([0, 0, 50]),
    durationSec: random.pick([null, null, 1_400, 1_500, 1_500, 1_600]),
    distanceM: random.pick([1_000, 5_000, 5_000, 5_000]),
  };
}

function pointOf(set: JudgedSet) {
  return {
    reps: set.reps,
    weightLb: set.weightLb,
    durationSec: set.durationSec,
    distanceM: set.distanceM,
    calories: set.calories,
    setType: set.setType,
    sessionId: set.sessionId,
  };
}

describe("stored bests follow the scan rule", () => {
  test("5,000 m untimed, then in 1,500 s, makes 5,000 m in 1,400 s a record", () => {
    const sets: JudgedSet[] = [
      { setId: "a", sessionId: "s1", loggedAt: 1, reps: null, weightLb: 0, durationSec: null, distanceM: 5_000, calories: null, setType: "working" },
      { setId: "b", sessionId: "s2", loggedAt: 2, reps: null, weightLb: 0, durationSec: 1_500, distanceM: 5_000, calories: null, setType: "working" },
      { setId: "c", sessionId: "s3", loggedAt: 3, reps: null, weightLb: 0, durationSec: 1_400, distanceM: 5_000, calories: null, setType: "working" },
    ];
    let bests = emptyBests();
    const kinds: string[][] = [];
    for (const set of sets) {
      const folded = absorbSet("Run", bests, 0, set);
      kinds.push(folded.stamps.map((stamp) => stamp.kind));
      bests = folded.bests;
    }
    expect(kinds).toEqual([["distance"], [], ["distance"]]);
    const scan = announcedRecords("Run", [pointOf(sets[2]!)], sets.slice(0, 2).map(pointOf));
    expect(scan.headline?.kind).toBe("distance");
  });

  test("a pseudo-random history judges every set and batch the same way as the scan", () => {
    let judged = 0;
    let records = 0;
    for (let seed = 1; seed <= 200; seed += 1) {
      const random = seeded(seed);
      let bests: Bests = emptyBests();
      const totals = new Map<string, number>();
      const previous: Array<ReturnType<typeof pointOf>> = [];
      let session = 0;
      let index = 0;
      while (index < 120) {
        if (random.next() < 0.3) {
          session += 1;
        }
        const sessionId = `session${session}`;
        const size = random.pick([1, 1, 1, 2, 3, 4]);
        const batch = Array.from({ length: size }, (_, offset) => randomSet(random, index + offset, sessionId));
        index += size;
        const prior = totals.get(sessionId) ?? 0;

        // The announcement for a logged batch, from stored bests and from every earlier set.
        const stored = announcedRecords("Mixed", batch.map(pointOf), comparisonPoints(bests, sessionId, prior));
        const scanned = announcedRecords("Mixed", batch.map(pointOf), previous);
        expect(stored, `seed ${seed}, set ${index}`).toEqual(scanned);

        // Each set's stamps, folded one at a time the way the rebuild does.
        for (const set of batch) {
          const folded = absorbSet("Mixed", bests, totals.get(sessionId) ?? 0, set);
          const expected = announcedRecords("Mixed", [pointOf(set)], previous).records.map(stampFromRecord);
          expect(folded.stamps, `seed ${seed}, ${set.setId}`).toEqual(expected);
          judged += 1;
          records += expected.length > 0 ? 1 : 0;
          bests = folded.bests;
          totals.set(sessionId, folded.sessionCalories);
          previous.push(pointOf(set));
        }
      }
    }
    expect(judged).toBeGreaterThan(20_000);
    expect(records).toBeGreaterThan(1_000);
  });
});
