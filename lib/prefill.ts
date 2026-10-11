import { formatExerciseName } from "../convex/lib/exerciseName";
import { formatClock, formatDistance, setKind, type SetKind } from "../convex/lib/measures";

export type PrefillSource = "session" | "previous" | "default";

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
