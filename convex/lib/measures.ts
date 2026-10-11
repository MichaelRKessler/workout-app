import { resolvedSetType, type SetType } from "./setType";
import { roundWeight } from "./units";

export const MAX_DURATION_SEC = 24 * 60 * 60;
export const MAX_DISTANCE_M = 200_000;
export const MAX_NOTE_LENGTH = 500;
export const M_PER_KM = 1000;
export const M_PER_MI = 1609.344;

export type SetKind = "strength" | "timed" | "distance";

export type MeasureInput = {
  reps?: number | null;
  weightLb?: number | null;
  durationSec?: number | null;
  distanceM?: number | null;
  rpe?: number | null;
  setType?: SetType | null;
};

/** Fields written on a set. Absent optionals are left off the document. */
export type NormalizedSet = {
  reps?: number;
  weightLb: number;
  durationSec?: number;
  distanceM?: number;
  rpe?: number;
  setType: SetType;
};

export function setKind(set: {
  reps?: number | null;
  durationSec?: number | null;
  distanceM?: number | null;
}): SetKind {
  if (set.distanceM != null && set.distanceM > 0) {
    return "distance";
  }
  const reps = set.reps ?? 0;
  if (reps <= 0 && set.durationSec != null && set.durationSec > 0) {
    return "timed";
  }
  return "strength";
}

export function normalizeStoredSet(input: MeasureInput): NormalizedSet {
  const reps = optionalReps(input.reps);
  const durationSec = optionalDuration(input.durationSec);
  const distanceM = optionalDistance(input.distanceM);
  const rpe = optionalRpe(input.rpe);
  const weightLb = optionalWeight(input.weightLb);

  if (reps === undefined && durationSec === undefined && distanceM === undefined) {
    throw new Error("Enter reps, a time, or a distance");
  }

  return {
    ...(reps !== undefined ? { reps } : {}),
    weightLb,
    ...(durationSec !== undefined ? { durationSec } : {}),
    ...(distanceM !== undefined ? { distanceM } : {}),
    ...(rpe !== undefined ? { rpe } : {}),
    setType: resolvedSetType(input.setType),
  };
}

export function normalizeNote(raw: string | null | undefined): string | undefined {
  if (raw === undefined || raw === null) {
    return undefined;
  }
  const note = raw.trim().replace(/\s+/g, " ");
  if (note.length === 0) {
    return undefined;
  }
  if (note.length > MAX_NOTE_LENGTH) {
    throw new Error(`Notes must be ${MAX_NOTE_LENGTH} characters or less`);
  }
  return note;
}

/** Append a new remark without dropping the one already on the workout. */
export function combineNotes(existing: string | undefined, next: string | undefined): string | undefined {
  if (!next) {
    return existing;
  }
  if (!existing) {
    return next;
  }
  if (existing === next || existing.endsWith(`\n${next}`)) {
    return existing;
  }
  const combined = `${existing}\n${next}`;
  if (combined.length > MAX_NOTE_LENGTH) {
    throw new Error(`Notes must be ${MAX_NOTE_LENGTH} characters or less`);
  }
  return combined;
}

export function formatClock(totalSeconds: number): string {
  const whole = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const seconds = whole % 60;
  const ss = String(seconds).padStart(2, "0");
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${ss}`;
  }
  return `${minutes}:${ss}`;
}

export function parseClock(value: string): number | null {
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed);
    if (seconds < 1 || seconds > MAX_DURATION_SEC) {
      return null;
    }
    return seconds;
  }
  const parts = trimmed.split(":");
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => !/^\d+$/.test(part))) {
    return null;
  }
  const numbers = parts.map((part) => Number(part));
  const seconds = numbers[numbers.length - 1] ?? 0;
  const minutes = numbers[numbers.length - 2] ?? 0;
  const hours = numbers.length === 3 ? (numbers[0] ?? 0) : 0;
  if (seconds > 59 || minutes > 59) {
    return null;
  }
  const total = hours * 3600 + minutes * 60 + seconds;
  if (total < 1 || total > MAX_DURATION_SEC) {
    return null;
  }
  return total;
}

export function formatDistance(meters: number): string {
  const miles = meters / M_PER_MI;
  const milesRounded = roundWeight(miles);
  if (milesRounded >= 0.1 && Math.abs(milesRounded * M_PER_MI - meters) <= 1) {
    return `${milesRounded} mi`;
  }
  if (meters >= M_PER_KM) {
    return `${roundWeight(meters / M_PER_KM)} km`;
  }
  return `${roundWeight(meters)} m`;
}

export function parseDistanceInput(value: string): number | null {
  const trimmed = value.trim().toLowerCase().replace(/,/g, "");
  const match = /^(\d+(?:\.\d{1,2})?)\s*(m|meters?|km|kilometers?|k|mi|miles?)?$/.exec(trimmed);
  if (!match) {
    return null;
  }
  const amount = Number(match[1]);
  const unit = match[2] ?? "m";
  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }
  let meters = amount;
  if (unit === "km" || unit === "kilometer" || unit === "kilometers" || unit === "k") {
    meters = amount * M_PER_KM;
  } else if (unit === "mi" || unit === "mile" || unit === "miles") {
    meters = amount * M_PER_MI;
  }
  const rounded = roundWeight(meters);
  if (rounded < 1 || rounded > MAX_DISTANCE_M) {
    return null;
  }
  return rounded;
}

function optionalReps(value: number | null | undefined): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!Number.isInteger(value) || value < 1 || value > 999) {
    throw new Error("Reps must be a whole number from 1 to 999");
  }
  return value;
}

function optionalDuration(value: number | null | undefined): number | undefined {
  if (value === undefined || value === null || value === 0) {
    return undefined;
  }
  if (!Number.isInteger(value) || value < 1 || value > MAX_DURATION_SEC) {
    throw new Error("Time must be from 1 second to 24 hours");
  }
  return value;
}

function optionalDistance(value: number | null | undefined): number | undefined {
  if (value === undefined || value === null || value === 0) {
    return undefined;
  }
  if (!Number.isFinite(value) || value < 1 || value > MAX_DISTANCE_M) {
    throw new Error("Distance must be from 1 meter to 200 kilometers");
  }
  return roundWeight(value);
}

function optionalRpe(value: number | null | undefined): number | undefined {
  if (value === undefined || value === null || value === 0) {
    return undefined;
  }
  if (!Number.isInteger(value) || value < 1 || value > 10) {
    throw new Error("RPE must be a whole number from 1 to 10");
  }
  return value;
}

function optionalWeight(value: number | null | undefined): number {
  if (value === undefined || value === null) {
    return 0;
  }
  if (!Number.isFinite(value) || value < 0 || value > 2000) {
    throw new Error("Weight must be between 0 and 2000 lb");
  }
  return roundWeight(value);
}
