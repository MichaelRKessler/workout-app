import { MAX_CALORIES, setKind } from "./measures";
import { CALORIES_MESSAGE, MAX_REPS, MIN_REPS, REPS_MESSAGE, TIME_MESSAGE, wholeInRange } from "./setLimits";
import { userError } from "./errors";

export const MAX_ROUTINE_NAME_LENGTH = 40;
export const MAX_ROUTINE_EXERCISES = 20;
export const MAX_ROUTINES = 30;
export const MAX_TARGET_SETS = 30;
export const MAX_REPEAT_SESSIONS = 8;

export type RoutineTargets = {
  targetSets?: number;
  targetReps?: number;
  targetWeightLb?: number;
  targetDurationSec?: number;
  targetDistanceM?: number;
  targetCalories?: number;
};

export type RoutineExercise = RoutineTargets & {
  exerciseId: string;
  /** Shared by adjacent exercises. Absent when the exercise stands alone. */
  supersetId?: string;
};

export type PlanExercise = RoutineExercise & {
  skipped?: boolean;
};

export type PerformedSet = {
  exerciseId: string;
  reps: number | null;
  weightLb: number;
  durationSec: number | null;
  distanceM: number | null;
  calories?: number | null;
  loggedAt: number;
};

export type RoutinePrefill = {
  reps: number | null;
  weightLb: number | null;
  durationSec: number | null;
  distanceM: number | null;
  calories?: number | null;
};

const TARGET_FIELDS = [
  "targetSets",
  "targetReps",
  "targetWeightLb",
  "targetDurationSec",
  "targetDistanceM",
  "targetCalories",
] as const;

export function normalizeRoutineName(raw: string): string {
  const name = raw.trim().replace(/\s+/g, " ");
  if (name.length < 1 || name.length > MAX_ROUTINE_NAME_LENGTH) {
    throw userError(
      `Routine name must be 1 to ${MAX_ROUTINE_NAME_LENGTH} characters`,
    );
  }
  return name;
}

export function normalizeTargets(input: {
  targetSets?: number | null;
  targetReps?: number | null;
  targetWeightLb?: number | null;
  targetDurationSec?: number | null;
  targetDistanceM?: number | null;
  targetCalories?: number | null;
}): RoutineTargets {
  const targetSets = optionalTargetSets(input.targetSets);
  const targetReps = optionalTargetReps(input.targetReps);
  const targetWeightLb = optionalTargetWeight(input.targetWeightLb);
  const targetDurationSec = optionalTargetDuration(input.targetDurationSec);
  const targetDistanceM = optionalTargetDistance(input.targetDistanceM);
  const targetCalories = optionalTargetCalories(input.targetCalories);

  if (
    targetReps !== undefined &&
    (targetDurationSec !== undefined || targetDistanceM !== undefined)
  ) {
    throw userError("A target is reps, a time, or a distance");
  }
  if (targetDistanceM !== undefined && targetReps !== undefined) {
    throw userError("A target is reps, a time, or a distance");
  }

  return {
    ...(targetSets !== undefined ? { targetSets } : {}),
    ...(targetReps !== undefined ? { targetReps } : {}),
    ...(targetWeightLb !== undefined ? { targetWeightLb } : {}),
    ...(targetDurationSec !== undefined ? { targetDurationSec } : {}),
    ...(targetDistanceM !== undefined ? { targetDistanceM } : {}),
    ...(targetCalories !== undefined ? { targetCalories } : {}),
  };
}

export function sameTargets(left: RoutineTargets, right: RoutineTargets): boolean {
  return TARGET_FIELDS.every((field) => left[field] === right[field]);
}

/**
 * Point a saved list at the exercise that won a merge.
 * When both ids are already in the list, the merged-away row is dropped
 * and the kept row stays where it was.
 */
export function repointExercises<T extends { exerciseId: string }>(
  items: T[],
  fromId: string,
  intoId: string,
): { items: T[]; changed: boolean } {
  if (fromId === intoId) {
    return { items, changed: false };
  }
  const intoPresent = items.some((item) => item.exerciseId === intoId);
  let changed = false;
  const next: T[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (item.exerciseId === fromId) {
      changed = true;
      if (intoPresent || seen.has(intoId)) {
        continue;
      }
      seen.add(intoId);
      next.push({ ...item, exerciseId: intoId });
      continue;
    }
    if (seen.has(item.exerciseId)) {
      changed = true;
      continue;
    }
    seen.add(item.exerciseId);
    next.push(item);
  }
  return { items: next, changed };
}

export function moveItem<T>(items: T[], index: number, direction: -1 | 1): T[] {
  const nextIndex = index + direction;
  if (
    index < 0 ||
    index >= items.length ||
    nextIndex < 0 ||
    nextIndex >= items.length
  ) {
    return items;
  }
  const copy = items.slice();
  const [item] = copy.splice(index, 1);
  if (item === undefined) {
    return items;
  }
  copy.splice(nextIndex, 0, item);
  return copy;
}

/**
 * Exercises in the order they were performed. A uniform group becomes a
 * target like 3x10. Mixed sets keep only the count, so the checklist does
 * not pretend every set matched.
 */
export function planFromPerformedSets(sets: PerformedSet[]): RoutineExercise[] {
  const ordered = [...sets].sort((left, right) => left.loggedAt - right.loggedAt);
  const groups = new Map<string, PerformedSet[]>();
  const order: string[] = [];
  for (const set of ordered) {
    const existing = groups.get(set.exerciseId);
    if (existing) {
      existing.push(set);
    } else {
      groups.set(set.exerciseId, [set]);
      order.push(set.exerciseId);
    }
  }

  return order.map((exerciseId) => {
    const group = groups.get(exerciseId) ?? [];
    return { exerciseId, ...targetFromGroup(group) };
  });
}

export function routinePrefillFromTarget(
  target: {
    targetReps?: number | null;
    targetWeightLb?: number | null;
    targetDurationSec?: number | null;
    targetDistanceM?: number | null;
    targetCalories?: number | null;
  } | null | undefined,
): RoutinePrefill | null {
  if (!target) {
    return null;
  }
  if (
    target.targetReps == null &&
    target.targetDurationSec == null &&
    target.targetDistanceM == null &&
    target.targetCalories == null
  ) {
    return null;
  }
  return {
    reps: target.targetReps ?? null,
    weightLb: target.targetWeightLb ?? null,
    durationSec: target.targetDurationSec ?? null,
    distanceM: target.targetDistanceM ?? null,
    calories: target.targetCalories ?? null,
  };
}

/** A planned exercise is done once its sets are logged, or once it is skipped. */
export function planProgress(
  loggedCount: number,
  targetSets: number | null | undefined,
  skipped: boolean,
): { done: boolean; label: string | null } {
  if (skipped) {
    return { done: true, label: "Skipped" };
  }
  if (targetSets === undefined || targetSets === null || targetSets < 1) {
    return { done: loggedCount > 0, label: null };
  }
  const shown = Math.min(loggedCount, targetSets);
  return {
    done: loggedCount >= targetSets,
    label: `${shown} of ${targetSets}`,
  };
}

function targetFromGroup(sets: PerformedSet[]): RoutineTargets {
  const last = sets[sets.length - 1];
  if (!last) {
    return {};
  }
  const targetSets = sets.length;
  const uniform = sets.every((set) => sameMeasures(set, last));
  if (!uniform) {
    return { targetSets };
  }
  const kind = setKind(last);
  if (kind === "distance") {
    return {
      targetSets,
      ...(last.distanceM ? { targetDistanceM: last.distanceM } : {}),
      ...(last.durationSec ? { targetDurationSec: last.durationSec } : {}),
      ...(last.weightLb > 0 ? { targetWeightLb: last.weightLb } : {}),
      ...calorieTarget(last),
    };
  }
  if (kind === "timed") {
    return {
      targetSets,
      ...(last.durationSec ? { targetDurationSec: last.durationSec } : {}),
      ...(last.weightLb > 0 ? { targetWeightLb: last.weightLb } : {}),
      ...calorieTarget(last),
    };
  }
  return {
    targetSets,
    ...(last.reps ? { targetReps: last.reps } : {}),
    targetWeightLb: last.weightLb,
  };
}

function sameMeasures(left: PerformedSet, right: PerformedSet): boolean {
  return (
    (left.reps ?? null) === (right.reps ?? null) &&
    left.weightLb === right.weightLb &&
    (left.durationSec ?? null) === (right.durationSec ?? null) &&
    (left.distanceM ?? null) === (right.distanceM ?? null) &&
    (left.calories ?? null) === (right.calories ?? null)
  );
}

function calorieTarget(set: PerformedSet): { targetCalories?: number } {
  const calories = set.calories ?? 0;
  return calories > 0 ? { targetCalories: calories } : {};
}

function optionalTargetSets(value: number | null | undefined): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!Number.isInteger(value) || value < 1 || value > MAX_TARGET_SETS) {
    throw userError(`Sets must be a whole number from 1 to ${MAX_TARGET_SETS}`);
  }
  return value;
}

function optionalTargetReps(value: number | null | undefined): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!wholeInRange(value, MIN_REPS, MAX_REPS)) {
    throw userError(REPS_MESSAGE);
  }
  return value;
}

function optionalTargetWeight(value: number | null | undefined): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!Number.isFinite(value) || value < 0 || value > 2000) {
    throw userError("Weight must be between 0 and 2000 lb");
  }
  return Math.round(value * 100) / 100;
}

function optionalTargetDuration(value: number | null | undefined): number | undefined {
  if (value === undefined || value === null || value === 0) {
    return undefined;
  }
  if (!wholeInRange(value, 1, 24 * 60 * 60)) {
    throw userError(TIME_MESSAGE);
  }
  return value;
}

function optionalTargetCalories(value: number | null | undefined): number | undefined {
  if (value === undefined || value === null || value === 0) {
    return undefined;
  }
  if (!wholeInRange(value, 1, MAX_CALORIES)) {
    throw userError(CALORIES_MESSAGE);
  }
  return value;
}

function optionalTargetDistance(value: number | null | undefined): number | undefined {
  if (value === undefined || value === null || value === 0) {
    return undefined;
  }
  if (!Number.isFinite(value) || value < 1 || value > 200_000) {
    throw userError("Distance must be from 1 meter to 200 kilometers");
  }
  return Math.round(value * 100) / 100;
}
