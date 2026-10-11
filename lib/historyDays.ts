import type { WeightUnit } from "../convex/lib/units";
import { formatExerciseName } from "../convex/lib/exerciseName";
import { formatDuration, formatVolumeLb, pluralize } from "./format";
import { groupSets, type SetLine } from "./groupSets";

const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

export type HistoryExercise = {
  exerciseId: string;
  name: string;
  setCount: number;
  /** Shared with the neighboring exercises logged as one superset. */
  supersetId?: string | null;
};

/**
 * One stored workout. Grouping is a display concern: documents stay separate.
 * `startedAt` is when the workout was performed, including a past workout
 * logged for an earlier date. An open workout is not part of a finished day.
 */
export type HistorySession = {
  id: string;
  startedAt: number;
  completedAt: number;
  status?: "open" | "completed";
  volumeLb: number;
  exercises: HistoryExercise[];
};

export type HistoryDay = {
  /** Local calendar day, YYYY-MM-DD, in the timezone used to group. */
  dayKey: string;
  /** Earliest performed start on that day. */
  startedAt: number;
  sessionIds: string[];
  workoutCount: number;
  setCount: number;
  volumeLb: number;
  /** Sum of recorded lengths. A past workout with no length adds nothing. */
  durationMs: number;
  /** Exercises in the order they were first performed that day. */
  exercises: HistoryExercise[];
};

type CivilDate = { year: number; month: number; day: number };

type ZonedParts = CivilDate & { hour: number; minute: number; second: number };

function formatDayKey(year: number, month: number, day: number): string {
  const monthText = String(month).padStart(2, "0");
  const dayText = String(day).padStart(2, "0");
  return `${year}-${monthText}-${dayText}`;
}

export function parseDayKey(dayKey: string): CivilDate | null {
  const match = DAY_KEY.exec(dayKey);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

function zonedParts(timestamp: number, timeZone?: string): ZonedParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const map = new Map<string, string>();
  for (const part of formatter.formatToParts(new Date(timestamp))) {
    if (part.type !== "literal") {
      map.set(part.type, part.value);
    }
  }
  const year = Number(map.get("year"));
  const month = Number(map.get("month"));
  const day = Number(map.get("day"));
  let hour = Number(map.get("hour"));
  const minute = Number(map.get("minute"));
  const second = Number(map.get("second"));
  if (hour === 24) {
    hour = 0;
  }
  return { year, month, day, hour, minute, second };
}

/** Calendar day of `timestamp` in `timeZone`, or the browser zone when omitted. */
export function calendarDayKey(timestamp: number, timeZone?: string): string {
  if (!Number.isFinite(timestamp)) {
    throw new Error("Workout time must be a number");
  }
  const parts = zonedParts(timestamp, timeZone);
  return formatDayKey(parts.year, parts.month, parts.day);
}

function nextCivilDate(date: CivilDate): CivilDate {
  const probe = new Date(Date.UTC(date.year, date.month - 1, date.day));
  probe.setUTCDate(probe.getUTCDate() + 1);
  return {
    year: probe.getUTCFullYear(),
    month: probe.getUTCMonth() + 1,
    day: probe.getUTCDate(),
  };
}

function zonedMidnight(date: CivilDate, timeZone?: string): number {
  let utc = Date.UTC(date.year, date.month - 1, date.day, 0, 0, 0);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = zonedParts(utc, timeZone);
    const asUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    const offset = asUtc - utc;
    const nextUtc = Date.UTC(date.year, date.month - 1, date.day, 0, 0, 0) - offset;
    if (nextUtc === utc) {
      return utc;
    }
    utc = nextUtc;
  }
  return utc;
}

/**
 * `[start, end)` timestamps for a local calendar day. `end` is the next
 * local midnight, so a daylight-saving day can be 23 or 25 hours.
 */
export function calendarDayBounds(
  dayKey: string,
  timeZone?: string,
): { start: number; end: number } | null {
  const date = parseDayKey(dayKey);
  if (!date) {
    return null;
  }
  const start = zonedMidnight(date, timeZone);
  const end = zonedMidnight(nextCivilDate(date), timeZone);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return null;
  }
  return { start, end };
}

function roundVolume(volumeLb: number): number {
  return Math.round(volumeLb * 100) / 100;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** Sunday is 0. The history calendar starts weeks on Sunday. */
export function weekdayIndex(timestamp: number, timeZone?: string): number {
  const label = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(
    new Date(timestamp),
  );
  return WEEKDAY_INDEX[label] ?? 0;
}

export function civilMonth(timestamp: number, timeZone?: string): { year: number; month: number } {
  const parts = zonedParts(timestamp, timeZone);
  return { year: parts.year, month: parts.month };
}

export function shiftMonth(
  year: number,
  month: number,
  delta: number,
): { year: number; month: number } {
  const index = year * 12 + (month - 1) + delta;
  const nextYear = Math.floor(index / 12);
  const nextMonth = index - nextYear * 12;
  return { year: nextYear, month: nextMonth + 1 };
}

function addCivilDays(date: CivilDate, days: number): CivilDate {
  const probe = new Date(Date.UTC(date.year, date.month - 1, date.day));
  probe.setUTCDate(probe.getUTCDate() + days);
  return {
    year: probe.getUTCFullYear(),
    month: probe.getUTCMonth() + 1,
    day: probe.getUTCDate(),
  };
}

export type CalendarCell = {
  dayKey: string;
  day: number;
  inMonth: boolean;
};

/**
 * Sunday-first weeks covering `month` (1–12). Leading and trailing cells
 * belong to the adjacent months so each row has seven days.
 */
export function monthCells(year: number, month: number, timeZone?: string): CalendarCell[] | null {
  if (month < 1 || month > 12) {
    return null;
  }
  const firstKey = formatDayKey(year, month, 1);
  const first = calendarDayBounds(firstKey, timeZone);
  if (!first) {
    return null;
  }
  const gridStart = addCivilDays({ year, month, day: 1 }, -weekdayIndex(first.start, timeZone));
  const cells: CalendarCell[] = [];
  let cursor = gridStart;
  for (let index = 0; index < 42; index += 1) {
    cells.push({
      dayKey: formatDayKey(cursor.year, cursor.month, cursor.day),
      day: cursor.day,
      inMonth: cursor.year === year && cursor.month === month,
    });
    cursor = addCivilDays(cursor, 1);
  }
  while (cells.length > 28 && cells.slice(-7).every((cell) => !cell.inMonth)) {
    cells.splice(-7, 7);
  }
  return cells;
}

/** `[start, end)` for a local calendar month. `end` is the next month's midnight. */
export function monthWindow(
  year: number,
  month: number,
  timeZone?: string,
): { start: number; end: number } | null {
  if (month < 1 || month > 12) {
    return null;
  }
  const start = calendarDayBounds(formatDayKey(year, month, 1), timeZone);
  const next = shiftMonth(year, month, 1);
  const end = calendarDayBounds(formatDayKey(next.year, next.month, 1), timeZone);
  if (!start || !end || end.start <= start.start) {
    return null;
  }
  return { start: start.start, end: end.start };
}

/** How many finished workouts fall on each local day. */
export function markedDayKeys(startedAts: number[], timeZone?: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const startedAt of startedAts) {
    const key = calendarDayKey(startedAt, timeZone);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/**
 * Finished workouts on the same local calendar day, newest day first.
 * Exercises follow the order they were first performed. Open workouts are
 * left out so a live session stays separate until it is finished.
 */
export function groupHistoryDays(sessions: HistorySession[], timeZone?: string): HistoryDay[] {
  const byDay = new Map<string, HistorySession[]>();
  const seen = new Set<string>();
  for (const session of sessions) {
    if (session.status === "open" || seen.has(session.id)) {
      continue;
    }
    seen.add(session.id);
    const dayKey = calendarDayKey(session.startedAt, timeZone);
    const existing = byDay.get(dayKey);
    if (existing) {
      existing.push(session);
    } else {
      byDay.set(dayKey, [session]);
    }
  }

  const days: HistoryDay[] = [];
  for (const [dayKey, daySessions] of byDay) {
    daySessions.sort(
      (left, right) => left.startedAt - right.startedAt || left.id.localeCompare(right.id),
    );
    const exercises: HistoryExercise[] = [];
    let setCount = 0;
    let volumeLb = 0;
    let durationMs = 0;
    for (const session of daySessions) {
      volumeLb += session.volumeLb;
      if (session.completedAt > session.startedAt) {
        durationMs += session.completedAt - session.startedAt;
      }
      for (const exercise of session.exercises) {
        setCount += exercise.setCount;
        const existing = exercises.find((item) => item.exerciseId === exercise.exerciseId);
        if (existing) {
          existing.setCount += exercise.setCount;
        } else {
          exercises.push({ ...exercise });
        }
      }
    }
    const earliest = daySessions[0];
    if (!earliest) {
      continue;
    }
    days.push({
      dayKey,
      startedAt: earliest.startedAt,
      sessionIds: daySessions.map((session) => session.id),
      workoutCount: daySessions.length,
      setCount,
      volumeLb: roundVolume(volumeLb),
      durationMs,
      exercises,
    });
  }

  days.sort((left, right) => (left.dayKey < right.dayKey ? 1 : left.dayKey > right.dayKey ? -1 : 0));
  return days;
}

/**
 * History pages are workouts, newest first. The oldest loaded day may
 * continue on the next page, so it stays hidden until the list is finished
 * or it is the only day loaded so far.
 */
export function visibleHistoryDays(
  sessions: HistorySession[],
  hasMore: boolean,
  timeZone?: string,
): HistoryDay[] {
  const days = groupHistoryDays(sessions, timeZone);
  if (!hasMore || days.length <= 1) {
    return days;
  }
  return days.slice(0, -1);
}

export function formatHistoryDayMeta(
  day: Pick<HistoryDay, "workoutCount" | "exercises" | "setCount" | "volumeLb" | "durationMs">,
  unit: WeightUnit,
): string {
  const parts: string[] = [];
  if (day.workoutCount > 1) {
    parts.push(pluralize(day.workoutCount, "workout"));
  }
  parts.push(pluralize(day.exercises.length, "exercise"));
  parts.push(pluralize(day.setCount, "set"));
  parts.push(formatVolumeLb(day.volumeLb, unit));
  if (day.durationMs > 0) {
    parts.push(formatDuration(day.durationMs));
  }
  return parts.join(" · ");
}

/** Pending offline sets join the saved exercise instead of a second row. */
export function canonicalExerciseIds<T extends { exerciseId: string; exerciseName: string }>(
  sets: T[],
): T[] {
  const idByName = new Map<string, string>();
  for (const set of sets) {
    if (set.exerciseId.startsWith("local:")) {
      continue;
    }
    const key = formatExerciseName(set.exerciseName)?.normalizedName ?? set.exerciseName;
    if (!idByName.has(key)) {
      idByName.set(key, set.exerciseId);
    }
  }
  return sets.map((set) => {
    if (!set.exerciseId.startsWith("local:")) {
      return set;
    }
    const key = formatExerciseName(set.exerciseName)?.normalizedName ?? set.exerciseName;
    const canonical = idByName.get(key);
    return canonical ? { ...set, exerciseId: canonical } : set;
  });
}

/** Sets from every workout that day, grouped by the first time each exercise appeared. */
export function groupPerformedSets<T extends SetLine>(sets: T[]) {
  const ordered = [...sets].sort(
    (left, right) => left.loggedAt - right.loggedAt || left._id.localeCompare(right._id),
  );
  return groupSets(ordered);
}
