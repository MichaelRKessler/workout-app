import { roundWeight, type WeightUnit } from "./units";
import { userError } from "./errors";

export const CM_PER_IN = 2.54;

export type LengthUnit = "in" | "cm";

/** Inches follow pounds. Centimeters follow kilograms, until someone chooses. */
export function defaultLengthUnit(weightUnit: WeightUnit): LengthUnit {
  return weightUnit === "kg" ? "cm" : "in";
}

export function isLengthUnit(value: unknown): value is LengthUnit {
  return value === "in" || value === "cm";
}

export function roundLength(value: number): number {
  return Math.round(value * 100) / 100;
}

export function toCentimeters(value: number, unit: LengthUnit): number {
  return roundLength(unit === "in" ? value * CM_PER_IN : value);
}

export function fromCentimeters(cm: number, unit: LengthUnit): number {
  return roundLength(unit === "in" ? cm / CM_PER_IN : cm);
}

const EARLIEST_AT = Date.UTC(2000, 0, 1);
const FUTURE_SKEW_MS = 2 * 60 * 1000;

export const MIN_BODY_WEIGHT_LB = 1;
export const MAX_BODY_WEIGHT_LB = 2000;
export const MIN_BODY_FAT = 1;
export const MAX_BODY_FAT = 80;
export const MIN_CIRCUMFERENCE_CM = 1;
export const MAX_CIRCUMFERENCE_CM = 300;

export type BodyMeasureInput = {
  weightLb?: number | null;
  bodyFatPct?: number | null;
  waistCm?: number | null;
  chestCm?: number | null;
  armCm?: number | null;
  hipsCm?: number | null;
  thighCm?: number | null;
};

export type StoredBodyMeasures = {
  weightLb?: number;
  bodyFatPct?: number;
  waistCm?: number;
  chestCm?: number;
  armCm?: number;
  hipsCm?: number;
  thighCm?: number;
};

/** A logged time, clamped so a clock a minute ahead still saves as now. */
export function acceptedLoggedAt(value: number, now: number): number | null {
  if (!Number.isFinite(value) || value < EARLIEST_AT || value > now + FUTURE_SKEW_MS) {
    return null;
  }
  return Math.min(value, now);
}

function optionalNumber(
  value: number | null | undefined,
  min: number,
  max: number,
  label: string,
): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!Number.isFinite(value) || value < min || value > max) {
    throw userError(`${label} must be between ${min} and ${max}`);
  }
  return roundLength(value);
}

function withOptional(
  stored: StoredBodyMeasures,
  key: keyof StoredBodyMeasures,
  value: number | undefined,
): StoredBodyMeasures {
  if (value === undefined) {
    return stored;
  }
  return { ...stored, [key]: value };
}

/**
 * Storage shape: weight in pounds, circumferences in centimeters.
 * At least one measurement is required. Blank fields are left off the document.
 */
export function normalizeBodyMeasures(input: BodyMeasureInput): StoredBodyMeasures {
  let weightLb: number | undefined;
  if (input.weightLb !== undefined && input.weightLb !== null) {
    weightLb = roundWeight(input.weightLb);
    if (weightLb < MIN_BODY_WEIGHT_LB || weightLb > MAX_BODY_WEIGHT_LB) {
      throw userError(
        `Weight must be between ${MIN_BODY_WEIGHT_LB} and ${MAX_BODY_WEIGHT_LB} lb`,
      );
    }
  }
  let stored: StoredBodyMeasures = weightLb !== undefined ? { weightLb } : {};
  stored = withOptional(
    stored,
    "bodyFatPct",
    optionalNumber(input.bodyFatPct, MIN_BODY_FAT, MAX_BODY_FAT, "Body fat"),
  );
  stored = withOptional(
    stored,
    "waistCm",
    optionalNumber(input.waistCm, MIN_CIRCUMFERENCE_CM, MAX_CIRCUMFERENCE_CM, "Waist"),
  );
  stored = withOptional(
    stored,
    "chestCm",
    optionalNumber(input.chestCm, MIN_CIRCUMFERENCE_CM, MAX_CIRCUMFERENCE_CM, "Chest"),
  );
  stored = withOptional(
    stored,
    "armCm",
    optionalNumber(input.armCm, MIN_CIRCUMFERENCE_CM, MAX_CIRCUMFERENCE_CM, "Arm"),
  );
  stored = withOptional(
    stored,
    "hipsCm",
    optionalNumber(input.hipsCm, MIN_CIRCUMFERENCE_CM, MAX_CIRCUMFERENCE_CM, "Hips"),
  );
  stored = withOptional(
    stored,
    "thighCm",
    optionalNumber(input.thighCm, MIN_CIRCUMFERENCE_CM, MAX_CIRCUMFERENCE_CM, "Thigh"),
  );
  if (Object.keys(stored).length === 0) {
    throw userError("Add a weight or a measurement");
  }
  return stored;
}
