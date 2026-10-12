import { userError } from "./errors";

/** How many weeks the home-screen streak looks back, including this week. */
export const STREAK_WEEKS = 104;

const MIN_WEEK_MS = 6 * 24 * 60 * 60 * 1000;
const MAX_WEEK_MS = 8 * 24 * 60 * 60 * 1000;

/**
 * firstDay matches Intl.Locale weekInfo: 1 is Monday through 6 is Saturday,
 * and 7 is Sunday.
 */
export function startOfLocalWeek(timestamp: number, firstDay: number): number {
  const date = new Date(timestamp);
  const target = firstDay === 7 ? 0 : firstDay;
  const delta = (date.getDay() - target + 7) % 7;
  date.setDate(date.getDate() - delta);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function localWeekFirstDay(locale: string): number {
  const loc = new Intl.Locale(locale) as Intl.Locale & {
    weekInfo?: { firstDay?: number };
    getWeekInfo?: () => { firstDay?: number };
  };
  const first = loc.weekInfo?.firstDay ?? loc.getWeekInfo?.().firstDay;
  if (first === 7 || (first !== undefined && first >= 1 && first <= 6)) {
    return first;
  }
  return 1;
}

export function weekRange(now: number, firstDay: number, weeks = STREAK_WEEKS) {
  const count = Math.max(2, Math.min(STREAK_WEEKS, weeks));
  const descending: number[] = [];
  let cursor = startOfLocalWeek(now, firstDay);
  for (let index = 0; index < count; index += 1) {
    descending.push(cursor);
    cursor = startOfLocalWeek(cursor - 1, firstDay);
  }
  const weekStarts = descending.reverse();
  const thisWeekStart = weekStarts[weekStarts.length - 1] ?? cursor;
  return {
    weekStarts,
    weekEndsAt: startOfLocalWeek(thisWeekStart + 8 * 24 * 60 * 60 * 1000, firstDay),
  };
}

export function assertWeekRange(weekStarts: number[], weekEndsAt: number): void {
  if (weekStarts.length < 2 || weekStarts.length > STREAK_WEEKS) {
    throw userError("Week range must cover at least two weeks");
  }
  for (let index = 0; index < weekStarts.length; index += 1) {
    const start = weekStarts[index];
    if (start === undefined || !Number.isFinite(start)) {
      throw userError("Week start must be a time");
    }
    if (index === 0) {
      continue;
    }
    const previous = weekStarts[index - 1];
    if (previous === undefined) {
      throw userError("Week start must be a time");
    }
    const gap = start - previous;
    if (gap < MIN_WEEK_MS || gap > MAX_WEEK_MS) {
      throw userError("Weeks must be about seven days apart");
    }
  }
  const last = weekStarts[weekStarts.length - 1];
  if (last === undefined || !Number.isFinite(weekEndsAt) || weekEndsAt <= last) {
    throw userError("Week end must be after the current week starts");
  }
  const endGap = weekEndsAt - last;
  if (endGap < MIN_WEEK_MS || endGap > MAX_WEEK_MS) {
    throw userError("The current week must be about seven days");
  }
}

/** Index of the week that contains startedAt, or null when it falls outside. */
export function weekIndexFor(
  startedAt: number,
  weekStarts: number[],
  weekEndsAt: number,
): number | null {
  const first = weekStarts[0];
  if (first === undefined || startedAt < first || startedAt >= weekEndsAt) {
    return null;
  }
  let index = 0;
  for (let cursor = 0; cursor < weekStarts.length; cursor += 1) {
    const start = weekStarts[cursor];
    if (start !== undefined && start <= startedAt) {
      index = cursor;
    }
  }
  return index;
}

/**
 * Consecutive weeks with a workout, ending this week when it has one.
 * An empty week that is still in progress does not break the streak.
 */
export function workoutStreak(weekHasWorkout: boolean[]): number {
  if (weekHasWorkout.length === 0) {
    return 0;
  }
  let index = weekHasWorkout.length - 1;
  if (!weekHasWorkout[index]) {
    index -= 1;
  }
  let streak = 0;
  for (; index >= 0; index -= 1) {
    if (!weekHasWorkout[index]) {
      break;
    }
    streak += 1;
  }
  return streak;
}
