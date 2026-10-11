import { formatExerciseName } from "../convex/lib/exerciseName";
import type { KeyValueStore } from "./offline/storage";

const PREFIX = "workout-offline:";
const PENDING_KEY = `${PREFIX}pending-rest`;
const REMEMBERED_KEY = `${PREFIX}exercise-rest`;

export type PendingRest = {
  name: string;
  restSeconds: number | null;
};

function normalized(name: string): string | null {
  return formatExerciseName(name)?.normalizedName ?? null;
}

function readList(store: KeyValueStore, key: string): PendingRest[] {
  const raw = store.get(key);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    const rests: PendingRest[] = [];
    for (const item of parsed) {
      if (typeof item !== "object" || item === null) {
        continue;
      }
      const row = item as Record<string, unknown>;
      if (typeof row.name !== "string") {
        continue;
      }
      const restSeconds =
        typeof row.restSeconds === "number"
          ? row.restSeconds
          : row.restSeconds === null
            ? null
            : undefined;
      if (restSeconds === undefined) {
        continue;
      }
      rests.push({ name: row.name, restSeconds });
    }
    return rests;
  } catch {
    return [];
  }
}

function writeList(store: KeyValueStore, key: string, rests: PendingRest[]): void {
  if (rests.length === 0) {
    store.remove(key);
    return;
  }
  store.set(key, JSON.stringify(rests));
}

export function loadPendingRests(store: KeyValueStore): PendingRest[] {
  return readList(store, PENDING_KEY);
}

export function savePendingRests(store: KeyValueStore, rests: PendingRest[]): void {
  writeList(store, PENDING_KEY, rests);
}

/** Queues one exercise rest change. A later change for the same name replaces it. */
export function queueRest(
  store: KeyValueStore,
  name: string,
  restSeconds: number | null,
): PendingRest[] {
  const key = normalized(name);
  if (!key) {
    return loadPendingRests(store);
  }
  const next = loadPendingRests(store).filter((item) => normalized(item.name) !== key);
  next.push({ name: key, restSeconds });
  savePendingRests(store, next);
  return next;
}

export function clearPendingRest(store: KeyValueStore, name: string): void {
  const key = normalized(name);
  if (!key) {
    return;
  }
  savePendingRests(
    store,
    loadPendingRests(store).filter((item) => normalized(item.name) !== key),
  );
}

export function pendingRestForName(store: KeyValueStore, name: string): number | null | undefined {
  const key = normalized(name);
  if (!key) {
    return undefined;
  }
  const match = loadPendingRests(store).find((item) => normalized(item.name) === key);
  return match ? match.restSeconds : undefined;
}

export function rememberRest(
  store: KeyValueStore,
  name: string,
  restSeconds: number | null,
): void {
  const key = normalized(name);
  if (!key) {
    return;
  }
  const next = readList(store, REMEMBERED_KEY).filter((item) => normalized(item.name) !== key);
  next.push({ name: key, restSeconds });
  writeList(store, REMEMBERED_KEY, next);
}

/** Undefined when this device has not seen a rest for the exercise. */
export function readRememberedRest(store: KeyValueStore, name: string): number | null | undefined {
  const key = normalized(name);
  if (!key) {
    return undefined;
  }
  const match = readList(store, REMEMBERED_KEY).find((item) => normalized(item.name) === key);
  return match ? match.restSeconds : undefined;
}
