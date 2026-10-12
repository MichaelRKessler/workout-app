import { fromCentimeters, type LengthUnit } from "../convex/lib/bodyMeasures";
import { fromPounds, type WeightUnit } from "../convex/lib/units";
import { calendarDayKey } from "./historyDays";

export type SetExportRow = {
  loggedAt: number;
  workoutStartedAt: number;
  workoutId: string;
  exercise: string;
  setType: string;
  reps: number | null;
  weightLb: number;
  durationSec: number | null;
  distanceM: number | null;
  calories: number | null;
  rpe: number | null;
  note: string | null;
  superset: string | null;
};

export type BodyExportRow = {
  loggedAt: number;
  weightLb: number | null;
  bodyFatPct: number | null;
  waistCm: number | null;
  chestCm: number | null;
  armCm: number | null;
  hipsCm: number | null;
  thighCm: number | null;
  note: string | null;
};

export type RoutineExportRow = {
  routine: string;
  sortIndex: number;
  exerciseOrder: number;
  exercise: string;
  superset: string | null;
  targetSets: number | null;
  targetReps: number | null;
  targetWeightLb: number | null;
  targetDurationSec: number | null;
  targetDistanceM: number | null;
  targetCalories: number | null;
  restSeconds: number | null;
};

const SET_HEADER = [
  "date",
  "logged_at",
  "workout_started_at",
  "workout_id",
  "exercise",
  "set_type",
  "reps",
  "weight_lb",
  "weight_kg",
  "display_weight",
  "display_unit",
  "duration_sec",
  "distance_m",
  "calories",
  "rpe",
  "note",
  "superset",
];

const BODY_HEADER = [
  "date",
  "logged_at",
  "weight_lb",
  "weight_kg",
  "display_weight",
  "display_unit",
  "body_fat_pct",
  "waist_cm",
  "chest_cm",
  "arm_cm",
  "hips_cm",
  "thigh_cm",
  "waist_display",
  "chest_display",
  "arm_display",
  "hips_display",
  "thigh_display",
  "length_unit",
  "note",
];

const ROUTINE_HEADER = [
  "routine",
  "sort_index",
  "exercise_order",
  "exercise",
  "superset",
  "target_sets",
  "target_reps",
  "target_weight_lb",
  "target_weight_kg",
  "target_duration_sec",
  "target_distance_m",
  "target_calories",
  "rest_seconds",
  "weight_unit",
];

export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) {
    return "";
  }
  const text = String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

export function toCsv(header: string[], rows: Array<Array<string | number | null>>): string {
  const lines = [header.join(",")];
  for (const row of rows) {
    lines.push(row.map((cell) => csvCell(cell)).join(","));
  }
  return `${lines.join("\n")}\n`;
}

function weightCells(weightLb: number | null, unit: WeightUnit): Array<string | number | null> {
  if (weightLb === null) {
    return ["", "", "", unit];
  }
  return [weightLb, fromPounds(weightLb, "kg"), fromPounds(weightLb, unit), unit];
}

function lengthCell(cm: number | null, unit: LengthUnit): number | null {
  if (cm === null) {
    return null;
  }
  return fromCentimeters(cm, unit);
}

export function setsCsv(rows: SetExportRow[], unit: WeightUnit, timeZone?: string): string {
  return toCsv(
    SET_HEADER,
    rows.map((row) => [
      calendarDayKey(row.loggedAt, timeZone),
      new Date(row.loggedAt).toISOString(),
      new Date(row.workoutStartedAt).toISOString(),
      row.workoutId,
      row.exercise,
      row.setType,
      row.reps,
      ...weightCells(row.weightLb, unit),
      row.durationSec,
      row.distanceM,
      row.calories,
      row.rpe,
      row.note,
      row.superset,
    ]),
  );
}

export function bodyCsv(
  rows: BodyExportRow[],
  weightUnit: WeightUnit,
  lengthUnit: LengthUnit,
  timeZone?: string,
): string {
  return toCsv(
    BODY_HEADER,
    rows.map((row) => [
      calendarDayKey(row.loggedAt, timeZone),
      new Date(row.loggedAt).toISOString(),
      ...weightCells(row.weightLb, weightUnit),
      row.bodyFatPct,
      row.waistCm,
      row.chestCm,
      row.armCm,
      row.hipsCm,
      row.thighCm,
      lengthCell(row.waistCm, lengthUnit),
      lengthCell(row.chestCm, lengthUnit),
      lengthCell(row.armCm, lengthUnit),
      lengthCell(row.hipsCm, lengthUnit),
      lengthCell(row.thighCm, lengthUnit),
      lengthUnit,
      row.note,
    ]),
  );
}

export function routinesCsv(rows: RoutineExportRow[], unit: WeightUnit): string {
  return toCsv(
    ROUTINE_HEADER,
    rows.map((row) => [
      row.routine,
      row.sortIndex,
      row.exerciseOrder,
      row.exercise,
      row.superset,
      row.targetSets,
      row.targetReps,
      row.targetWeightLb,
      row.targetWeightLb === null ? null : fromPounds(row.targetWeightLb, "kg"),
      row.targetDurationSec,
      row.targetDistanceM,
      row.targetCalories,
      row.restSeconds,
      unit,
    ]),
  );
}

export async function collectPages<T>(
  load: (cursor: string | null) => Promise<{
    page: T[];
    isDone: boolean;
    continueCursor: string;
  }>,
  maxPages = 400,
): Promise<{ rows: T[]; complete: boolean }> {
  const rows: T[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < maxPages; page += 1) {
    const result = await load(cursor);
    rows.push(...result.page);
    if (result.isDone) {
      return { rows, complete: true };
    }
    if (!result.continueCursor || result.continueCursor === cursor) {
      return { rows, complete: false };
    }
    cursor = result.continueCursor;
  }
  return { rows, complete: false };
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let crc = n;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) !== 0 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    table[n] = crc >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosTime(date: Date): { time: number; day: number } {
  const year = Math.max(1980, date.getUTCFullYear());
  const time =
    (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | Math.floor(date.getUTCSeconds() / 2);
  const day = ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate();
  return { time, day };
}

function u16(view: DataView, offset: number, value: number) {
  view.setUint16(offset, value, true);
}

function u32(view: DataView, offset: number, value: number) {
  view.setUint32(offset, value >>> 0, true);
}

/** Uncompressed zip. Small enough that a spreadsheet app can open it with no extra library. */
export function zipStored(
  files: Array<{ name: string; text: string }>,
  modified = new Date("2026-01-01T00:00:00Z"),
): Uint8Array {
  const encoder = new TextEncoder();
  const stamp = dosTime(modified);
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = encoder.encode(file.text);
    const crc = crc32(data);
    const local = new Uint8Array(30 + name.length + data.length);
    const localView = new DataView(local.buffer);
    u32(localView, 0, 0x04034b50);
    u16(localView, 4, 20);
    u16(localView, 6, 0x800);
    u16(localView, 8, 0);
    u16(localView, 10, stamp.time);
    u16(localView, 12, stamp.day);
    u32(localView, 14, crc);
    u32(localView, 18, data.length);
    u32(localView, 22, data.length);
    u16(localView, 26, name.length);
    u16(localView, 28, 0);
    local.set(name, 30);
    local.set(data, 30 + name.length);
    locals.push(local);

    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    u32(centralView, 0, 0x02014b50);
    u16(centralView, 4, 20);
    u16(centralView, 6, 20);
    u16(centralView, 8, 0x800);
    u16(centralView, 10, 0);
    u16(centralView, 12, stamp.time);
    u16(centralView, 14, stamp.day);
    u32(centralView, 16, crc);
    u32(centralView, 20, data.length);
    u32(centralView, 24, data.length);
    u16(centralView, 28, name.length);
    u16(centralView, 30, 0);
    u16(centralView, 32, 0);
    u16(centralView, 34, 0);
    u16(centralView, 36, 0);
    u32(centralView, 38, 0);
    u32(centralView, 42, offset);
    central.set(name, 46);
    centrals.push(central);
    offset += local.length;
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  u32(endView, 0, 0x06054b50);
  u16(endView, 4, 0);
  u16(endView, 6, 0);
  u16(endView, 8, files.length);
  u16(endView, 10, files.length);
  u32(endView, 12, centralSize);
  u32(endView, 16, offset);
  u16(endView, 20, 0);
  const total = offset + centralSize + end.length;
  const bytes = new Uint8Array(total);
  let cursor = 0;
  for (const part of locals) {
    bytes.set(part, cursor);
    cursor += part.length;
  }
  for (const part of centrals) {
    bytes.set(part, cursor);
    cursor += part.length;
  }
  bytes.set(end, cursor);
  return bytes;
}

export function readStoredZip(bytes: Uint8Array): Array<{ name: string; text: string }> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  const files: Array<{ name: string; text: string }> = [];
  let offset = 0;
  while (offset + 4 <= bytes.length) {
    const signature = view.getUint32(offset, true);
    if (signature !== 0x04034b50) {
      break;
    }
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const size = view.getUint32(offset + 22, true);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    files.push({
      name: decoder.decode(bytes.slice(nameStart, nameStart + nameLength)),
      text: decoder.decode(bytes.slice(dataStart, dataStart + size)),
    });
    offset = dataStart + size;
  }
  return files;
}
