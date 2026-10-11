import { setKind } from "../convex/lib/measures";
import { clampIncrementLb } from "../convex/lib/progression";
import { countsTowardRecord, type SetType } from "../convex/lib/setType";
import { formatWeightAmount, roundWeight, type WeightUnit } from "../convex/lib/units";

const MAX_WEIGHT_LB = 2000;
const MAX_REPS = 999;

export type SuggestionSet = {
  reps?: number | null;
  weightLb: number;
  durationSec?: number | null;
  distanceM?: number | null;
  setType?: SetType | null;
};

export type SuggestionTarget = {
  targetSets?: number | null;
  targetReps?: number | null;
};

export type Suggestion =
  | { kind: "weight"; weightLb: number }
  | { kind: "reps"; reps: number };

/**
 * A quiet next-weight (or next-rep) idea from the last countable sets.
 * Warm-ups and drop sets are ignored. Nothing here writes a number.
 */
export function suggestNext(
  previousSets: SuggestionSet[],
  options: {
    enabled: boolean;
    incrementLb: number;
    routine?: SuggestionTarget | null;
  },
): Suggestion | null {
  if (!options.enabled) {
    return null;
  }
  const countable = previousSets.filter(
    (set) => setKind(set) === "strength" && countsTowardRecord(set),
  );
  if (countable.length === 0) {
    return null;
  }
  const targetSets = options.routine?.targetSets;
  if (targetSets != null && countable.length < targetSets) {
    return null;
  }

  const routineReps = options.routine?.targetReps ?? null;
  let targetReps = routineReps;
  if (targetReps == null) {
    const reps = countable.map((set) => set.reps ?? null);
    const shared = reps[0];
    if (shared == null || reps.some((value) => value !== shared)) {
      return null;
    }
    targetReps = shared;
  }
  if (!countable.every((set) => (set.reps ?? 0) >= targetReps)) {
    return null;
  }

  const weights = countable.map((set) => set.weightLb);
  if (weights.every((weight) => weight === 0)) {
    const minReps = Math.min(...countable.map((set) => set.reps ?? 0));
    const next = Math.min(MAX_REPS, minReps + 2);
    if (next <= minReps) {
      return null;
    }
    return { kind: "reps", reps: next };
  }

  const first = weights[0];
  if (first === undefined || first <= 0 || weights.some((weight) => weight !== first)) {
    return null;
  }
  const increment = clampIncrementLb(options.incrementLb);
  const next = Math.min(MAX_WEIGHT_LB, roundWeight(first + increment));
  if (next <= first) {
    return null;
  }
  return { kind: "weight", weightLb: next };
}

export function formatSuggestion(suggestion: Suggestion, unit: WeightUnit): string {
  if (suggestion.kind === "reps") {
    return `Try ${suggestion.reps} reps today`;
  }
  return `Try ${formatWeightAmount(suggestion.weightLb, unit)} ${unit} today`;
}

export function suggestionAlreadyShown(
  suggestion: Suggestion,
  current: { kind: string; reps: string; weightLb: number | null },
): boolean {
  if (current.kind !== "strength") {
    return true;
  }
  if (suggestion.kind === "reps") {
    return Number(current.reps) === suggestion.reps;
  }
  return current.weightLb === suggestion.weightLb;
}
