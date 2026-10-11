import { toPounds, type WeightUnit } from "./units";

export const MIN_INCREMENT_LB = 0.5;
export const MAX_INCREMENT_LB = 100;

export function clampIncrementLb(value: number): number {
  if (!Number.isFinite(value)) {
    return 5;
  }
  const rounded = Math.round(value * 100) / 100;
  if (rounded < MIN_INCREMENT_LB) {
    return MIN_INCREMENT_LB;
  }
  if (rounded > MAX_INCREMENT_LB) {
    return MAX_INCREMENT_LB;
  }
  return rounded;
}

/** 5 lb, or 2.5 kg, until a custom increment is saved. */
export function defaultIncrementLb(unit: WeightUnit): number {
  return unit === "kg" ? toPounds(2.5, "kg") : 5;
}

export function effectiveIncrementLb(
  stored: number | null | undefined,
  unit: WeightUnit,
): number {
  if (stored === null || stored === undefined) {
    return defaultIncrementLb(unit);
  }
  return clampIncrementLb(stored);
}
