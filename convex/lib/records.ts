import { v } from "convex/values";
import { setKind } from "./measures";
import { countsTowardRecord, countsTowardVolume, resolvedSetType, type SetType } from "./setType";

/** Epley estimate: weight × (1 + reps / 30). Bodyweight has no estimate. */
export function epleyOneRepMax(weightLb: number, reps: number): number | null {
  if (!(weightLb > 0) || !Number.isFinite(weightLb) || !Number.isFinite(reps) || reps < 1) {
    return null;
  }
  return Math.round(weightLb * (1 + reps / 30) * 100) / 100;
}

export const personalRecordValidator = v.object({
  exerciseName: v.string(),
  kind: v.union(
    v.literal("weight"),
    v.literal("epley"),
    v.literal("both"),
    v.literal("reps"),
    v.literal("duration"),
    v.literal("distance"),
  ),
  reps: v.union(v.number(), v.null()),
  weightLb: v.number(),
  epleyLb: v.union(v.number(), v.null()),
  durationSec: v.union(v.number(), v.null()),
  distanceM: v.union(v.number(), v.null()),
});

export type RecordKind = "weight" | "epley" | "both" | "reps" | "duration" | "distance";

export type PersonalRecord = {
  exerciseName: string;
  kind: RecordKind;
  reps: number | null;
  weightLb: number;
  epleyLb: number | null;
  durationSec: number | null;
  distanceM: number | null;
};

type SetPoint = {
  reps?: number | null;
  weightLb: number;
  durationSec?: number | null;
  distanceM?: number | null;
  setType?: SetType | null;
};

/**
 * A set is a PR when it beats this exercise's previous best.
 * Weighted sets can beat the heaviest load, the best Epley estimate, or both.
 * Bodyweight sets (0 lb) can beat the most reps. The first set of either kind counts.
 * Ties do not.
 */
function recordBase(
  exerciseName: string,
  kind: RecordKind,
  set: SetPoint,
  epleyLb: number | null,
): PersonalRecord {
  return {
    exerciseName,
    kind,
    reps: set.reps ?? null,
    weightLb: set.weightLb,
    epleyLb,
    durationSec: set.durationSec ?? null,
    distanceM: set.distanceM ?? null,
  };
}

export function personalRecordForSet(
  exerciseName: string,
  set: SetPoint,
  previous: SetPoint[],
): PersonalRecord | null {
  if (!countsTowardRecord(set)) {
    return null;
  }
  const earlier = previous.filter((item) => countsTowardRecord(item));
  const kind = setKind(set);
  if (kind === "timed") {
    return durationRecord(exerciseName, set, earlier);
  }
  if (kind === "distance") {
    return distanceRecord(exerciseName, set, earlier);
  }
  return strengthRecord(exerciseName, set, earlier);
}

function durationRecord(
  exerciseName: string,
  set: SetPoint,
  previous: SetPoint[],
): PersonalRecord | null {
  const duration = set.durationSec ?? 0;
  if (duration <= 0) {
    return null;
  }
  let best = 0;
  let bestWeight = -1;
  for (const earlier of previous) {
    if (setKind(earlier) !== "timed") {
      continue;
    }
    const earlierDuration = earlier.durationSec ?? 0;
    if (earlierDuration > best || (earlierDuration === best && earlier.weightLb > bestWeight)) {
      best = earlierDuration;
      bestWeight = earlier.weightLb;
    }
  }
  const longer = duration > best;
  const heavierTie = duration === best && best > 0 && set.weightLb > bestWeight;
  if (!longer && !heavierTie) {
    return null;
  }
  return recordBase(exerciseName, "duration", set, null);
}

function distanceRecord(
  exerciseName: string,
  set: SetPoint,
  previous: SetPoint[],
): PersonalRecord | null {
  const distance = set.distanceM ?? 0;
  if (distance <= 0) {
    return null;
  }
  let bestDistance = 0;
  let bestTime: number | null = null;
  for (const earlier of previous) {
    if (setKind(earlier) !== "distance") {
      continue;
    }
    const earlierDistance = earlier.distanceM ?? 0;
    if (earlierDistance > bestDistance) {
      bestDistance = earlierDistance;
      bestTime = earlier.durationSec ?? null;
    } else if (earlierDistance === bestDistance && earlierDistance > 0) {
      const time = earlier.durationSec ?? null;
      if (time !== null && (bestTime === null || time < bestTime)) {
        bestTime = time;
      }
    }
  }
  if (distance > bestDistance) {
    return recordBase(exerciseName, "distance", set, null);
  }
  const time = set.durationSec ?? null;
  if (
    distance === bestDistance &&
    time !== null &&
    bestTime !== null &&
    time < bestTime
  ) {
    return recordBase(exerciseName, "distance", set, null);
  }
  return null;
}

function strengthRecord(
  exerciseName: string,
  set: SetPoint,
  previous: SetPoint[],
): PersonalRecord | null {
  const reps = set.reps ?? 0;
  if (reps < 1) {
    return null;
  }
  const earlierSets = previous.filter((earlier) => setKind(earlier) === "strength");
  if (set.weightLb <= 0) {
    let bestReps = 0;
    for (const earlier of earlierSets) {
      const earlierReps = earlier.reps ?? 0;
      if (earlier.weightLb <= 0 && earlierReps > bestReps) {
        bestReps = earlierReps;
      }
    }
    if (reps <= bestReps) {
      return null;
    }
    return recordBase(exerciseName, "reps", { ...set, reps, weightLb: 0 }, null);
  }

  let bestWeight = 0;
  let bestEpley = 0;
  for (const earlier of earlierSets) {
    const earlierReps = earlier.reps ?? 0;
    if (earlier.weightLb > bestWeight) {
      bestWeight = earlier.weightLb;
    }
    const earlierEpley = epleyOneRepMax(earlier.weightLb, earlierReps);
    if (earlierEpley !== null && earlierEpley > bestEpley) {
      bestEpley = earlierEpley;
    }
  }

  const epleyLb = epleyOneRepMax(set.weightLb, reps);
  const beatWeight = set.weightLb > bestWeight;
  const beatEpley = epleyLb !== null && epleyLb > bestEpley;
  if (!beatWeight && !beatEpley) {
    return null;
  }
  return recordBase(
    exerciseName,
    beatWeight && beatEpley ? "both" : beatWeight ? "weight" : "epley",
    { ...set, reps },
    epleyLb,
  );
}

/** The last new record in a batch, judged in the order the sets were logged. */
export function personalRecordForBatch(
  exerciseName: string,
  created: SetPoint[],
  previous: SetPoint[],
): PersonalRecord | null {
  const baseline = previous.map((set) => ({
    reps: set.reps,
    weightLb: set.weightLb,
    durationSec: set.durationSec,
    distanceM: set.distanceM,
    setType: resolvedSetType(set.setType),
  }));
  let latest: PersonalRecord | null = null;
  for (const set of created) {
    const record = personalRecordForSet(exerciseName, set, baseline);
    if (record) {
      latest = record;
    }
    baseline.push({
      reps: set.reps,
      weightLb: set.weightLb,
      durationSec: set.durationSec,
      distanceM: set.distanceM,
      setType: resolvedSetType(set.setType),
    });
  }
  return latest;
}

export type Effort = {
  setId: string;
  sessionId: string;
  reps: number | null;
  weightLb: number;
  epleyLb: number | null;
  durationSec: number | null;
  distanceM: number | null;
  loggedAt: number;
};

type EffortSet = {
  _id: string;
  sessionId: string;
  reps?: number | null;
  weightLb: number;
  durationSec?: number | null;
  distanceM?: number | null;
  loggedAt: number;
  setType?: SetType | null;
};

function toEffort(set: EffortSet, epleyLb: number | null): Effort {
  return {
    setId: set._id,
    sessionId: set.sessionId,
    reps: set.reps ?? null,
    weightLb: set.weightLb,
    epleyLb,
    durationSec: set.durationSec ?? null,
    distanceM: set.distanceM ?? null,
    loggedAt: set.loggedAt,
  };
}

/**
 * Best efforts in a set list. Equal results keep the earlier one, except the
 * heaviest weight prefers more reps before it prefers the earlier set.
 */
export function summarizeEfforts(sets: EffortSet[]): {
  bestWeight: Effort | null;
  bestEpley: Effort | null;
  bestBodyweight: Effort | null;
  bestDuration: Effort | null;
  bestDistance: Effort | null;
} {
  let bestWeight: Effort | null = null;
  let bestEpley: Effort | null = null;
  let bestBodyweight: Effort | null = null;
  let bestDuration: Effort | null = null;
  let bestDistance: Effort | null = null;

  for (const set of sets) {
    if (!countsTowardRecord(set)) {
      continue;
    }
    const kind = setKind(set);
    if (kind === "timed") {
      const duration = set.durationSec ?? 0;
      const current = bestDuration?.durationSec ?? 0;
      const longer = bestDuration === null || duration > current;
      const heavierTie =
        bestDuration !== null &&
        duration === current &&
        set.weightLb > bestDuration.weightLb;
      const earlierTie =
        bestDuration !== null &&
        duration === current &&
        set.weightLb === bestDuration.weightLb &&
        set.loggedAt < bestDuration.loggedAt;
      if (longer || heavierTie || earlierTie) {
        bestDuration = toEffort(set, null);
      }
      continue;
    }
    if (kind === "distance") {
      const distance = set.distanceM ?? 0;
      const current = bestDistance?.distanceM ?? 0;
      const farther = bestDistance === null || distance > current;
      const fasterTie =
        bestDistance !== null &&
        distance === current &&
        set.durationSec != null &&
        bestDistance.durationSec != null &&
        set.durationSec < bestDistance.durationSec;
      const earlierTie =
        bestDistance !== null &&
        distance === current &&
        set.durationSec === bestDistance.durationSec &&
        set.loggedAt < bestDistance.loggedAt;
      if (farther || fasterTie || earlierTie) {
        bestDistance = toEffort(set, null);
      }
      continue;
    }

    const reps = set.reps ?? 0;
    if (reps < 1) {
      continue;
    }
    if (set.weightLb <= 0) {
      const betterReps = bestBodyweight === null || reps > (bestBodyweight.reps ?? 0);
      const earlierTie =
        bestBodyweight !== null &&
        reps === bestBodyweight.reps &&
        set.loggedAt < bestBodyweight.loggedAt;
      if (betterReps || earlierTie) {
        bestBodyweight = toEffort(set, null);
      }
      continue;
    }

    const epleyLb = epleyOneRepMax(set.weightLb, reps);
    const effort = toEffort(set, epleyLb);
    if (bestWeight === null || set.weightLb > bestWeight.weightLb) {
      bestWeight = effort;
    } else if (set.weightLb === bestWeight.weightLb && reps > (bestWeight.reps ?? 0)) {
      bestWeight = effort;
    } else if (
      set.weightLb === bestWeight.weightLb &&
      reps === bestWeight.reps &&
      set.loggedAt < bestWeight.loggedAt
    ) {
      bestWeight = effort;
    }

    if (epleyLb === null) {
      continue;
    }
    if (bestEpley === null || bestEpley.epleyLb === null || epleyLb > bestEpley.epleyLb) {
      bestEpley = effort;
    } else if (epleyLb === bestEpley.epleyLb && set.loggedAt < bestEpley.loggedAt) {
      bestEpley = effort;
    }
  }

  return { bestWeight, bestEpley, bestBodyweight, bestDuration, bestDistance };
}

export type TrendSetSnap = {
  reps: number | null;
  weightLb: number;
  durationSec: number | null;
  distanceM: number | null;
};

export type TrendPoint = {
  sessionId: string;
  startedAt: number;
  /** Best record metric in that workout. Null when every set was a warm-up or drop. */
  value: number | null;
  /** Reps × weight for the workout, in pounds. Warm-ups add nothing. Drop sets count. */
  volumeLb: number;
  /** Heaviest counted load. Warm-ups and drop sets are excluded. */
  topWeightLb: number | null;
  epleyLb: number | null;
  reps: number | null;
  durationSec: number | null;
  distanceM: number | null;
  bestEpleySet: TrendSetSnap | null;
  bestWeightSet: TrendSetSnap | null;
  bestRepsSet: TrendSetSnap | null;
  bestDurationSet: TrendSetSnap | null;
  bestDistanceSet: TrendSetSnap | null;
};

/**
 * One point per workout, oldest first. Weighted exercises chart the best Epley
 * estimate in that workout. An exercise that has never used weight charts the
 * most reps instead. Warm-ups and drop sets are left out of `value`. Volume
 * still includes drop sets and failure sets.
 */
export type TrendUnit = "lb" | "reps" | "m" | "sec";

export function trendFromSets(
  sets: Array<EffortSet & { sessionStartedAt: number }>,
  maxPoints: number,
): { unit: TrendUnit; points: TrendPoint[] } {
  const recordSets = sets.filter((set) => countsTowardRecord(set));
  const volumeSets = sets.filter((set) => countsTowardVolume(set));
  const unitSource = recordSets.length > 0 ? recordSets : volumeSets;
  const weighted = unitSource.some((set) => setKind(set) === "strength" && set.weightLb > 0);
  const strength = unitSource.some((set) => setKind(set) === "strength" && (set.reps ?? 0) > 0);
  const distance = unitSource.some((set) => setKind(set) === "distance");
  const unit: TrendUnit = weighted ? "lb" : strength ? "reps" : distance ? "m" : "sec";
  const bySession = new Map<string, TrendPoint>();
  for (const set of sets) {
    const existing = bySession.get(set.sessionId) ?? blankTrendPoint(set.sessionId, set.sessionStartedAt);
    if (countsTowardVolume(set)) {
      const reps = set.reps ?? 0;
      if (reps > 0 && set.weightLb > 0) {
        existing.volumeLb = Math.round((existing.volumeLb + reps * set.weightLb) * 100) / 100;
      }
    }
    if (countsTowardRecord(set)) {
      considerRecord(existing, set);
      const value = trendValue(set, unit);
      if (value !== null && (existing.value === null || value > existing.value)) {
        existing.value = value;
      }
    }
    bySession.set(set.sessionId, existing);
  }
  const points = [...bySession.values()]
    .filter((point) => point.value !== null || point.volumeLb > 0)
    .sort((left, right) => {
      if (left.startedAt !== right.startedAt) {
        return left.startedAt - right.startedAt;
      }
      return left.sessionId < right.sessionId ? -1 : 1;
    });
  return {
    unit,
    points: points.slice(-maxPoints),
  };
}

/**
 * The record this exercise set during one workout, compared with earlier sets.
 * One line per exercise: a later set in the same workout replaces an earlier
 * record, and beating both load and the Epley estimate is reported as both.
 */
export function achievedRecord(
  exerciseName: string,
  created: SetPoint[],
  previous: SetPoint[],
): PersonalRecord | null {
  const baseline = previous.map((set) => ({
    reps: set.reps,
    weightLb: set.weightLb,
    durationSec: set.durationSec,
    distanceM: set.distanceM,
    setType: resolvedSetType(set.setType),
  }));
  let latest: PersonalRecord | null = null;
  let sawWeight = false;
  let sawEpley = false;
  let heaviest = 0;
  let heaviestReps: number | null = null;
  let bestEpley = 0;
  for (const set of created) {
    const record = personalRecordForSet(exerciseName, set, baseline);
    if (record) {
      latest = record;
      if (record.kind === "weight" || record.kind === "both") {
        sawWeight = true;
        if (record.weightLb >= heaviest) {
          heaviest = record.weightLb;
          heaviestReps = record.reps;
        }
      }
      if ((record.kind === "epley" || record.kind === "both") && record.epleyLb !== null) {
        sawEpley = true;
        if (record.epleyLb >= bestEpley) {
          bestEpley = record.epleyLb;
        }
      }
    }
    baseline.push({
      reps: set.reps,
      weightLb: set.weightLb,
      durationSec: set.durationSec,
      distanceM: set.distanceM,
      setType: resolvedSetType(set.setType),
    });
  }
  if (!latest) {
    return null;
  }
  if (
    sawWeight &&
    sawEpley &&
    latest.kind !== "reps" &&
    latest.kind !== "duration" &&
    latest.kind !== "distance"
  ) {
    return {
      ...latest,
      kind: "both",
      weightLb: heaviest,
      reps: heaviestReps,
      epleyLb: bestEpley,
    };
  }
  return latest;
}

function blankTrendPoint(sessionId: string, startedAt: number): TrendPoint {
  return {
    sessionId,
    startedAt,
    value: null,
    volumeLb: 0,
    topWeightLb: null,
    epleyLb: null,
    reps: null,
    durationSec: null,
    distanceM: null,
    bestEpleySet: null,
    bestWeightSet: null,
    bestRepsSet: null,
    bestDurationSet: null,
    bestDistanceSet: null,
  };
}

function snapOf(set: EffortSet): TrendSetSnap {
  return {
    reps: set.reps ?? null,
    weightLb: set.weightLb,
    durationSec: set.durationSec ?? null,
    distanceM: set.distanceM ?? null,
  };
}

/** Record metrics ignore warm-ups and drop sets. The caller already filtered those. */
function considerRecord(existing: TrendPoint, set: EffortSet) {
  const kind = setKind(set);
  if (kind === "timed") {
    const duration = set.durationSec ?? 0;
    if (duration <= 0) return;
    const current = existing.durationSec;
    const heavierTie =
      current === duration && set.weightLb > (existing.bestDurationSet?.weightLb ?? -1);
    if (current === null || duration > current || heavierTie) {
      existing.durationSec = duration;
      existing.bestDurationSet = snapOf(set);
    }
    return;
  }
  if (kind === "distance") {
    const distance = set.distanceM ?? 0;
    if (distance <= 0) return;
    const current = existing.distanceM;
    const fasterTie =
      current === distance &&
      set.durationSec != null &&
      (existing.bestDistanceSet?.durationSec == null ||
        set.durationSec < existing.bestDistanceSet.durationSec);
    if (current === null || distance > current || fasterTie) {
      existing.distanceM = distance;
      existing.bestDistanceSet = snapOf(set);
    }
    return;
  }

  const reps = set.reps ?? 0;
  if (reps < 1) return;
  if (existing.reps === null || reps > existing.reps) {
    existing.reps = reps;
    existing.bestRepsSet = snapOf(set);
  }
  if (set.weightLb <= 0) return;

  const currentWeight = existing.topWeightLb;
  const moreRepsAtSameWeight =
    currentWeight === set.weightLb && reps > (existing.bestWeightSet?.reps ?? 0);
  if (currentWeight === null || set.weightLb > currentWeight || moreRepsAtSameWeight) {
    existing.topWeightLb = set.weightLb;
    existing.bestWeightSet = snapOf(set);
  }
  const epley = epleyOneRepMax(set.weightLb, reps);
  if (epley !== null && (existing.epleyLb === null || epley > existing.epleyLb)) {
    existing.epleyLb = epley;
    existing.bestEpleySet = snapOf(set);
  }
}

function trendValue(set: EffortSet, unit: TrendUnit): number | null {
  if (unit === "lb") {
    return setKind(set) === "strength" ? epleyOneRepMax(set.weightLb, set.reps ?? 0) : null;
  }
  if (unit === "reps") {
    return setKind(set) === "strength" && (set.reps ?? 0) > 0 ? (set.reps ?? 0) : null;
  }
  if (unit === "m") {
    return setKind(set) === "distance" ? (set.distanceM ?? null) : null;
  }
  return setKind(set) === "timed" ? (set.durationSec ?? null) : null;
}

/**
 * Reps × weight, in pounds. Bodyweight, timed, distance-only, and warm-up
 * sets add nothing. A timed or distance set that also has reps still counts
 * those reps. Drop sets and failure sets count.
 */
export function volumeLb(
  sets: Array<{ reps?: number | null; weightLb: number; setType?: SetType | null }>,
): number {
  let total = 0;
  for (const set of sets) {
    if (!countsTowardVolume(set)) {
      continue;
    }
    const reps = set.reps ?? 0;
    if (reps > 0 && set.weightLb > 0) {
      total += reps * set.weightLb;
    }
  }
  return Math.round(total * 100) / 100;
}
