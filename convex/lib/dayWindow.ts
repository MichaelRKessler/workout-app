/**
 * A civil day is 23–25 hours where daylight saving starts or ends.
 * 26 hours covers that and rejects a request that spans multiple days.
 */
export const MAX_DAY_WINDOW_MS = 26 * 60 * 60 * 1000;

export function assertDayWindow(startedFrom: number, startedUntil: number): void {
  if (!Number.isFinite(startedFrom) || !Number.isFinite(startedUntil)) {
    throw new Error("Pick a single day");
  }
  const span = startedUntil - startedFrom;
  if (span <= 0 || span > MAX_DAY_WINDOW_MS) {
    throw new Error("Pick a single day");
  }
}
