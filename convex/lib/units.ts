export const LB_PER_KG = 2.2046226218;

export type WeightUnit = "lb" | "kg";

export const WEIGHT_STEP: Record<WeightUnit, number> = {
  lb: 5,
  kg: 2.5,
};

/** Stored pounds, rounded to the hundredth so 100 kg comes back as 100. */
export function roundWeight(weight: number): number {
  return Math.round(weight * 100) / 100;
}

export function toPounds(weight: number, unit: WeightUnit): number {
  return roundWeight(unit === "kg" ? weight * LB_PER_KG : weight);
}

export function fromPounds(weightLb: number, unit: WeightUnit): number {
  return roundWeight(unit === "kg" ? weightLb / LB_PER_KG : weightLb);
}

/** Body weight to the nearest tenth with one decimal always shown: "183.8", "184.0". */
export function formatBodyWeightAmount(weightLb: number, unit: WeightUnit): string {
  const display = unit === "kg" ? weightLb / LB_PER_KG : weightLb;
  return (Math.round(display * 10) / 10).toFixed(1);
}

/** Largest load the form can accept in the display unit. Storage stays 0–2000 lb. */
export function maxDisplayWeight(unit: WeightUnit): number {
  return unit === "kg" ? fromPounds(2000, "kg") : 2000;
}

export function formatWeightAmount(weightLb: number, unit: WeightUnit = "lb"): string {
  const display = fromPounds(weightLb, unit);
  return String(display);
}

/**
 * Keep the stored pounds when the field still shows that weight. Converting
 * 135 lb to kg and back would otherwise drift by a hundredth.
 */
export function weightLbFromDisplay(
  display: string,
  unit: WeightUnit,
  originalLb: number | null,
): number | null {
  const parsed = parseDisplayWeight(display, unit);
  if (parsed === null) {
    return null;
  }
  if (originalLb !== null && formatWeightAmount(originalLb, unit) === display.trim()) {
    return roundWeight(originalLb);
  }
  const pounds = toPounds(parsed, unit);
  if (pounds < 0 || pounds > 2000) {
    return null;
  }
  return pounds;
}

export function parseDisplayWeight(value: string, unit: WeightUnit): number | null {
  if (!/^\d+(\.\d{1,2})?$/.test(value.trim())) {
    return null;
  }
  const weight = Number(value.trim());
  if (!Number.isFinite(weight) || weight < 0 || weight > maxDisplayWeight(unit)) {
    return null;
  }
  return weight;
}
