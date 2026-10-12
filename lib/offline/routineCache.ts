import { rememberRest } from "../exerciseRest.ts";
import type { KeyValueStore } from "./storage.ts";
import { accountKey } from "./storage.ts";

const PREFIX = "workout-offline:";

export type CachedRoutineExercise = {
  exerciseId: string;
  name: string;
  targetSets: number | null;
  targetReps: number | null;
  targetWeightLb: number | null;
  targetDurationSec: number | null;
  targetDistanceM: number | null;
  targetCalories?: number | null;
  restSeconds: number | null;
  supersetId: string | null;
};

export type CachedRoutine = {
  _id: string;
  name: string;
  exerciseCount: number;
  exerciseNames: string[];
  exercises: CachedRoutineExercise[];
};

export type PendingPlanExercise = CachedRoutineExercise & {
  skipped: boolean;
};

export type PendingPlan = {
  startedAt: number;
  name: string | null;
  routineId: string | null;
  exercises: PendingPlanExercise[];
};

export function loadRoutineCache(
  store: KeyValueStore,
  email: string | null,
): CachedRoutine[] | null {
  return readJson(store, routineKey(email), parseRoutineList, null);
}

export function saveRoutineCache(
  store: KeyValueStore,
  email: string | null,
  routines: CachedRoutine[],
): void {
  store.set(routineKey(email), JSON.stringify(routines));
  for (const routine of routines) {
    for (const exercise of routine.exercises) {
      rememberRest(store, exercise.name, exercise.restSeconds);
    }
  }
}

export function loadPendingPlan(store: KeyValueStore, email: string | null): PendingPlan | null {
  return readJson(store, planKey(email), parsePendingPlan, null);
}

export function savePendingPlan(
  store: KeyValueStore,
  email: string | null,
  plan: PendingPlan,
): void {
  store.set(planKey(email), JSON.stringify(plan));
}

export function clearPendingPlan(store: KeyValueStore, email: string | null): void {
  store.remove(planKey(email));
}

export const PENDING_PLAN_EVENT = "workout-plan";

/** Saves or clears the offline plan and tells the open home screen. */
export function publishPendingPlan(
  store: KeyValueStore,
  email: string | null,
  plan: PendingPlan | null,
): void {
  if (plan) {
    savePendingPlan(store, email, plan);
  } else {
    clearPendingPlan(store, email);
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(PENDING_PLAN_EVENT));
  }
}

function routineKey(email: string | null): string {
  return `${PREFIX}routines:${accountKey(email)}`;
}

function planKey(email: string | null): string {
  return `${PREFIX}pending-plan:${accountKey(email)}`;
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

function parseRoutineList(value: unknown): CachedRoutine[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const routines: CachedRoutine[] = [];
  for (const item of value) {
    const routine = parseRoutine(item);
    if (routine) {
      routines.push(routine);
    }
  }
  return routines;
}

function parseRoutine(value: unknown): CachedRoutine | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const routine = value as Record<string, unknown>;
  if (typeof routine._id !== "string" || typeof routine.name !== "string") {
    return null;
  }
  if (!Array.isArray(routine.exercises)) {
    return null;
  }
  const exercises: CachedRoutineExercise[] = [];
  for (const item of routine.exercises) {
    const exercise = parseExercise(item);
    if (exercise) {
      exercises.push(exercise);
    }
  }
  const names = Array.isArray(routine.exerciseNames)
    ? routine.exerciseNames.filter((name): name is string => typeof name === "string")
    : exercises.map((exercise) => exercise.name);
  return {
    _id: routine._id,
    name: routine.name,
    exerciseCount:
      typeof routine.exerciseCount === "number" ? routine.exerciseCount : exercises.length,
    exerciseNames: names,
    exercises,
  };
}

function parseExercise(value: unknown): CachedRoutineExercise | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const exercise = value as Record<string, unknown>;
  if (typeof exercise.exerciseId !== "string" || typeof exercise.name !== "string") {
    return null;
  }
  return {
    exerciseId: exercise.exerciseId,
    name: exercise.name,
    targetSets: numberOrNull(exercise.targetSets),
    targetReps: numberOrNull(exercise.targetReps),
    targetWeightLb: numberOrNull(exercise.targetWeightLb),
    targetDurationSec: numberOrNull(exercise.targetDurationSec),
    targetDistanceM: numberOrNull(exercise.targetDistanceM),
    targetCalories: numberOrNull(exercise.targetCalories),
    restSeconds: typeof exercise.restSeconds === "number" ? exercise.restSeconds : null,
    supersetId: typeof exercise.supersetId === "string" && exercise.supersetId.length > 0
      ? exercise.supersetId
      : null,
  };
}

function parsePendingPlan(value: unknown): PendingPlan | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const plan = value as Record<string, unknown>;
  if (typeof plan.startedAt !== "number" || !Array.isArray(plan.exercises)) {
    return null;
  }
  const exercises: PendingPlanExercise[] = [];
  for (const item of plan.exercises) {
    const exercise = parseExercise(item);
    if (!exercise) {
      continue;
    }
    const skipped =
      typeof item === "object" &&
      item !== null &&
      "skipped" in item &&
      (item as { skipped?: unknown }).skipped === true;
    exercises.push({ ...exercise, skipped });
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

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
