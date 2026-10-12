import { setKind } from "../convex/lib/measures";
import { clampIncrementLb } from "../convex/lib/progression";
import { countsTowardRecord, type SetType } from "../convex/lib/setType";
import { formatWeightAmount, fromPounds, roundWeight, toPounds, type WeightUnit } from "../convex/lib/units";

const MAX_WEIGHT_LB = 2000;
const MAX_REPS = 999;

/** Calories are not an input. A set's calorie count never changes the next weight. */
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
    unit?: WeightUnit;
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
  const next = nextWeightLb(first, options.incrementLb, options.unit ?? "lb");
  if (next === null) {
    return null;
  }
  return { kind: "weight", weightLb: next };
}

/**
 * Add the increment in the unit on screen, snap to that step, then store pounds
 * once. Adding a rounded pound increment to kilograms drifts off the plate.
 */
function nextWeightLb(weightLb: number, incrementLb: number, unit: WeightUnit): number | null {
  const step = fromPounds(clampIncrementLb(incrementLb), unit);
  const current = fromPounds(weightLb, unit);
  if (!(step > 0) || !(current > 0)) {
    return null;
  }
  const snapped = roundWeight(Math.round((current + step) / step) * step);
  if (!(snapped > current)) {
    return null;
  }
  const pounds = Math.min(MAX_WEIGHT_LB, toPounds(snapped, unit));
  if (pounds <= roundWeight(weightLb)) {
    return null;
  }
  return pounds;
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

/**
 * One plain sentence on why a suggestion is that number, from the same sets
 * `suggestNext` read: "All 3 sets reached 8 reps last time, so 5 lb more."
 */
export function explainSuggestion(
  previousSets: SuggestionSet[],
  suggestion: Suggestion,
  options: { unit: WeightUnit; routine?: SuggestionTarget | null },
): string | null {
  const countable = previousSets.filter(
    (set) => setKind(set) === "strength" && countsTowardRecord(set),
  );
  const reps = options.routine?.targetReps ?? countable[0]?.reps ?? null;
  if (countable.length === 0 || reps == null) {
    return null;
  }
  const reached =
    countable.length === 1
      ? `You reached ${reps} reps last time`
      : `All ${countable.length} sets reached ${reps} reps last time`;
  if (suggestion.kind === "reps") {
    const minReps = Math.min(...countable.map((set) => set.reps ?? 0));
    const more = suggestion.reps - minReps;
    return more > 0 ? `${reached}, so ${more} more ${more === 1 ? "rep" : "reps"}.` : null;
  }
  const first = countable[0]?.weightLb;
  if (first === undefined) {
    return null;
  }
  const step = roundWeight(fromPounds(suggestion.weightLb, options.unit) - fromPounds(first, options.unit));
  return step > 0 ? `${reached}, so ${step} ${options.unit} more.` : null;
}
