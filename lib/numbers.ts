export function parseReps(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) {
    return null;
  }
  const reps = Number(value.trim());
  if (!Number.isInteger(reps) || reps < 1 || reps > 999) {
    return null;
  }
  return reps;
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
