import { isSetType } from "../../convex/lib/setType.ts";
import type { SetLine } from "../groupSets.ts";
import { mergeOutboxes } from "./merge.ts";
import { emptyOutbox, parseOutbox, repairOpenSession, type Outbox } from "./outbox.ts";
import type { PendingPlan } from "./routineCache.ts";

const PREFIX = "workout-offline:";
const ACCOUNT_PREFIX = "workout-account:";

export class OfflineStorageError extends Error {
  constructor() {
    super("This phone couldn't store changes");
    this.name = "OfflineStorageError";
  }
}

let writesSuspended = false;

/** Sign-out turns writes off so a late sync cannot recreate the queue. */
export function suspendOfflineWrites(): void {
  writesSuspended = true;
}

export function resumeOfflineWrites(): void {
  writesSuspended = false;
}

export function offlineWritesSuspended(): boolean {
  return writesSuspended;
}

export type KeyValueStore = {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
  keys(): string[];
};

export type CachedAccess = {
  email: string | null;
  name: string | null;
  allowed: boolean;
  isAdmin: boolean;
  request: {
    status: "pending" | "approved" | "denied";
    note: string | null;
  } | null;
};

export type WorkoutSnapshot = {
  session: {
    _id: string;
    startedAt: number;
    resumedAt: number | null;
    lastSetAt: number | null;
    note: string | null;
  } | null;
  sets: SetLine[];
  /** Checklist for a routine or a repeat. Older snapshots omit it. */
  plan: PendingPlan | null;
};

export function accountKey(email: string | null): string {
  const normalized = email?.trim().toLowerCase();
  return normalized && normalized.length > 0 ? normalized : "signed-in";
}

export function loadOutbox(store: KeyValueStore, email: string | null): Outbox {
  try {
    migrateAccountStorage(store, email);
  } catch (error) {
    if (!(error instanceof OfflineStorageError)) {
      throw error;
    }
    // A nearly full phone can fail to copy an older queue to its new key.
    // Read the older keys as they are, so those changes still show as pending
    // and still sync, and sign-out warns before it discards them.
    return repairOpenSession(readUnmigratedOutbox(store, email));
  }
  return repairOpenSession(readJson(store, outboxKey(email), parseOutbox, emptyOutbox()));
}

function readUnmigratedOutbox(store: KeyValueStore, email: string | null): Outbox {
  const keys = [outboxKey(email), legacyOutboxKey(email)];
  if (accountKey(ownerEmail(store, email)) === accountKey(email)) {
    keys.push(`${PREFIX}outbox`);
  }
  return keys.reduce(
    (merged, key) => mergeOutboxes(merged, readJson(store, key, parseOutbox, emptyOutbox())),
    emptyOutbox(),
  );
}

export function saveOutbox(store: KeyValueStore, email: string | null, outbox: Outbox): void {
  if (writesSuspended) {
    return;
  }
  store.set(outboxKey(email), JSON.stringify(outbox));
}

export function loadSnapshot(store: KeyValueStore, email: string | null): WorkoutSnapshot | null {
  migrateAccountStorage(store, email);
  return readJson(store, snapshotKey(email), parseSnapshot, null);
}

export function saveSnapshot(
  store: KeyValueStore,
  email: string | null,
  snapshot: WorkoutSnapshot,
): void {
  if (writesSuspended) {
    return;
  }
  store.set(snapshotKey(email), JSON.stringify(snapshot));
}

export function loadCachedAccess(store: KeyValueStore): CachedAccess | null {
  return readJson(store, `${PREFIX}access`, parseAccess, null);
}

export function saveCachedAccess(store: KeyValueStore, access: CachedAccess): void {
  if (writesSuspended) {
    return;
  }
  store.set(`${PREFIX}access`, JSON.stringify(access));
}

export function loadWeightUnit(store: KeyValueStore): "lb" | "kg" | null {
  const value = store.get(`${PREFIX}unit`);
  return value === "lb" || value === "kg" ? value : null;
}

export function saveWeightUnit(store: KeyValueStore, unit: "lb" | "kg"): void {
  if (writesSuspended) {
    return;
  }
  store.set(`${PREFIX}unit`, unit);
}

export function loadLengthUnit(store: KeyValueStore): "in" | "cm" | null {
  const value = store.get(`${PREFIX}length`);
  return value === "in" || value === "cm" ? value : null;
}

export function saveLengthUnit(store: KeyValueStore, unit: "in" | "cm"): void {
  if (writesSuspended) {
    return;
  }
  store.set(`${PREFIX}length`, unit);
}

export type CachedProgression = {
  enabled: boolean;
  incrementLb: number | null;
};

export function loadProgression(store: KeyValueStore): CachedProgression | null {
  const raw = store.get(`${PREFIX}progression`);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }
    const row = parsed as Record<string, unknown>;
    if (typeof row.enabled !== "boolean") {
      return null;
    }
    const incrementLb =
      typeof row.incrementLb === "number" ? row.incrementLb : row.incrementLb === null ? null : undefined;
    if (incrementLb === undefined) {
      return null;
    }
    return { enabled: row.enabled, incrementLb };
  } catch {
    return null;
  }
}

export function saveProgression(store: KeyValueStore, progression: CachedProgression): void {
  if (writesSuspended) {
    return;
  }
  store.set(`${PREFIX}progression`, JSON.stringify(progression));
}

/**
 * Removes this account's on-device queue and session cache.
 * Another account's queue is left in place.
 */
export function clearOfflineStorage(store: KeyValueStore, email: string | null): void {
  writesSuspended = true;
  try {
    migrateAccountStorage(store, email);
  } catch (error) {
    if (!(error instanceof OfflineStorageError)) {
      throw error;
    }
  }
  const account = accountKey(email);
  const exact = new Set([
    `${PREFIX}outbox:${account}`,
    `${PREFIX}snapshot:${account}`,
    `${PREFIX}routines:${account}`,
    `${PREFIX}pending-plan:${account}`,
    `${PREFIX}access`,
    `${PREFIX}unit`,
    `${PREFIX}length`,
    `${PREFIX}progression`,
  ]);
  const prefix = `${ACCOUNT_PREFIX}${account}:`;
  for (const key of store.keys()) {
    if (exact.has(key) || key.startsWith(prefix)) {
      store.remove(key);
    }
  }
}

/** Turns storage exceptions into OfflineStorageError so a blocked phone cannot crash the app. */
export function guardStore(store: KeyValueStore): KeyValueStore {
  return {
    get(key) {
      try {
        return store.get(key);
      } catch (error) {
        if (error instanceof OfflineStorageError) {
          throw error;
        }
        throw new OfflineStorageError();
      }
    },
    set(key, value) {
      try {
        store.set(key, value);
      } catch (error) {
        if (error instanceof OfflineStorageError) {
          throw error;
        }
        throw new OfflineStorageError();
      }
    },
    remove(key) {
      try {
        store.remove(key);
      } catch (error) {
        if (error instanceof OfflineStorageError) {
          throw error;
        }
        throw new OfflineStorageError();
      }
    },
    keys() {
      try {
        return store.keys();
      } catch (error) {
        if (error instanceof OfflineStorageError) {
          throw error;
        }
        throw new OfflineStorageError();
      }
    },
  };
}

export function browserStore(): KeyValueStore {
  return guardStore({
    get(key) {
      return localStorage.getItem(key);
    },
    set(key, value) {
      localStorage.setItem(key, value);
    },
    remove(key) {
      localStorage.removeItem(key);
    },
    keys() {
      const names: string[] = [];
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (key) {
          names.push(key);
        }
      }
      return names;
    },
  });
}

/**
 * For caches the server can rebuild: cached access, units, routines, the
 * pending plan, progression, and the workout snapshot. A full or blocked
 * store reads as empty and skips writes instead of throwing, so the screens
 * that keep these caches still render. The offline queue keeps using
 * `browserStore`, whose errors it reports.
 */
export function cacheStore(): KeyValueStore {
  const store = browserStore();
  return {
    get(key) {
      try {
        return store.get(key);
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        store.set(key, value);
      } catch {
        // The cache is rebuilt from the server on the next load.
      }
    },
    remove(key) {
      try {
        store.remove(key);
      } catch {
        // Same as a failed write: the stale entry is overwritten later.
      }
    },
    keys() {
      try {
        return store.keys();
      } catch {
        return [];
      }
    },
  };
}

/** Raw queue JSON, after the caller has migrated. Used to skip a no-op write. */
export function peekOutboxRaw(store: KeyValueStore, email: string | null): string | null {
  return store.get(outboxKey(email));
}

export function pendingRestKey(email: string | null): string {
  return `${ACCOUNT_PREFIX}${accountKey(email)}:pending-rest`;
}

export function rememberedRestKey(email: string | null): string {
  return `${ACCOUNT_PREFIX}${accountKey(email)}:exercise-rest`;
}

/** Unsent composer text in this tab's sessionStorage. Another account never sees it. */
export function composerTextKey(email: string | null): string {
  return `${ACCOUNT_PREFIX}${accountKey(email)}:composer-text`;
}

/**
 * Copies the previous on-device queue into per-account keys.
 * The old key is removed only after the new key reads back the same bytes.
 */
export function migrateAccountStorage(store: KeyValueStore, email: string | null): void {
  const owner = ownerEmail(store, email);
  moveOutbox(store, `${PREFIX}outbox`, outboxKey(owner));
  moveOutbox(store, legacyOutboxKey(email), outboxKey(email));
  if (accountKey(owner) !== accountKey(email)) {
    moveOutbox(store, legacyOutboxKey(owner), outboxKey(owner));
  }
  moveSnapshot(store, `${PREFIX}snapshot`, snapshotKey(owner));
  moveSnapshot(store, legacySnapshotKey(email), snapshotKey(email));
  moveRest(store, `${PREFIX}pending-rest`, pendingRestKey(owner));
  moveRest(store, `${PREFIX}exercise-rest`, rememberedRestKey(owner));
}

function ownerEmail(store: KeyValueStore, fallback: string | null): string | null {
  const access = loadCachedAccess(store);
  return access?.email ?? fallback;
}

function outboxKey(email: string | null): string {
  return `${ACCOUNT_PREFIX}${accountKey(email)}:outbox`;
}

function snapshotKey(email: string | null): string {
  return `${ACCOUNT_PREFIX}${accountKey(email)}:snapshot`;
}

function legacyOutboxKey(email: string | null): string {
  return `${PREFIX}outbox:${accountKey(email)}`;
}

function legacySnapshotKey(email: string | null): string {
  return `${PREFIX}snapshot:${accountKey(email)}`;
}

function moveOutbox(store: KeyValueStore, from: string, to: string): void {
  const oldRaw = store.get(from);
  if (!oldRaw) {
    return;
  }
  const current = store.get(to);
  let next = oldRaw;
  if (current) {
    try {
      const merged = mergeOutboxes(
        parseOutbox(JSON.parse(oldRaw) as unknown),
        parseOutbox(JSON.parse(current) as unknown),
      );
      next = JSON.stringify(merged);
    } catch {
      return;
    }
  }
  commitMove(store, from, to, next);
}

function moveSnapshot(store: KeyValueStore, from: string, to: string): void {
  const oldRaw = store.get(from);
  if (!oldRaw) {
    return;
  }
  const current = store.get(to);
  const next = current ? preferSnapshot(oldRaw, current) : oldRaw;
  commitMove(store, from, to, next);
}

function moveRest(store: KeyValueStore, from: string, to: string): void {
  const oldRaw = store.get(from);
  if (!oldRaw) {
    return;
  }
  const current = store.get(to);
  let next = oldRaw;
  if (current) {
    try {
      next = JSON.stringify(mergeRestLists(parseRestList(oldRaw), parseRestList(current)));
    } catch {
      return;
    }
  }
  commitMove(store, from, to, next);
}

function commitMove(store: KeyValueStore, from: string, to: string, next: string): void {
  store.set(to, next);
  if (store.get(to) !== next) {
    return;
  }
  store.remove(from);
}

function preferSnapshot(oldRaw: string, current: string): string {
  try {
    const oldSets = setCount(oldRaw);
    const newSets = setCount(current);
    return oldSets > newSets ? oldRaw : current;
  } catch {
    return current;
  }
}

function setCount(raw: string): number {
  const parsed = JSON.parse(raw) as { sets?: unknown };
  return Array.isArray(parsed.sets) ? parsed.sets.length : 0;
}

function parseRestList(raw: string): Array<{ name: string; restSeconds: number | null }> {
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    return [];
  }
  const rests: Array<{ name: string; restSeconds: number | null }> = [];
  for (const item of parsed) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const row = item as { name?: unknown; restSeconds?: unknown };
    if (typeof row.name !== "string") {
      continue;
    }
    const restSeconds =
      typeof row.restSeconds === "number" ? row.restSeconds : row.restSeconds === null ? null : undefined;
    if (restSeconds === undefined) {
      continue;
    }
    rests.push({ name: row.name, restSeconds });
  }
  return rests;
}

function mergeRestLists(
  older: Array<{ name: string; restSeconds: number | null }>,
  newer: Array<{ name: string; restSeconds: number | null }>,
): Array<{ name: string; restSeconds: number | null }> {
  const map = new Map<string, { name: string; restSeconds: number | null }>();
  for (const item of [...older, ...newer]) {
    map.set(item.name, item);
  }
  return [...map.values()];
}

function readJson<T>(
  store: KeyValueStore,
  key: string,
  parse: (value: unknown) => T,
  fallback: T,
): T {
  const raw = store.get(key);
  if (!raw) {
    return fallback;
  }
  try {
    return parse(JSON.parse(raw) as unknown);
  } catch {
    return fallback;
  }
}

function parseSnapshot(value: unknown): WorkoutSnapshot | null {
  if (typeof value !== "object" || value === null || !("session" in value) || !("sets" in value)) {
    return null;
  }
  const record = value as { session: unknown; sets: unknown; plan?: unknown };
  if (!Array.isArray(record.sets)) {
    return null;
  }
  const sets: SetLine[] = [];
  for (const item of record.sets) {
    const set = parseSetLine(item);
    if (set) {
      sets.push(set);
    }
  }
  return {
    session: parseSession(record.session),
    sets,
    plan: parseSnapshotPlan(record.plan ?? null),
  };
}

function parseSnapshotPlan(value: unknown): PendingPlan | null {
  if (typeof value !== "object" || value === null || !("exercises" in value)) {
    return null;
  }
  const plan = value as Record<string, unknown>;
  if (typeof plan.startedAt !== "number" || !Array.isArray(plan.exercises)) {
    return null;
  }
  const exercises: PendingPlan["exercises"] = [];
  for (const item of plan.exercises) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const exercise = item as Record<string, unknown>;
    if (typeof exercise.exerciseId !== "string" || typeof exercise.name !== "string") {
      continue;
    }
    exercises.push({
      exerciseId: exercise.exerciseId,
      name: exercise.name,
      targetSets: typeof exercise.targetSets === "number" ? exercise.targetSets : null,
      targetReps: typeof exercise.targetReps === "number" ? exercise.targetReps : null,
      targetWeightLb: typeof exercise.targetWeightLb === "number" ? exercise.targetWeightLb : null,
      targetDurationSec:
        typeof exercise.targetDurationSec === "number" ? exercise.targetDurationSec : null,
      targetDistanceM: typeof exercise.targetDistanceM === "number" ? exercise.targetDistanceM : null,
      targetCalories: typeof exercise.targetCalories === "number" ? exercise.targetCalories : null,
      restSeconds: typeof exercise.restSeconds === "number" ? exercise.restSeconds : null,
      supersetId:
        typeof exercise.supersetId === "string" && exercise.supersetId.length > 0
          ? exercise.supersetId
          : null,
      skipped: exercise.skipped === true,
    });
  }
  if (exercises.length === 0) {
    return null;
  }
  return {
    startedAt: plan.startedAt,
    name: typeof plan.name === "string" ? plan.name : null,
    routineId: typeof plan.routineId === "string" ? plan.routineId : null,
    exercises,
  };
}

function parseSession(value: unknown): WorkoutSnapshot["session"] {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const session = value as Record<string, unknown>;
  if (typeof session._id !== "string" || typeof session.startedAt !== "number") {
    return null;
  }
  return {
    _id: session._id,
    startedAt: session.startedAt,
    resumedAt: typeof session.resumedAt === "number" ? session.resumedAt : null,
    lastSetAt: typeof session.lastSetAt === "number" ? session.lastSetAt : null,
    note: typeof session.note === "string" ? session.note : null,
  };
}

function parseSetLine(value: unknown): SetLine | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const set = value as Record<string, unknown>;
  if (
    typeof set._id !== "string" ||
    typeof set.exerciseId !== "string" ||
    typeof set.exerciseName !== "string" ||
    typeof set.weightLb !== "number" ||
    typeof set.loggedAt !== "number"
  ) {
    return null;
  }
  return {
    _id: set._id,
    exerciseId: set.exerciseId,
    exerciseName: set.exerciseName,
    reps: typeof set.reps === "number" ? set.reps : null,
    weightLb: set.weightLb,
    durationSec: typeof set.durationSec === "number" ? set.durationSec : null,
    distanceM: typeof set.distanceM === "number" ? set.distanceM : null,
    calories: typeof set.calories === "number" ? set.calories : null,
    rpe: typeof set.rpe === "number" ? set.rpe : null,
    ...(isSetType(set.setType) ? { setType: set.setType } : {}),
    loggedAt: set.loggedAt,
    clientId: typeof set.clientId === "string" ? set.clientId : null,
  };
}

function parseAccess(value: unknown): CachedAccess | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const access = value as Record<string, unknown>;
  if (typeof access.allowed !== "boolean" || typeof access.isAdmin !== "boolean") {
    return null;
  }
  let request: CachedAccess["request"] = null;
  if (typeof access.request === "object" && access.request !== null) {
    const item = access.request as Record<string, unknown>;
    if (item.status === "pending" || item.status === "approved" || item.status === "denied") {
      request = {
        status: item.status,
        note: typeof item.note === "string" ? item.note : null,
      };
    }
  }
  return {
    email: typeof access.email === "string" ? access.email : null,
    name: typeof access.name === "string" ? access.name : null,
    allowed: access.allowed,
    isAdmin: access.isAdmin,
    request,
  };
}
