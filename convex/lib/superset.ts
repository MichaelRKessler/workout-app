/**
 * Superset grouping for routines and workout plans.
 * An id is shared by two or more adjacent exercises. Missing means alone,
 * so documents saved before supersets stay valid.
 */

const ID_LIMIT = 16;

export function cleanSupersetId(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const id = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, ID_LIMIT);
  return id.length > 0 ? id : undefined;
}

export function freshSupersetId(used: ReadonlySet<string> = new Set()): string {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const id = Math.random().toString(36).slice(2, 8);
    if (id.length >= 4 && !used.has(id)) {
      return id;
    }
  }
  return `s${used.size}`.slice(0, ID_LIMIT);
}

export type SupersetFields = {
  supersetId?: string | null;
};

/** Drops ids that do not belong to an adjacent pair, and splits a repeated id. */
export function normalizeSupersetItems<T extends SupersetFields>(items: T[]): T[] {
  const next = items.map((item) => ({
    ...item,
    supersetId: cleanSupersetId(item.supersetId),
  }));
  const used = new Set<string>();
  let index = 0;
  while (index < next.length) {
    const id = next[index]?.supersetId;
    if (!id) {
      index += 1;
      continue;
    }
    let end = index + 1;
    while (end < next.length && next[end]?.supersetId === id) {
      end += 1;
    }
    if (end - index < 2) {
      for (let cursor = index; cursor < end; cursor += 1) {
        const item = next[cursor];
        if (item) {
          item.supersetId = undefined;
        }
      }
    } else if (used.has(id)) {
      const fresh = freshSupersetId(used);
      used.add(fresh);
      for (let cursor = index; cursor < end; cursor += 1) {
        const item = next[cursor];
        if (item) {
          item.supersetId = fresh;
        }
      }
    } else {
      used.add(id);
    }
    index = end;
  }
  return next;
}

/** Omits the field when the exercise is not in a superset, so older readers stay valid. */
export function withStoredSuperset<T extends SupersetFields>(
  items: T[],
): Array<Omit<T, "supersetId"> & { supersetId?: string }> {
  return normalizeSupersetItems(items).map((item) => {
    const { supersetId: raw, ...rest } = item;
    const supersetId = cleanSupersetId(raw);
    if (supersetId) {
      return { ...rest, supersetId };
    }
    return rest;
  });
}

export function linkWithNext<T extends SupersetFields>(items: T[], index: number): T[] {
  if (index < 0 || index >= items.length - 1) {
    return items;
  }
  const copy = items.map((item) => ({
    ...item,
    supersetId: cleanSupersetId(item.supersetId),
  }));
  const left = copy[index]?.supersetId;
  const right = copy[index + 1]?.supersetId;
  const used = new Set(
    copy.map((item) => item.supersetId).filter((id): id is string => id !== undefined),
  );
  const id = left ?? right ?? freshSupersetId(used);
  const replace = new Set<string>();
  if (left) {
    replace.add(left);
  }
  if (right) {
    replace.add(right);
  }
  if (replace.size === 0) {
    const current = copy[index];
    const neighbor = copy[index + 1];
    if (current) {
      current.supersetId = id;
    }
    if (neighbor) {
      neighbor.supersetId = id;
    }
  } else {
    for (const item of copy) {
      if (item.supersetId && replace.has(item.supersetId)) {
        item.supersetId = id;
      }
    }
    const current = copy[index];
    const neighbor = copy[index + 1];
    if (current) {
      current.supersetId = id;
    }
    if (neighbor) {
      neighbor.supersetId = id;
    }
  }
  return normalizeSupersetItems(copy);
}

/** Clears the whole group that contains this exercise. */
export function unlinkSuperset<T extends SupersetFields>(items: T[], index: number): T[] {
  const copy = items.map((item) => ({ ...item }));
  const id = cleanSupersetId(copy[index]?.supersetId);
  if (!id) {
    return copy;
  }
  for (const item of copy) {
    if (cleanSupersetId(item.supersetId) === id) {
      item.supersetId = undefined;
    }
  }
  return normalizeSupersetItems(copy);
}

export type SupersetBlock<T> = {
  supersetId: string | null;
  items: T[];
};

export function supersetBlocks<T extends SupersetFields>(items: T[]): Array<SupersetBlock<T>> {
  const normalized = normalizeSupersetItems(items);
  const blocks: Array<SupersetBlock<T>> = [];
  for (const item of normalized) {
    const supersetId = item.supersetId ?? null;
    const last = blocks[blocks.length - 1];
    if (last && supersetId !== null && last.supersetId === supersetId) {
      last.items.push(item);
      continue;
    }
    blocks.push({ supersetId, items: [item] });
  }
  return blocks;
}

/** Pulls members of one superset together so history can show the group. */
export function packSupersetOrder<T extends SupersetFields>(items: T[]): T[] {
  const result: T[] = [];
  const used = new Set<number>();
  for (let index = 0; index < items.length; index += 1) {
    if (used.has(index)) {
      continue;
    }
    const id = cleanSupersetId(items[index]?.supersetId);
    if (!id) {
      const item = items[index];
      if (item) {
        result.push(item);
      }
      continue;
    }
    const members: number[] = [];
    for (let cursor = 0; cursor < items.length; cursor += 1) {
      if (cleanSupersetId(items[cursor]?.supersetId) === id) {
        members.push(cursor);
      }
    }
    if (members.length < 2) {
      const item = items[index];
      if (item) {
        result.push({ ...item, supersetId: undefined });
      }
      continue;
    }
    for (const cursor of members) {
      used.add(cursor);
      const item = items[cursor];
      if (item) {
        result.push(item);
      }
    }
  }
  return normalizeSupersetItems(result);
}

export function formatSupersetNames(
  items: Array<{ name: string } & SupersetFields>,
): string {
  return supersetBlocks(items)
    .map((block) => {
      const names = block.items.map((item) => item.name);
      return block.supersetId ? names.join(" + ") : names.join(", ");
    })
    .filter((part) => part.length > 0)
    .join(", ");
}

/**
 * Copies grouping onto a repeated plan when those exercises are still adjacent
 * in the order they were performed.
 */
export function carrySupersetIds<T extends { exerciseId: string }>(
  plan: T[],
  sources: Array<Array<{ exerciseId: string } & SupersetFields>>,
): Array<T & { supersetId?: string }> {
  const next: Array<T & { supersetId?: string }> = plan.map((item) => ({ ...item }));
  const indexById = new Map(next.map((item, index) => [item.exerciseId, index]));
  for (const source of sources) {
    for (const block of supersetBlocks(source)) {
      if (!block.supersetId) {
        continue;
      }
      const indexes = block.items
        .map((item) => indexById.get(item.exerciseId))
        .filter((value): value is number => value !== undefined)
        .sort((left, right) => left - right);
      if (indexes.length < 2) {
        continue;
      }
      const adjacent = indexes.every(
        (value, offset) => offset === 0 || value === (indexes[offset - 1] ?? value) + 1,
      );
      if (!adjacent || indexes.some((value) => next[value]?.supersetId)) {
        continue;
      }
      for (const value of indexes) {
        const item = next[value];
        if (item) {
          item.supersetId = block.supersetId;
        }
      }
    }
  }
  return normalizeSupersetItems(next);
}

/**
 * Folds a confirmed superset into a workout plan. Targets already on the plan
 * stay. Exercises that were not on the plan are appended only as part of a
 * real group. Voice labels are rewritten so they cannot collide with a group
 * already on the plan.
 */
export function mergeSupersetMembers<T extends { exerciseId: string }>(
  plan: readonly T[],
  incoming: ReadonlyArray<{ exerciseId: T["exerciseId"] } & SupersetFields>,
  create: (exerciseId: T["exerciseId"]) => NoInfer<T>,
): Array<Omit<T, "supersetId"> & { supersetId?: string }> {
  const groups: Array<{ label: string; exerciseIds: Array<T["exerciseId"]> }> = [];
  const seenLabel = new Map<string, number>();
  for (const item of incoming) {
    const label = cleanSupersetId(item.supersetId);
    if (!label) {
      continue;
    }
    let at = seenLabel.get(label);
    if (at === undefined) {
      at = groups.length;
      seenLabel.set(label, at);
      groups.push({ label, exerciseIds: [] });
    }
    const group = groups[at];
    if (group && !group.exerciseIds.includes(item.exerciseId)) {
      group.exerciseIds.push(item.exerciseId);
    }
  }
  const real = groups.filter((group) => group.exerciseIds.length >= 2);
  if (real.length === 0) {
    return withStoredSuperset(
      plan.map((item) => ({
        ...item,
        supersetId: cleanSupersetId((item as { supersetId?: string | null }).supersetId),
      })),
    );
  }

  let next: Array<T & SupersetFields> = plan.map((item) => ({ ...item }));
  const used = new Set(
    next
      .map((item) => cleanSupersetId(item.supersetId))
      .filter((id): id is string => id !== undefined),
  );
  for (const group of real) {
    const id = freshSupersetId(used);
    used.add(id);
    const memberSet = new Set(group.exerciseIds);
    const insertAt = next.findIndex((item) => memberSet.has(item.exerciseId));
    const byId = new Map(next.map((item) => [item.exerciseId, item]));
    const kept = next.filter((item) => !memberSet.has(item.exerciseId));
    const members = group.exerciseIds.map((exerciseId) => {
      const existing = byId.get(exerciseId);
      const base = existing ?? create(exerciseId);
      return { ...base, supersetId: id };
    });
    const place =
      insertAt < 0
        ? kept.length
        : next.slice(0, insertAt).filter((item) => !memberSet.has(item.exerciseId)).length;
    kept.splice(place, 0, ...members);
    next = kept;
  }
  return withStoredSuperset(next);
}

/**
 * Rest starts after a lone exercise, and after a superset only when every
 * exercise in the round has the same number of sets. Skipped exercises sit
 * out of the round.
 */
export function restAfterSet(
  items: Array<{ exerciseId: string; skipped?: boolean } & SupersetFields>,
  counts: ReadonlyMap<string, number>,
  exerciseId: string,
): { start: boolean; exerciseIds: string[] } {
  const normalized = normalizeSupersetItems(items);
  const index = normalized.findIndex((item) => item.exerciseId === exerciseId);
  if (index < 0) {
    return { start: true, exerciseIds: [exerciseId] };
  }
  const id = normalized[index]?.supersetId;
  if (!id) {
    return { start: true, exerciseIds: [exerciseId] };
  }
  const active = normalized.filter((item) => item.supersetId === id && !item.skipped);
  if (active.length < 2 || !active.some((item) => item.exerciseId === exerciseId)) {
    return { start: true, exerciseIds: [exerciseId] };
  }
  const tallies = active.map((item) => counts.get(item.exerciseId) ?? 0);
  const first = tallies[0] ?? 0;
  const complete = first > 0 && tallies.every((count) => count === first);
  return {
    start: complete,
    exerciseIds: active.map((item) => item.exerciseId),
  };
}

/**
 * The round uses the longest rest. A missing account rest is the device
 * default. Ties go to the exercise that just closed the round.
 */
export function restOwnerId(
  exerciseIds: string[],
  rests: ReadonlyMap<string, number | null>,
  loggedId: string,
  deviceDefault: number,
): string {
  let bestId = loggedId;
  let best = -1;
  for (const id of exerciseIds) {
    const stored = rests.get(id);
    const effective = stored == null ? deviceDefault : stored;
    if (effective > best || (effective === best && id === loggedId)) {
      best = effective;
      bestId = id;
    }
  }
  return bestId;
}

/** The exercise that is behind in the current superset round. */
export function supersetNextId(
  rows: Array<{
    exerciseId: string;
    skipped?: boolean;
    setCount: number;
    targetSets?: number | null;
  } & SupersetFields>,
): string | null {
  for (const block of supersetBlocks(rows)) {
    if (!block.supersetId) {
      continue;
    }
    const open = block.items.filter((item) => {
      if (item.skipped) {
        return false;
      }
      if (item.targetSets != null && item.targetSets >= 1) {
        return item.setCount < item.targetSets;
      }
      return true;
    });
    if (open.length === 0) {
      continue;
    }
    const counts = open.map((item) => item.setCount);
    const min = Math.min(...counts);
    if (counts.some((count) => count !== min)) {
      return open.find((item) => item.setCount === min)?.exerciseId ?? null;
    }
    const targetRemains = open.some(
      (item) => item.targetSets != null && item.targetSets >= 1 && item.setCount < item.targetSets,
    );
    if (targetRemains) {
      return open[0]?.exerciseId ?? null;
    }
  }
  return null;
}
