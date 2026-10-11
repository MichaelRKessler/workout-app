import { formatExerciseName } from "../convex/lib/exerciseName";

export type PrefillSource = "session" | "previous" | "default";

export type PrefillValues = {
  reps: string;
  weight: string;
  source: PrefillSource;
};

type SetNumbers = { reps: number; weightLb: number };

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
      return {
        reps: String(current.reps),
        weight: String(current.weightLb),
        source: "session",
      };
    }
  }

  const previous = previousSets?.[previousSets.length - 1];
  if (previous) {
    return {
      reps: String(previous.reps),
      weight: String(previous.weightLb),
      source: "previous",
    };
  }

  return { reps: "10", weight: "0", source: "default" };
}

export function previousSetsForName<T extends { reps: number; weightLb: number }>(
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
