import {
  formatCalories,
  formatClock,
  formatDistance,
  setKind,
} from "../convex/lib/measures.ts";
import { countsTowardVolume, setTypeSpeech } from "../convex/lib/setType.ts";
import { formatWeightAmount, LB_PER_KG, type WeightUnit } from "../convex/lib/units.ts";

type DisplaySet = {
  reps?: number | null;
  weightLb: number;
  durationSec?: number | null;
  distanceM?: number | null;
  calories?: number | null;
  rpe?: number | null;
  setType?: string | null;
};

export function formatWeightLb(weightLb: number, unit: WeightUnit = "lb"): string {
  if (weightLb === 0) {
    return "bodyweight";
  }
  return `${formatWeightAmount(weightLb, unit)} ${unit}`;
}

function appendCalories(label: string, calories: number | null | undefined): string {
  if ((calories ?? 0) <= 0) {
    return label;
  }
  return `${label} · ${formatCalories(calories ?? 0)}`;
}

/** Compact set label for lists: "10×135", "1:00", "2 km", or "20×BW". */
export function formatSetShort(set: DisplaySet, unit: WeightUnit = "lb"): string {
  const kind = setKind(set);
  let label: string;
  if (kind === "timed") {
    label = formatClock(set.durationSec ?? 0);
    if (set.weightLb > 0) {
      label += ` @ ${formatWeightAmount(set.weightLb, unit)}`;
    }
  } else if (kind === "distance") {
    label = formatDistance(set.distanceM ?? 0);
    if (set.durationSec) {
      label += ` in ${formatClock(set.durationSec)}`;
    }
    if (set.weightLb > 0) {
      label += ` @ ${formatWeightAmount(set.weightLb, unit)}`;
    }
  } else if (set.weightLb === 0) {
    label = `${set.reps ?? 0}×BW`;
  } else {
    label = `${set.reps ?? 0}×${formatWeightAmount(set.weightLb, unit)}`;
  }
  if (set.rpe) {
    label += ` RPE ${set.rpe}`;
  }
  return appendCalories(label, set.calories);
}

/**
 * Previous-workout summary. Uniform work reads "Last time: 3×10 @ 135".
 * Mixed sets fall back to the compact list labels.
 */
export function formatLastTime(sets: DisplaySet[], unit: WeightUnit = "lb"): string | null {
  const counted = sets.filter((set) => countsTowardVolume(set));
  const first = counted[0];
  if (!first) {
    return null;
  }
  const uniform = counted.every(
    (set) =>
      (set.reps ?? null) === (first.reps ?? null) &&
      set.weightLb === first.weightLb &&
      (set.durationSec ?? null) === (first.durationSec ?? null) &&
      (set.distanceM ?? null) === (first.distanceM ?? null) &&
      (set.calories ?? null) === (first.calories ?? null),
  );
  if (uniform && setKind(first) === "strength") {
    if (first.weightLb === 0) {
      return `Last time: ${counted.length}×${first.reps ?? 0} bodyweight`;
    }
    const load = formatWeightAmount(first.weightLb, unit);
    return `Last time: ${counted.length}×${first.reps ?? 0} @ ${load}`;
  }
  if (uniform) {
    return `Last time: ${counted.length}×${formatSetShort(first, unit)}`;
  }
  return `Last time: ${counted.map((set) => formatSetShort(set, unit)).join(", ")}`;
}

/** Spoken-style set label for screen readers and buttons. */
export function describeSet(set: DisplaySet, unit: WeightUnit = "lb"): string {
  const kind = setKind(set);
  let label: string;
  if (kind === "timed") {
    label = describeDuration(set.durationSec ?? 0);
    label += set.weightLb > 0 ? ` at ${formatWeightLb(set.weightLb, unit)}` : ", bodyweight";
  } else if (kind === "distance") {
    label = describeDistance(set.distanceM ?? 0);
    if (set.durationSec) {
      label += ` in ${describeDuration(set.durationSec)}`;
    }
    if (set.weightLb > 0) {
      label += ` at ${formatWeightLb(set.weightLb, unit)}`;
    }
  } else {
    const reps = set.reps ?? 0;
    const repsLabel = `${reps} ${reps === 1 ? "rep" : "reps"}`;
    label =
      set.weightLb === 0
        ? `${repsLabel}, bodyweight`
        : `${repsLabel} at ${formatWeightLb(set.weightLb, unit)}`;
  }
  if ((set.calories ?? 0) > 0) {
    label += `, ${set.calories} calories`;
  }
  if (set.rpe) {
    label += `, RPE ${set.rpe}`;
  }
  const speech = setTypeSpeech(set.setType);
  if (speech) {
    label += `, ${speech}`;
  }
  return label;
}

function describeDuration(totalSeconds: number): string {
  const whole = Math.max(0, Math.round(totalSeconds));
  if (whole < 60) {
    return `${whole} ${whole === 1 ? "second" : "seconds"}`;
  }
  const minutes = Math.floor(whole / 60);
  const seconds = whole % 60;
  const minuteLabel = `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  if (seconds === 0) {
    return minuteLabel;
  }
  return `${minuteLabel} ${seconds} ${seconds === 1 ? "second" : "seconds"}`;
}

function describeDistance(meters: number): string {
  const label = formatDistance(meters);
  if (label.endsWith(" km")) {
    const amount = label.slice(0, -3);
    return `${amount} ${amount === "1" ? "kilometer" : "kilometers"}`;
  }
  if (label.endsWith(" mi")) {
    const amount = label.slice(0, -3);
    return `${amount} ${amount === "1" ? "mile" : "miles"}`;
  }
  const amount = label.slice(0, -2);
  return `${amount} ${amount === "1" ? "meter" : "meters"}`;
}

/** Stopwatch time: "4:05", or "1:02:05" past an hour. */
export function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const ss = String(seconds).padStart(2, "0");
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${ss}`;
  }
  return `${minutes}:${ss}`;
}

/**
 * Workout length, or null when the end was stored as the start.
 * Past workouts do that because their length was never recorded.
 */
export function formatWorkoutLength(startedAt: number, completedAt: number): string | null {
  if (completedAt <= startedAt) {
    return null;
  }
  return formatDuration(completedAt - startedAt);
}

/** Workout length: "52 min", or "1 h 5 min". Under a minute counts as 1 min. */
export function formatDuration(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

export function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

/** "9,420 lb", or the same volume in kilograms when that is the display unit. */
export function formatVolumeLb(volumeLb: number, unit: WeightUnit = "lb"): string {
  const amount = unit === "kg" ? volumeLb / LB_PER_KG : volumeLb;
  const rounded = Math.round(amount);
  const digits = String(Math.abs(rounded));
  const withCommas = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${rounded < 0 ? "-" : ""}${withCommas} ${unit}`;
}

export function streakLabel(weeks: number): string {
  if (weeks <= 0) {
    return "No streak yet";
  }
  if (weeks === 1) {
    return "1-week streak";
  }
  return `${weeks}-week streak`;
}

/** "bench press · 225 lb", the record without the "New PR" lead-in. */
export function formatRecordDetail(
  record: {
    exerciseName: string;
    kind: "weight" | "epley" | "both" | "reps" | "duration" | "distance" | "calories";
    reps: number | null;
    weightLb: number;
    epleyLb: number | null;
    durationSec?: number | null;
    distanceM?: number | null;
    calories?: number | null;
  },
  unit: WeightUnit = "lb",
): string {
  if (record.kind === "calories") {
    return `${record.exerciseName} · ${formatCalories(record.calories ?? 0)}`;
  }
  if (record.kind === "duration") {
    const time = formatClock(record.durationSec ?? 0);
    const load = record.weightLb > 0 ? ` at ${formatWeightLb(record.weightLb, unit)}` : "";
    return `${record.exerciseName} · ${time}${load}`;
  }
  if (record.kind === "distance") {
    const distance = formatDistance(record.distanceM ?? 0);
    const time = record.durationSec ? ` in ${formatClock(record.durationSec)}` : "";
    return `${record.exerciseName} · ${distance}${time}`;
  }
  if (record.kind === "reps") {
    return `${record.exerciseName} · ${pluralize(record.reps ?? 0, "rep")}`;
  }
  const load = formatWeightLb(record.weightLb, unit);
  const estimate =
    record.epleyLb === null ? null : `est. 1RM ${formatVolumeLb(record.epleyLb, unit)}`;
  if (record.kind === "epley" && estimate) {
    return `${record.exerciseName} · ${estimate}`;
  }
  if (record.kind === "both" && estimate) {
    return `${record.exerciseName} · ${load} · ${estimate}`;
  }
  return `${record.exerciseName} · ${load}`;
}

export function formatPersonalRecord(
  record: Parameters<typeof formatRecordDetail>[0],
  unit: WeightUnit = "lb",
): string {
  return `New PR · ${formatRecordDetail(record, unit)}`;
}

export function formatPersonalRecords(
  records: Array<{
    exerciseName: string;
    kind: "weight" | "epley" | "both" | "reps" | "duration" | "distance" | "calories";
    reps: number | null;
    weightLb: number;
    epleyLb: number | null;
    durationSec?: number | null;
    distanceM?: number | null;
    calories?: number | null;
  }>,
  unit: WeightUnit = "lb",
): string | null {
  const first = records[0];
  if (!first) {
    return null;
  }
  if (records.length === 1) {
    return formatPersonalRecord(first, unit);
  }
  const names: string[] = [];
  for (const record of records) {
    if (!names.includes(record.exerciseName)) {
      names.push(record.exerciseName);
    }
  }
  return `New PRs · ${names.join(", ")}`;
}

/** Page title for a day: "Tue, Oct 13", with the year when it isn't this year. Fits on one line. */
export function formatDayTitle(timestamp: number, now: number = Date.now()): string {
  const sameYear = new Date(timestamp).getFullYear() === new Date(now).getFullYear();
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(timestamp);
}

/** "Sun, Oct 11" */
export function formatShortDate(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(timestamp);
}

/** "Sunday, October 11" */
export function formatLongDate(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(timestamp);
}

/** "6:42 PM" */
export function formatTimeOfDay(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(timestamp);
}

/** "October", or "October 2025" outside the current year. */
export function formatMonthHeading(timestamp: number, now = Date.now()): string {
  const sameYear = new Date(timestamp).getFullYear() === new Date(now).getFullYear();
  return new Intl.DateTimeFormat(undefined, {
    month: "long",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(timestamp);
}

export function monthKey(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${date.getMonth()}`;
}

/** Default routine name: the weekday the workout happened, such as "Sunday". */
export function suggestRoutineName(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(timestamp);
}

/** "3×10 · 60 kg", "3×1:00", "5 km", or "3 sets" when the sets were mixed. */
export function formatRoutineTarget(
  target: {
    targetSets?: number | null;
    targetReps?: number | null;
    targetWeightLb?: number | null;
    targetDurationSec?: number | null;
    targetDistanceM?: number | null;
    targetCalories?: number | null;
  },
  unit: WeightUnit = "lb",
): string | null {
  const sets = target.targetSets ?? null;
  const reps = target.targetReps ?? null;
  const weight = target.targetWeightLb;
  const duration = target.targetDurationSec ?? null;
  const distance = target.targetDistanceM ?? null;
  const calories = target.targetCalories ?? null;
  const calorieLabel = calories && calories > 0 ? ` · ${formatCalories(calories)}` : "";
  const load =
    weight === undefined || weight === null
      ? null
      : weight === 0
        ? "bodyweight"
        : formatWeightLb(weight, unit);

  if (distance) {
    let label = formatDistance(distance);
    if (duration) {
      label += ` in ${formatClock(duration)}`;
    }
    if (load && load !== "bodyweight") {
      label += ` · ${load}`;
    }
    label += calorieLabel;
    return sets && sets > 1 ? `${sets}×${label}` : label;
  }
  if (duration && reps === null) {
    let label = formatClock(duration);
    if (load && load !== "bodyweight") {
      label += ` · ${load}`;
    }
    label += calorieLabel;
    return sets ? `${sets}×${label}` : label;
  }
  if (reps) {
    const body = sets ? `${sets}×${reps}` : pluralize(reps, "rep");
    const label = load ? `${body} · ${load}` : body;
    return `${label}${calorieLabel}`;
  }
  if (sets) {
    return pluralize(sets, "set");
  }
  return null;
}
