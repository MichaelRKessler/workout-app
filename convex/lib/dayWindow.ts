/**
 * A civil day is 23–25 hours where daylight saving starts or ends.
 * 26 hours covers that and rejects a request that spans multiple days.
 */
export const MAX_DAY_WINDOW_MS = 26 * 60 * 60 * 1000;

/** February is 28 days. A 31-day month can gain or lose an hour. */
export const MIN_MONTH_WINDOW_MS = 27 * 24 * 60 * 60 * 1000;
export const MAX_MONTH_WINDOW_MS = 32 * 24 * 60 * 60 * 1000;

export function assertDayWindow(startedFrom: number, startedUntil: number): void {
  if (!Number.isFinite(startedFrom) || !Number.isFinite(startedUntil)) {
    throw new Error("Pick a single day");
  }
  const span = startedUntil - startedFrom;
  if (span <= 0 || span > MAX_DAY_WINDOW_MS) {
    throw new Error("Pick a single day");
  }
}

export function assertMonthWindow(startedFrom: number, startedUntil: number): void {
  if (!Number.isFinite(startedFrom) || !Number.isFinite(startedUntil)) {
    throw new Error("Pick a single month");
  }
  const span = startedUntil - startedFrom;
  if (span < MIN_MONTH_WINDOW_MS || span > MAX_MONTH_WINDOW_MS) {
    throw new Error("Pick a single month");
  }
}
