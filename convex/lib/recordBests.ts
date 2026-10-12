import { countsTowardRecord, type SetType } from "./setType";
import {
  announcedRecords,
  headlineRecord,
  stampFromRecord,
  type PersonalRecord,
  type RecordStamp,
} from "./records";

/** One stored best. Ids are strings so this module stays free of the database. */
export type BestSnap = {
  setId: string;
  sessionId: string;
  loggedAt: number;
  reps: number | null;
  weightLb: number;
  epleyLb: number | null;
  durationSec: number | null;
  distanceM: number | null;
};

export type CalorieSnap = {
  sessionId: string;
  calories: number;
  loggedAt: number;
};

export type Bests = {
  weight: BestSnap | null;
  epley: BestSnap | null;
  reps: BestSnap | null;
  duration: BestSnap | null;
  distance: BestSnap | null;
  calories: CalorieSnap | null;
  secondCalories: CalorieSnap | null;
};

export type MarkMetric = "weight" | "epley" | "reps" | "duration" | "distance" | "calories";

export type MarkDraft = {
  metric: MarkMetric;
  setId: string;
  sessionId: string;
  loggedAt: number;
  reps: number | null;
  weightLb: number;
  epleyLb: number | null;
  durationSec: number | null;
  distanceM: number | null;
  calories: number | null;
  otherSessionId: string | null;
  otherCalories: number | null;
};

export type JudgedSet = {
  setId: string;
  sessionId: string;
  loggedAt: number;
  reps: number | null;
  weightLb: number;
  durationSec: number | null;
  distanceM: number | null;
  calories: number | null;
  setType: SetType;
};

export function bestsFromStored(stats: {
  bestWeight: BestSnap | null;
  bestEpley: BestSnap | null;
  bestReps: BestSnap | null;
  bestDuration: BestSnap | null;
  bestDistance: BestSnap | null;
  bestCalories: CalorieSnap | null;
  secondCalories: CalorieSnap | null;
}): Bests {
  return {
    weight: stats.bestWeight,
    epley: stats.bestEpley,
    reps: stats.bestReps,
    duration: stats.bestDuration,
    distance: stats.bestDistance,
    calories: stats.bestCalories,
    secondCalories: stats.secondCalories,
  };
}

export function emptyBests(): Bests {
  return {
    weight: null,
    epley: null,
    reps: null,
    duration: null,
    distance: null,
    calories: null,
    secondCalories: null,
  };
}

export function countableCalories(set: {
  calories?: number | null;
  setType?: SetType | null;
}): number {
  if (!countsTowardRecord(set)) {
    return 0;
  }
  const calories = set.calories ?? 0;
  return calories > 0 ? calories : 0;
}

/** The best session total that is not `sessionId`, used when this workout is the record. */
export function otherCalorieSnap(bests: Bests, sessionId: string): CalorieSnap | null {
  if (bests.calories && bests.calories.sessionId !== sessionId) {
    return bests.calories;
  }
  if (bests.secondCalories && bests.secondCalories.sessionId !== sessionId) {
    return bests.secondCalories;
  }
  return null;
}

/**
 * Synthetic earlier sets that reproduce the stored bests.
 * Calorie points carry no reps, time, or distance, so they cannot become a
 * strength or cardio record.
 */
export function comparisonPoints(
  bests: Bests,
  sessionId: string,
  sessionCaloriesBefore: number,
): Array<{
  reps: number | null;
  weightLb: number;
  durationSec: number | null;
  distanceM: number | null;
  calories: number | null;
  setType: SetType;
  sessionId?: string;
}> {
  const points: Array<{
    reps: number | null;
    weightLb: number;
    durationSec: number | null;
    distanceM: number | null;
    calories: number | null;
    setType: SetType;
    sessionId?: string;
  }> = [];
  if (bests.weight && (bests.weight.reps ?? 0) > 0 && bests.weight.weightLb > 0) {
    points.push(metricPoint(bests.weight.reps, bests.weight.weightLb, null, null));
  }
  if (
    bests.epley &&
    bests.epley.setId !== bests.weight?.setId &&
    (bests.epley.reps ?? 0) > 0 &&
    bests.epley.weightLb > 0
  ) {
    points.push(metricPoint(bests.epley.reps, bests.epley.weightLb, null, null));
  }
  if (bests.reps && (bests.reps.reps ?? 0) > 0) {
    points.push(metricPoint(bests.reps.reps, 0, null, null));
  }
  if (bests.duration && (bests.duration.durationSec ?? 0) > 0) {
    points.push(metricPoint(null, bests.duration.weightLb, bests.duration.durationSec, null));
  }
  if (bests.distance && (bests.distance.distanceM ?? 0) > 0) {
    points.push(
      metricPoint(null, bests.distance.weightLb, bests.distance.durationSec, bests.distance.distanceM),
    );
  }
  const other = otherCalorieSnap(bests, sessionId);
  if (other && other.calories > 0) {
    points.push({
      reps: null,
      weightLb: 0,
      durationSec: null,
      distanceM: null,
      calories: other.calories,
      setType: "working",
      sessionId: other.sessionId,
    });
  }
  if (sessionCaloriesBefore > 0) {
    points.push({
      reps: null,
      weightLb: 0,
      durationSec: null,
      distanceM: null,
      calories: sessionCaloriesBefore,
      setType: "working",
      sessionId,
    });
  }
  return points;
}

function metricPoint(
  reps: number | null,
  weightLb: number,
  durationSec: number | null,
  distanceM: number | null,
) {
  return {
    reps,
    weightLb,
    durationSec,
    distanceM,
    calories: null,
    setType: "working" as const,
  };
}

export function absorbSet(
  exerciseName: string,
  bests: Bests,
  sessionCaloriesBefore: number,
  set: JudgedSet,
): { bests: Bests; stamps: RecordStamp[]; sessionCalories: number; marks: MarkDraft[] } {
  const point = {
    reps: set.reps,
    weightLb: set.weightLb,
    durationSec: set.durationSec,
    distanceM: set.distanceM,
    calories: set.calories,
    setType: set.setType,
    sessionId: set.sessionId,
  };
  const previous = comparisonPoints(bests, set.sessionId, sessionCaloriesBefore);
  const announced = announcedRecords(exerciseName, [point], previous);
  const stamps = announced.records.map((record) => stampFromRecord(record));
  const snap = snapFromSet(set, announced.headline);
  let next = applyPrimary(bests, snap, announced.headline);
  const sessionCalories = sessionCaloriesBefore + countableCalories(set);
  const calorieRecord = announced.records.find((record) => record.kind === "calories");
  if (calorieRecord && calorieRecord.calories !== null) {
    next = promoteCalories(next, {
      sessionId: set.sessionId,
      calories: calorieRecord.calories,
      loggedAt: set.loggedAt,
    });
  } else if (countableCalories(set) > 0) {
    next = noteSessionCalories(next, {
      sessionId: set.sessionId,
      calories: sessionCalories,
      loggedAt: set.loggedAt,
    });
  }
  return {
    bests: next,
    stamps,
    sessionCalories,
    marks: marksForChange(bests, next, snap),
  };
}

export function headlineFromStamps(
  exerciseName: string,
  stamps: RecordStamp[],
): PersonalRecord | null {
  const records = stamps.map((stamp) => ({ exerciseName, ...stamp }));
  const primary = records.find((record) => record.kind !== "calories") ?? null;
  const calories = records.find((record) => record.kind === "calories") ?? null;
  return headlineRecord(primary, calories);
}

function snapFromSet(set: JudgedSet, headline: PersonalRecord | null): BestSnap {
  return {
    setId: set.setId,
    sessionId: set.sessionId,
    loggedAt: set.loggedAt,
    reps: set.reps,
    weightLb: set.weightLb,
    epleyLb: headline?.epleyLb ?? null,
    durationSec: set.durationSec,
    distanceM: set.distanceM,
  };
}

function applyPrimary(bests: Bests, snap: BestSnap, headline: PersonalRecord | null): Bests {
  if (!headline || headline.kind === "calories") {
    return bests;
  }
  const next = { ...bests };
  if (headline.kind === "weight" || headline.kind === "both") {
    next.weight = { ...snap, epleyLb: headline.epleyLb };
  }
  if (headline.kind === "epley" || headline.kind === "both") {
    next.epley = { ...snap, epleyLb: headline.epleyLb };
  }
  if (headline.kind === "reps") {
    next.reps = snap;
  }
  if (headline.kind === "duration") {
    next.duration = snap;
  }
  if (headline.kind === "distance") {
    next.distance = snap;
  }
  return next;
}

function promoteCalories(bests: Bests, snap: CalorieSnap): Bests {
  const best = bests.calories;
  if (!best || snap.calories > best.calories) {
    let second = bests.secondCalories;
    if (best && best.sessionId !== snap.sessionId) {
      second = best;
    } else if (second && second.sessionId === snap.sessionId) {
      second = null;
    }
    return { ...bests, calories: snap, secondCalories: second };
  }
  return noteSessionCalories(bests, snap);
}

function noteSessionCalories(bests: Bests, snap: CalorieSnap): Bests {
  const best = bests.calories;
  if (best && best.sessionId === snap.sessionId) {
    if (snap.calories > best.calories) {
      return { ...bests, calories: snap };
    }
    return bests;
  }
  const second = bests.secondCalories;
  if (!second || second.sessionId === snap.sessionId || snap.calories > second.calories) {
    return { ...bests, secondCalories: snap };
  }
  return bests;
}

function marksForChange(before: Bests, after: Bests, snap: BestSnap): MarkDraft[] {
  const marks: MarkDraft[] = [];
  const metrics = ["weight", "epley", "reps", "duration", "distance"] as const;
  for (const metric of metrics) {
    const next = after[metric];
    if (!next || next.setId === before[metric]?.setId) {
      continue;
    }
    marks.push(markFromSnap(metric, next));
  }
  const calories = after.calories;
  if (
    calories &&
    (calories.sessionId !== before.calories?.sessionId ||
      calories.calories !== before.calories?.calories ||
      calories.loggedAt !== before.calories?.loggedAt)
  ) {
    const other = otherCalorieSnap(after, calories.sessionId);
    marks.push({
      metric: "calories",
      setId: snap.setId,
      sessionId: calories.sessionId,
      loggedAt: snap.loggedAt,
      reps: null,
      weightLb: 0,
      epleyLb: null,
      durationSec: null,
      distanceM: null,
      calories: calories.calories,
      otherSessionId: other?.sessionId ?? null,
      otherCalories: other?.calories ?? null,
    });
  }
  return marks;
}

function markFromSnap(metric: MarkMetric, snap: BestSnap): MarkDraft {
  return {
    metric,
    setId: snap.setId,
    sessionId: snap.sessionId,
    loggedAt: snap.loggedAt,
    reps: snap.reps,
    weightLb: snap.weightLb,
    epleyLb: snap.epleyLb,
    durationSec: snap.durationSec,
    distanceM: snap.distanceM,
    calories: null,
    otherSessionId: null,
    otherCalories: null,
  };
}
