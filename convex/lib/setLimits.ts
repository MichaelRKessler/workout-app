import { maxDisplayWeight, type WeightUnit } from "./units";

/** Shared set bounds. Client copy includes a period; the server uses the same sentence. */

export const MIN_REPS = 1;
export const MAX_REPS = 999;
export const MIN_RPE = 1;
export const MAX_RPE = 10;

export const REPS_MESSAGE = "Reps must be a whole number from 1 to 999.";
export const CALORIES_MESSAGE = "Calories must be a whole number from 1 to 20000.";
export const RPE_MESSAGE = "RPE must be a whole number from 1 to 10.";
export const RPE_BLANK_MESSAGE = "RPE must be a whole number from 1 to 10, or blank.";
export const TIME_MESSAGE = "Time must be from 1 second to 24 hours.";
export const DISTANCE_MESSAGE =
  "Distance must be from 1 meter to 200 kilometers, like 400, 2 km, or 3 mi.";

export function weightMessage(unit: WeightUnit): string {
  return `Weight must be 0 to ${maxDisplayWeight(unit)} ${unit}, with up to two decimal places.`;
}

/** Same sentence, with the example that field already shows. */
export function timeMessage(example: string): string {
  return `${TIME_MESSAGE.slice(0, -1)}, like ${example}.`;
}

export function wholeInRange(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max;
}
