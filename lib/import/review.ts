import { exerciseNameKey } from "../../convex/lib/exerciseName";
import type { VoiceSet } from "../voice/proposal";
import { calendarDayBounds } from "../historyDays";
import type { ImportBodyEntry, ImportProposal, ImportWorkout } from "./proposal";

/** logPast's limits. A bigger workout from a file is saved in pieces. */
const MAX_SAVE_SETS = 120;
const MAX_SAVE_EXERCISES = 40;
/** When a file gives no time, the middle of the day keeps the date right in every time zone. */
const DEFAULT_HOUR = 12;

export type ExistingDay = {
  exerciseKeys: Set<string>;
  body: Array<Pick<ImportBodyEntry, BodyField>>;
};

type BodyField = "weightLb" | "bodyFatPct" | "waistCm" | "chestCm" | "armCm" | "hipsCm" | "thighCm";
const BODY_FIELDS: Array<[BodyField, number]> = [
  ["weightLb", 0.25],
  ["bodyFatPct", 0.1],
  ["waistCm", 0.25],
  ["chestCm", 0.25],
  ["armCm", 0.25],
  ["hipsCm", 0.25],
  ["thighCm", 0.25],
];

export type ReviewWorkout = {
  id: string;
  date: string;
  startedAt: number;
  note: string | null;
  exercises: Array<{ exerciseName: string; sets: VoiceSet[]; duplicate: boolean }>;
  /** Every exercise is already logged that day. */
  duplicate: boolean;
};

export type ReviewBodyEntry = Omit<ImportBodyEntry, "time"> & {
  id: string;
  loggedAt: number;
  duplicate: boolean;
};

export type ImportReview = {
  workouts: ReviewWorkout[];
  body: ReviewBodyEntry[];
  unreadable: number;
};

/**
 * Joins the parts of one file. A workout split across two parts comes back
 * as one, and an exercise named twice in a workout keeps all of its sets.
 */
export function mergeProposals(proposals: readonly ImportProposal[]): ImportProposal {
  const workouts = new Map<string, ImportWorkout>();
  const body = new Map<string, ImportBodyEntry>();
  let unreadable = 0;
  for (const proposal of proposals) {
    unreadable += proposal.unreadable;
    for (const workout of proposal.workouts) {
      const key = `${workout.date} ${workout.time ?? ""}`;
      const existing = workouts.get(key);
      if (!existing) {
        workouts.set(key, {
          ...workout,
          exercises: workout.exercises.map((exercise) => ({ ...exercise, sets: [...exercise.sets] })),
        });
        continue;
      }
      existing.note = existing.note ?? workout.note;
      for (const exercise of workout.exercises) {
        const nameKey = exerciseNameKey(exercise.exerciseName);
        const same = existing.exercises.find((item) => exerciseNameKey(item.exerciseName) === nameKey);
        if (same) {
          same.sets.push(...exercise.sets);
        } else {
          existing.exercises.push({ ...exercise, sets: [...exercise.sets] });
        }
      }
    }
    for (const entry of proposal.body) {
      // The same row read twice, for example a header-only overlap, is one entry.
      const key = JSON.stringify([entry.date, ...BODY_FIELDS.map(([field]) => entry[field])]);
      if (!body.has(key)) {
        body.set(key, entry);
      }
    }
  }
  return {
    workouts: [...workouts.values()].sort((a, b) =>
      `${a.date} ${a.time ?? ""}`.localeCompare(`${b.date} ${b.time ?? ""}`),
    ),
    body: [...body.values()].sort((a, b) => `${a.date} ${a.time ?? ""}`.localeCompare(`${b.date} ${b.time ?? ""}`)),
    unreadable,
  };
}

/** Local time for a file's date and time, never later than now. Null for a day still to come. */
export function localTimestamp(date: string, time: string | null, now: number): number | null {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time ? time.split(":").map(Number) : [DEFAULT_HOUR, 0];
  if (!year || !month || !day) {
    return null;
  }
  const at = new Date(year, month - 1, day, hour ?? DEFAULT_HOUR, minute ?? 0).getTime();
  if (!Number.isFinite(at)) {
    return null;
  }
  if (at <= now) {
    return at;
  }
  // Today with no time, or a time later today: keep today's date.
  const bounds = calendarDayBounds(date);
  return bounds && bounds.start <= now ? now : null;
}

/** The local days a file covers, with their bounds, for the duplicate check. */
export function importDays(proposal: ImportProposal): Array<{ key: string; start: number; end: number }> {
  const keys = new Set<string>([
    ...proposal.workouts.map((workout) => workout.date),
    ...proposal.body.map((entry) => entry.date),
  ]);
  const days: Array<{ key: string; start: number; end: number }> = [];
  for (const key of [...keys].sort()) {
    const bounds = calendarDayBounds(key);
    if (bounds) {
      days.push({ key, ...bounds });
    }
  }
  return days;
}

/**
 * Marks what is already logged. An exercise with sets on that day is a
 * duplicate, and so is a body entry whose every given value matches one that day.
 */
export function reviewImport(
  proposal: ImportProposal,
  existing: ReadonlyMap<string, ExistingDay>,
  now: number,
): ImportReview {
  let unreadable = proposal.unreadable;
  const workouts: ReviewWorkout[] = [];
  proposal.workouts.forEach((workout, index) => {
    const startedAt = localTimestamp(workout.date, workout.time, now);
    if (startedAt === null) {
      unreadable += 1;
      return;
    }
    const logged = existing.get(workout.date)?.exerciseKeys ?? new Set<string>();
    const exercises = workout.exercises.map((exercise) => ({
      ...exercise,
      duplicate: logged.has(exerciseNameKey(exercise.exerciseName)),
    }));
    workouts.push({
      id: `w${index}`,
      date: workout.date,
      startedAt,
      note: workout.note,
      exercises,
      duplicate: exercises.every((exercise) => exercise.duplicate),
    });
  });

  const body: ReviewBodyEntry[] = [];
  proposal.body.forEach((entry, index) => {
    const loggedAt = localTimestamp(entry.date, entry.time, now);
    if (loggedAt === null) {
      unreadable += 1;
      return;
    }
    const { time: _time, ...rest } = entry;
    void _time;
    const sameDay = existing.get(entry.date)?.body ?? [];
    body.push({
      ...rest,
      id: `b${index}`,
      loggedAt,
      duplicate: sameDay.some((logged) => sameBodyValues(entry, logged)),
    });
  });

  return { workouts, body, unreadable };
}

function sameBodyValues(entry: Pick<ImportBodyEntry, BodyField>, logged: Pick<ImportBodyEntry, BodyField>): boolean {
  return BODY_FIELDS.every(([field, tolerance]) => {
    const value = entry[field];
    if (value === null) {
      return true;
    }
    const other = logged[field];
    return other !== null && Math.abs(other - value) <= tolerance;
  });
}

export type PastWorkoutSave = {
  startedAt: number;
  note?: string;
  exercises: Array<{
    name: string;
    sets: Array<{
      reps?: number;
      weightLb: number;
      durationSec?: number;
      distanceM?: number;
      calories?: number;
      rpe?: number;
      setType?: VoiceSet["setType"];
    }>;
  }>;
};

/**
 * What sessions.logPast saves for one workout, leaving out duplicate exercises.
 * A workout larger than logPast takes is split into pieces a second apart.
 */
export function workoutSaves(workout: ReviewWorkout): PastWorkoutSave[] {
  const saves: PastWorkoutSave[] = [];
  let current: PastWorkoutSave["exercises"] = [];
  let setCount = 0;
  const flush = () => {
    if (current.length > 0) {
      saves.push({
        startedAt: workout.startedAt + saves.length * 1000,
        ...(saves.length === 0 && workout.note ? { note: workout.note } : {}),
        exercises: current,
      });
    }
    current = [];
    setCount = 0;
  };
  for (const exercise of workout.exercises) {
    if (exercise.duplicate) {
      continue;
    }
    for (let start = 0; start < exercise.sets.length; start += MAX_SAVE_SETS) {
      const sets = exercise.sets.slice(start, start + MAX_SAVE_SETS);
      if (setCount + sets.length > MAX_SAVE_SETS || current.length >= MAX_SAVE_EXERCISES) {
        flush();
      }
      current.push({ name: exercise.exerciseName, sets: sets.map(savedSet) });
      setCount += sets.length;
    }
  }
  flush();
  return saves;
}

function savedSet(set: VoiceSet): PastWorkoutSave["exercises"][number]["sets"][number] {
  return {
    weightLb: set.weightLb,
    ...(set.reps !== null ? { reps: set.reps } : {}),
    ...(set.durationSec !== null ? { durationSec: set.durationSec } : {}),
    ...(set.distanceM !== null ? { distanceM: set.distanceM } : {}),
    ...(set.calories !== null ? { calories: set.calories } : {}),
    ...(set.rpe !== null ? { rpe: set.rpe } : {}),
    ...(set.setType !== "working" ? { setType: set.setType } : {}),
  };
}
