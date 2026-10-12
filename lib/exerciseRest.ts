import { formatExerciseName } from "../convex/lib/exerciseName";
import {
  migrateAccountStorage,
  pendingRestKey,
  rememberedRestKey,
  type KeyValueStore,
} from "./offline/storage";

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

export function loadPendingRests(store: KeyValueStore, email: string | null): PendingRest[] {
  migrateAccountStorage(store, email);
  return readList(store, pendingRestKey(email));
}

export function savePendingRests(store: KeyValueStore, email: string | null, rests: PendingRest[]): void {
  writeList(store, pendingRestKey(email), rests);
}

/** Queues one exercise rest change. A later change for the same name replaces it. */
export function queueRest(
  store: KeyValueStore,
  email: string | null,
  name: string,
  restSeconds: number | null,
): PendingRest[] {
  const key = normalized(name);
  if (!key) {
    return loadPendingRests(store, email);
  }
  const next = loadPendingRests(store, email).filter((item) => normalized(item.name) !== key);
  next.push({ name: key, restSeconds });
  savePendingRests(store, email, next);
  return next;
}

export function clearPendingRest(store: KeyValueStore, email: string | null, name: string): void {
  const key = normalized(name);
  if (!key) {
    return;
  }
  savePendingRests(
    store,
    email,
    loadPendingRests(store, email).filter((item) => normalized(item.name) !== key),
  );
}

export function pendingRestForName(
  store: KeyValueStore,
  email: string | null,
  name: string,
): number | null | undefined {
  const key = normalized(name);
  if (!key) {
    return undefined;
  }
  const match = loadPendingRests(store, email).find((item) => normalized(item.name) === key);
  return match ? match.restSeconds : undefined;
}

export function rememberRest(
  store: KeyValueStore,
  email: string | null,
  name: string,
  restSeconds: number | null,
): void {
  const key = normalized(name);
  if (!key) {
    return;
  }
  migrateAccountStorage(store, email);
  const next = readList(store, rememberedRestKey(email)).filter((item) => normalized(item.name) !== key);
  next.push({ name: key, restSeconds });
  writeList(store, rememberedRestKey(email), next);
}

/** Undefined when this account has not seen a rest for the exercise. */
export function readRememberedRest(
  store: KeyValueStore,
  email: string | null,
  name: string,
): number | null | undefined {
  const key = normalized(name);
  if (!key) {
    return undefined;
  }
  migrateAccountStorage(store, email);
  const match = readList(store, rememberedRestKey(email)).find((item) => normalized(item.name) === key);
  return match ? match.restSeconds : undefined;
}
