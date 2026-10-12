import type { WeightUnit } from "../convex/lib/units";
import type { DraftSet } from "./voice/confirm";

export type SetGroup = {
  start: number;
  count: number;
};

/** Two draft sets the confirm sheet can show as one row. Ids are ignored. */
export function draftSetsMatch(left: DraftSet, right: DraftSet): boolean {
  return (
    left.kind === right.kind &&
    left.reps === right.reps &&
    left.weight === right.weight &&
    left.duration === right.duration &&
    left.distance === right.distance &&
    left.calories === right.calories &&
    left.rpe === right.rpe &&
    left.setType === right.setType &&
    left.weightLb === right.weightLb
  );
}

function hasId(set: DraftSet, ids: ReadonlySet<string>): boolean {
  return set.draftSetId !== undefined && ids.has(set.draftSetId);
}

/**
 * Consecutive identical sets collapse. Split ids stay on their own row.
 * Held ids (the row being edited) stay one row and never absorb a neighbor,
 * so typing a matching value does not close the editor mid-edit.
 */
export function groupIdenticalSets(
  sets: DraftSet[],
  splitIds: ReadonlySet<string> = new Set(),
  heldIds: ReadonlySet<string> = new Set(),
): SetGroup[] {
  const groups: SetGroup[] = [];
  sets.forEach((set, index) => {
    const previous = groups[groups.length - 1];
    const previousSet = previous ? sets[previous.start] : undefined;
    if (previous && previousSet) {
      const held = hasId(set, heldIds);
      const previousHeld = hasId(previousSet, heldIds);
      const together =
        held && previousHeld
          ? true
          : !held &&
            !previousHeld &&
            !hasId(set, splitIds) &&
            !hasId(previousSet, splitIds) &&
            draftSetsMatch(previousSet, set);
      if (together) {
        previous.count += 1;
        return;
      }
    }
    groups.push({ start: index, count: 1 });
  });
  return groups;
}

/** Gives every set in a row an id, so the row can be held or split by id. */
export function withDraftSetIds(
  sets: DraftSet[],
  start: number,
  count: number,
  newId: () => string,
): { sets: DraftSet[]; ids: string[] } {
  const ids: string[] = [];
  let changed = false;
  const next = sets.map((set, index) => {
    if (index < start || index >= start + count) {
      return set;
    }
    if (set.draftSetId !== undefined) {
      ids.push(set.draftSetId);
      return set;
    }
    const id = newId();
    ids.push(id);
    changed = true;
    return { ...set, draftSetId: id };
  });
  return { sets: changed ? next : sets, ids };
}

/** Changes how many copies a group has. The group never drops below one set. */
export function resizeSetGroup(
  sets: DraftSet[],
  start: number,
  count: number,
  nextCount: number,
): DraftSet[] {
  const size = Math.max(1, Math.floor(nextCount));
  if (size === count || start < 0 || count < 1 || start + count > sets.length) {
    return sets;
  }
  const sample = sets[start];
  if (!sample) {
    return sets;
  }
  if (size < count) {
    return [...sets.slice(0, start + size), ...sets.slice(start + count)];
  }
  const extra = Array.from({ length: size - count }, () => ({
    ...sample,
    draftSetId: undefined,
  }));
  return [...sets.slice(0, start + count), ...extra, ...sets.slice(start + count)];
}

export function patchSetGroup(
  sets: DraftSet[],
  start: number,
  count: number,
  patch: Partial<DraftSet>,
): DraftSet[] {
  return sets.map((set, index) =>
    index >= start && index < start + count ? { ...set, ...patch } : set,
  );
}

/** "10 @ 135 lb", or "1:00" / "5 km" for the other measures. */
export function draftSetPhrase(set: DraftSet, unit: WeightUnit): string {
  const load = set.weight.trim();
  const weighted = load.length > 0 && load !== "0";
  let phrase: string;
  if (set.kind === "timed") {
    phrase = set.duration.trim() || "0:00";
    if (weighted) {
      phrase += ` @ ${load} ${unit}`;
    }
  } else if (set.kind === "distance") {
    phrase = set.distance.trim() || "0";
    if (set.duration.trim()) {
      phrase += ` in ${set.duration.trim()}`;
    }
    if (weighted) {
      phrase += ` @ ${load} ${unit}`;
    }
  } else if (!weighted) {
    phrase = `${set.reps.trim() || "0"} × bodyweight`;
  } else {
    phrase = `${set.reps.trim() || "0"} @ ${load} ${unit}`;
  }
  const extras: string[] = [];
  if (set.setType !== "working") {
    extras.push(set.setType);
  }
  if (set.rpe.trim()) {
    extras.push(`RPE ${set.rpe.trim()}`);
  }
  if (set.calories.trim()) {
    extras.push(`${set.calories.trim()} cal`);
  }
  return extras.length > 0 ? `${phrase} · ${extras.join(" · ")}` : phrase;
}

/** "3 × 10 @ 135 lb" for a repeated set, or the phrase alone for one. */
export function draftGroupLabel(count: number, set: DraftSet, unit: WeightUnit): string {
  const phrase = draftSetPhrase(set, unit);
  return count > 1 ? `${count} × ${phrase}` : phrase;
}
