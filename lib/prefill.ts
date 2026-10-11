import { formatExerciseName } from "../convex/lib/exerciseName";
import { formatClock, formatDistance, parseClock, parseDistanceInput, setKind, type SetKind } from "../convex/lib/measures";
import type { RoutinePrefill } from "../convex/lib/routinePlan";
import { parseReps } from "./numbers";

export type PrefillSource = "session" | "previous" | "routine" | "default";

export type PrefillValues = {
  kind: SetKind;
  reps: string;
  weight: string;
  duration: string;
  distance: string;
  rpe: string;
  source: PrefillSource;
};

type SetNumbers = {
  reps?: number | null;
  weightLb: number;
  durationSec?: number | null;
  distanceM?: number | null;
  rpe?: number | null;
};

/**
 * Reps and weight for a new set. The open workout wins, then the previous
 * workout's last set of this exercise. Another exercise is never used.
 */
export function prefillValues(
  exerciseName: string,
  sessionSets: Array<{ exerciseName: string } & SetNumbers>,
  previousSets: SetNumbers[] | null,
  routineTarget?: RoutinePrefill | null,
): PrefillValues {
  const normalized = formatExerciseName(exerciseName)?.normalizedName;
  if (normalized) {
    const inSession = sessionSets.filter(
      (set) => formatExerciseName(set.exerciseName)?.normalizedName === normalized,
    );
    const current = inSession[inSession.length - 1];
    if (current) {
      return valuesFromSet(current, "session");
    }
  }

  const previous = previousSets?.[previousSets.length - 1];
  if (previous) {
    return valuesFromSet(previous, "previous");
  }

  const routine = valuesFromRoutine(routineTarget);
  if (routine) {
    return routine;
  }

  return {
    kind: "strength",
    reps: "10",
    weight: "0",
    duration: "",
    distance: "",
    rpe: "",
    source: "default",
  };
}

function valuesFromRoutine(target: RoutinePrefill | null | undefined): PrefillValues | null {
  if (!target) {
    return null;
  }
  if (target.reps == null && target.durationSec == null && target.distanceM == null) {
    return null;
  }
  return valuesFromSet(
    {
      reps: target.reps,
      weightLb: target.weightLb ?? 0,
      durationSec: target.durationSec,
      distanceM: target.distanceM,
    },
    "routine",
  );
}

/** One confirmed set from a prefill. Null when the values are not a valid set. */
export function setFromPrefill(values: PrefillValues): {
  reps?: number;
  weightLb: number;
  durationSec?: number;
  distanceM?: number;
} | null {
  const weight = Number(values.weight);
  if (!Number.isFinite(weight) || weight < 0 || weight > 2000) {
    return null;
  }
  const weightLb = Math.round(weight * 100) / 100;
  if (values.kind === "timed") {
    const durationSec = parseClock(values.duration);
    if (durationSec === null) {
      return null;
    }
    return { weightLb, durationSec };
  }
  if (values.kind === "distance") {
    const distanceM = parseDistanceInput(values.distance);
    if (distanceM === null) {
      return null;
    }
    const durationSec = values.duration.trim() ? parseClock(values.duration) : null;
    if (values.duration.trim() && durationSec === null) {
      return null;
    }
    return {
      weightLb,
      distanceM,
      ...(durationSec ? { durationSec } : {}),
    };
  }
  const reps = parseReps(values.reps);
  if (reps === null) {
    return null;
  }
  return { weightLb, reps };
}

function valuesFromSet(set: SetNumbers, source: PrefillSource): PrefillValues {
  const kind = setKind(set);
  return {
    kind,
    reps: set.reps ? String(set.reps) : "",
    weight: String(set.weightLb),
    duration: set.durationSec ? formatClock(set.durationSec) : "",
    distance: set.distanceM ? formatDistance(set.distanceM) : "",
    rpe: set.rpe ? String(set.rpe) : "",
    source,
  };
}

export function previousSetsForName<T extends { weightLb: number }>(
  exerciseName: string,
  previous: { normalizedName: string; sets: T[] } | null | undefined,
): T[] | null {
  if (!previous) {
    return null;
  }
  const formatted = formatExerciseName(exerciseName);
  if (!formatted || formatted.normalizedName !== previous.normalizedName) {
    return null;
  }
  return previous.sets;
}
