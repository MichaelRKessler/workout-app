import { parseCaloriesInput, parseClock, parseDistanceInput, type SetKind } from "./measures";
import {
  CALORIES_MESSAGE,
  DISTANCE_MESSAGE,
  MAX_REPS,
  MAX_RPE,
  MIN_REPS,
  MIN_RPE,
  REPS_MESSAGE,
  RPE_BLANK_MESSAGE,
  timeMessage,
  weightMessage,
  wholeInRange,
} from "./setLimits";
import type { SetType } from "./setType";
import { weightLbFromDisplay, type WeightUnit } from "./units";

/**
 * One set as the forms hold it: text fields, before parsing. The add-a-set
 * sheet, the voice confirm sheet, and past workouts all read sets through
 * `parseSetInput`, so they accept and reject the same input with the same
 * sentence the server uses.
 */
export type SetInputFields = {
  kind: SetKind;
  reps: string;
  weight: string;
  /** The stored weight the field was filled from, so an unchanged kg value keeps its pounds. */
  weightLb?: number | null;
  duration: string;
  distance: string;
  calories?: string;
  rpe: string;
  setType: SetType;
};

export type ParsedSetInput = {
  reps: number | null;
  weightLb: number;
  durationSec: number | null;
  distanceM: number | null;
  calories: number | null;
  rpe: number | null;
  setType: SetType;
};

export type SetInputResult = { ok: true; set: ParsedSetInput } | { ok: false; message: string };

export function parseRepsInput(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) {
    return null;
  }
  const reps = Number(value.trim());
  return wholeInRange(reps, MIN_REPS, MAX_REPS) ? reps : null;
}

export function parseSetInput(
  input: SetInputFields,
  unit: WeightUnit,
  options: { blankWeightIsZero?: boolean } = {},
): SetInputResult {
  const fail = (message: string): SetInputResult => ({ ok: false, message });

  const weightLb =
    options.blankWeightIsZero && input.weight.trim().length === 0
      ? 0
      : weightLbFromDisplay(input.weight, unit, input.weightLb ?? null);
  if (weightLb === null) {
    return fail(weightMessage(unit));
  }

  const caloriesText = input.calories?.trim() ?? "";
  const calories = caloriesText.length === 0 ? null : parseCaloriesInput(caloriesText);
  if (caloriesText.length > 0 && calories === null) {
    return fail(CALORIES_MESSAGE);
  }

  const rpeText = input.rpe.trim();
  const rpe = rpeText.length === 0 ? null : Number(rpeText);
  if (rpe !== null && !wholeInRange(rpe, MIN_RPE, MAX_RPE)) {
    return fail(RPE_BLANK_MESSAGE);
  }

  const base = { weightLb, calories, rpe, setType: input.setType };
  if (input.kind === "timed") {
    const durationSec = parseClock(input.duration);
    if (durationSec === null) {
      return fail(timeMessage("90 or 1:30"));
    }
    return { ok: true, set: { ...base, reps: null, durationSec, distanceM: null } };
  }
  if (input.kind === "distance") {
    const distanceM = parseDistanceInput(input.distance);
    if (distanceM === null) {
      return fail(DISTANCE_MESSAGE);
    }
    const durationText = input.duration.trim();
    const durationSec = durationText.length === 0 ? null : parseClock(durationText);
    if (durationText.length > 0 && durationSec === null) {
      return fail(timeMessage("90 or 7:30"));
    }
    return { ok: true, set: { ...base, reps: null, durationSec, distanceM } };
  }
  const reps = parseRepsInput(input.reps);
  if (reps === null) {
    return fail(REPS_MESSAGE);
  }
  return { ok: true, set: { ...base, reps, durationSec: null, distanceM: null } };
}
