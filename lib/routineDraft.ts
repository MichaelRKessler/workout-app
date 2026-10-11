import { formatExerciseName } from "../convex/lib/exerciseName";
import { withStoredSuperset } from "../convex/lib/superset";
import { formatClock, formatDistance, parseClock, parseDistanceInput } from "../convex/lib/measures";
import { clampRestSeconds } from "../convex/lib/rest";
import { MAX_ROUTINE_EXERCISES, MAX_TARGET_SETS } from "../convex/lib/routinePlan";
import {
  formatWeightAmount,
  parseDisplayWeight,
  toPounds,
  type WeightUnit,
} from "../convex/lib/units";
import { parseReps } from "./numbers";

export type DraftKind = "none" | "strength" | "timed" | "distance";

export type RoutineDraftExercise = {
  key: string;
  name: string;
  kind: DraftKind;
  sets: string;
  reps: string;
  weight: string;
  duration: string;
  distance: string;
  /** Empty uses the device rest default. A number of seconds is the account rest. */
  rest: string;
  /** Shared with the next exercises when they are one superset. */
  supersetId: string | null;
};

export type RoutineExercisePayload = {
  name: string;
  targetSets?: number;
  targetReps?: number;
  targetWeightLb?: number;
  targetDurationSec?: number;
  targetDistanceM?: number;
  restSeconds: number | null;
  supersetId?: string;
};

type SavedExercise = {
  name: string;
  targetSets: number | null;
  targetReps: number | null;
  targetWeightLb: number | null;
  targetDurationSec: number | null;
  targetDistanceM: number | null;
  restSeconds?: number | null;
  supersetId?: string | null;
};

export function blankRoutineExercise(key: string): RoutineDraftExercise {
  return {
    key,
    name: "",
    kind: "none",
    sets: "",
    reps: "",
    weight: "",
    duration: "",
    distance: "",
    rest: "",
    supersetId: null,
  };
}

export function savedExerciseToDraft(
  exercise: SavedExercise,
  unit: WeightUnit,
  key: string,
): RoutineDraftExercise {
  let kind: DraftKind = "none";
  if (exercise.targetDistanceM !== null) {
    kind = "distance";
  } else if (exercise.targetDurationSec !== null && exercise.targetReps === null) {
    kind = "timed";
  } else if (exercise.targetReps !== null || exercise.targetWeightLb !== null) {
    kind = "strength";
  }
  return {
    key,
    name: exercise.name,
    kind,
    sets: exercise.targetSets ? String(exercise.targetSets) : "",
    reps: exercise.targetReps ? String(exercise.targetReps) : "",
    weight:
      exercise.targetWeightLb === null ? "" : formatWeightAmount(exercise.targetWeightLb, unit),
    duration: exercise.targetDurationSec ? formatClock(exercise.targetDurationSec) : "",
    distance: exercise.targetDistanceM ? formatDistance(exercise.targetDistanceM) : "",
    rest: exercise.restSeconds ? String(exercise.restSeconds) : "",
    supersetId: exercise.supersetId ?? null,
  };
}

export function routineDraftToPayload(
  exercises: RoutineDraftExercise[],
  unit: WeightUnit,
): { ok: true; exercises: RoutineExercisePayload[] } | { ok: false; error: string } {
  if (exercises.length < 1) {
    return { ok: false, error: "Add at least one exercise." };
  }
  if (exercises.length > MAX_ROUTINE_EXERCISES) {
    return {
      ok: false,
      error: `A routine can have up to ${MAX_ROUTINE_EXERCISES} exercises.`,
    };
  }
  const payloads: Array<Omit<RoutineExercisePayload, "supersetId"> & { supersetId?: string | null }> =
    [];
  const seen = new Set<string>();
  for (const exercise of exercises) {
    const formatted = formatExerciseName(exercise.name);
    if (!formatted) {
      return { ok: false, error: "Exercise name must be 1 to 80 characters." };
    }
    if (seen.has(formatted.normalizedName)) {
      return { ok: false, error: "Each exercise can be in a routine once." };
    }
    seen.add(formatted.normalizedName);
    const targets = targetsFromDraft(exercise, unit);
    if (!targets.ok) {
      return targets;
    }
    const restText = exercise.rest.trim();
    const restSeconds = restText.length === 0 ? null : clampRestSeconds(Number(restText));
    payloads.push({
      name: formatted.name,
      restSeconds,
      supersetId: exercise.supersetId,
      ...targets.targets,
    });
  }
  return {
    ok: true,
    exercises: withStoredSuperset(payloads).map((exercise) => {
      const { supersetId, ...rest } = exercise;
      return supersetId ? { ...rest, supersetId } : rest;
    }),
  };
}

function targetsFromDraft(
  exercise: RoutineDraftExercise,
  unit: WeightUnit,
): { ok: true; targets: Omit<RoutineExercisePayload, "name" | "restSeconds"> } | { ok: false; error: string } {
  const sets = optionalSets(exercise.sets);
  if (sets.error) {
    return { ok: false, error: sets.error };
  }
  if (exercise.kind === "none") {
    return { ok: true, targets: { ...(sets.value ? { targetSets: sets.value } : {}) } };
  }
  if (exercise.kind === "strength") {
    const reps = parseReps(exercise.reps);
    if (reps === null) {
      return { ok: false, error: "Reps must be a whole number from 1 to 999." };
    }
    const weight = optionalWeight(exercise.weight, unit);
    if (weight.error) {
      return { ok: false, error: weight.error };
    }
    return {
      ok: true,
      targets: {
        ...(sets.value ? { targetSets: sets.value } : {}),
        targetReps: reps,
        ...(weight.value !== undefined ? { targetWeightLb: weight.value } : {}),
      },
    };
  }
  if (exercise.kind === "timed") {
    const durationSec = parseClock(exercise.duration);
    if (durationSec === null) {
      return { ok: false, error: "Time must be from 1 second to 24 hours, like 90 or 1:30." };
    }
    const weight = optionalWeight(exercise.weight, unit);
    if (weight.error) {
      return { ok: false, error: weight.error };
    }
    return {
      ok: true,
      targets: {
        ...(sets.value ? { targetSets: sets.value } : {}),
        targetDurationSec: durationSec,
        ...(weight.value !== undefined ? { targetWeightLb: weight.value } : {}),
      },
    };
  }
  const distanceM = parseDistanceInput(exercise.distance);
  if (distanceM === null) {
    return { ok: false, error: "Distance must be from 1 meter to 200 kilometers, like 400 or 5 km." };
  }
  let targetDurationSec: number | undefined;
  if (exercise.duration.trim()) {
    const durationSec = parseClock(exercise.duration);
    if (durationSec === null) {
      return { ok: false, error: "Time must be from 1 second to 24 hours, like 90 or 20:00." };
    }
    targetDurationSec = durationSec;
  }
  return {
    ok: true,
    targets: {
      ...(sets.value ? { targetSets: sets.value } : {}),
      targetDistanceM: distanceM,
      ...(targetDurationSec ? { targetDurationSec } : {}),
    },
  };
}

function optionalSets(value: string): { value?: number; error?: string } {
  if (!value.trim()) {
    return {};
  }
  if (!/^\d+$/.test(value.trim())) {
    return { error: `Sets must be a whole number from 1 to ${MAX_TARGET_SETS}.` };
  }
  const sets = Number(value.trim());
  if (!Number.isInteger(sets) || sets < 1 || sets > MAX_TARGET_SETS) {
    return { error: `Sets must be a whole number from 1 to ${MAX_TARGET_SETS}.` };
  }
  return { value: sets };
}

function optionalWeight(
  value: string,
  unit: WeightUnit,
): { value?: number; error?: string } {
  if (!value.trim()) {
    return {};
  }
  const display = parseDisplayWeight(value, unit);
  if (display === null) {
    return { error: `Weight must be from 0 to the limit, in ${unit}.` };
  }
  return { value: toPounds(display, unit) };
}
