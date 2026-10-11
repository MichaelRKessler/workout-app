/** yyyy-mm-dd in the viewer's local calendar, for an input type="date". */
export function formatDateInput(timestamp: number): string {
  const date = new Date(timestamp);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Today, or an earlier day. Positive offsets are ignored. */
export function shiftDateInput(days: number, now = Date.now()): string {
  const date = new Date(now);
  date.setHours(12, 0, 0, 0);
  const shift = Number.isInteger(days) && days < 0 ? days : 0;
  date.setDate(date.getDate() + shift);
  return formatDateInput(date.getTime());
}

/**
 * Today is stored as the current time so a later weigh-in sorts after an
 * earlier one. Another day is stored at local noon, which is already in the past.
 */
export function loggedAtFromDateInput(value: string, now = Date.now()): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(year, month - 1, day);
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return null;
  }
  if (value === formatDateInput(now)) {
    return now;
  }
  const noon = new Date(year, month - 1, day, 12, 0, 0, 0).getTime();
  if (noon > now) {
    return null;
  }
  return noon;
}
