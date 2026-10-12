/** First automatic retry. Matches the previous fixed interval. */
export const RETRY_BASE_MS = 15_000;

/** Stop doubling here so a stuck account still tries a few times an hour. */
export const RETRY_CAP_MS = 5 * 60 * 1000;

/** Doubles the wait after a whole-call failure, up to five minutes. */
export function nextRetryDelay(previousMs: number): number {
  const current = previousMs >= RETRY_BASE_MS ? previousMs : RETRY_BASE_MS;
  return Math.min(RETRY_CAP_MS, current * 2);
}
