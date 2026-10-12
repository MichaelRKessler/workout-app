import { parseRepsInput } from "../convex/lib/setInput.ts";

/** Same rule as every set form; see convex/lib/setInput.ts. */
export function parseReps(value: string): number | null {
  return parseRepsInput(value);
}

export function parseWeightLb(value: string): number | null {
  if (!/^\d+(\.\d{1,2})?$/.test(value.trim())) {
    return null;
  }
  const weight = Number(value.trim());
  if (!Number.isFinite(weight) || weight < 0 || weight > 2000) {
    return null;
  }
  return weight;
}
