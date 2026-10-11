export const SET_TYPES = ["warmup", "working", "drop", "failure"] as const;

export type SetType = (typeof SET_TYPES)[number];

export function isSetType(value: unknown): value is SetType {
  return value === "warmup" || value === "working" || value === "drop" || value === "failure";
}

/** Missing and unknown values are working sets. Older documents omit the field. */
export function resolvedSetType(value: unknown): SetType {
  return isSetType(value) ? value : "working";
}

/** Warm-ups and drop sets do not count as personal records. */
export function countsTowardRecord(set: { setType?: unknown }): boolean {
  const type = resolvedSetType(set.setType);
  return type !== "warmup" && type !== "drop";
}

/** Warm-ups are left out of volume and the weekly set total. */
export function countsTowardVolume(set: { setType?: unknown }): boolean {
  return resolvedSetType(set.setType) !== "warmup";
}

export function setTypeLabel(value: unknown): string | null {
  const type = resolvedSetType(value);
  if (type === "warmup") {
    return "Warm-up";
  }
  if (type === "drop") {
    return "Drop";
  }
  if (type === "failure") {
    return "Failure";
  }
  return null;
}

/** Spoken suffix for a non-working set. Working sets stay unlabeled. */
export function setTypeSpeech(value: unknown): string | null {
  const type = resolvedSetType(value);
  if (type === "warmup") {
    return "warm-up";
  }
  if (type === "drop") {
    return "drop set";
  }
  if (type === "failure") {
    return "to failure";
  }
  return null;
}

/** Working sets are stored without the field so older documents stay valid. */
export function persistedSetType(
  setType: SetType,
): { setType: Exclude<SetType, "working"> } | Record<string, never> {
  if (setType === "warmup" || setType === "drop" || setType === "failure") {
    return { setType };
  }
  return {};
}
