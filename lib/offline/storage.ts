import { isSetType } from "../../convex/lib/setType.ts";
import type { SetLine } from "../groupSets.ts";
import { emptyOutbox, parseOutbox, type Outbox } from "./outbox.ts";
import type { PendingPlan } from "./routineCache.ts";

const PREFIX = "workout-offline:";

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
  return readJson(store, outboxKey(email), parseOutbox, emptyOutbox());
}

export function saveOutbox(store: KeyValueStore, email: string | null, outbox: Outbox): void {
  if (writesSuspended) {
    return;
  }
  store.set(outboxKey(email), JSON.stringify(outbox));
}

export function loadSnapshot(store: KeyValueStore, email: string | null): WorkoutSnapshot | null {
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

export function clearOfflineStorage(store: KeyValueStore): void {
  writesSuspended = true;
  for (const key of store.keys()) {
    if (key.startsWith(PREFIX)) {
      store.remove(key);
    }
  }
}

export function browserStore(): KeyValueStore {
  return {
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
  };
}

function outboxKey(email: string | null): string {
  return `${PREFIX}outbox:${accountKey(email)}`;
}

function snapshotKey(email: string | null): string {
  return `${PREFIX}snapshot:${accountKey(email)}`;
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
      restSeconds: typeof exercise.restSeconds === "number" ? exercise.restSeconds : null,
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
