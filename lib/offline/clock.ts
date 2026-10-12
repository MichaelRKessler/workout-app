/**
 * Longest round trip a server time reading may take. The reading can be off
 * by up to half of it, and a reply held back while the phone was offline is
 * far longer than this.
 */
export const CLOCK_READING_MAX_ROUND_TRIP_MS = 5_000;

/**
 * The phone's clock measured against the server. Sent with each batch so a
 * request delivered late is not mistaken for a wrong clock.
 */
export type ClockReading = {
  /** Server time minus phone time. Positive means the phone is behind. */
  offsetMs: number;
  /** Phone time when the reading was taken. */
  measuredAt: number;
};

/**
 * Reads the clock offset from one round trip, assuming the server read its
 * clock halfway through. A slow or garbled reply gives no reading.
 */
export function clockReading(
  sentAt: number,
  receivedAt: number,
  serverNow: unknown,
): ClockReading | null {
  if (
    typeof serverNow !== "number" ||
    !Number.isFinite(serverNow) ||
    !Number.isFinite(sentAt) ||
    !Number.isFinite(receivedAt)
  ) {
    return null;
  }
  const roundTrip = receivedAt - sentAt;
  if (roundTrip < 0 || roundTrip > CLOCK_READING_MAX_ROUND_TRIP_MS) {
    return null;
  }
  return {
    offsetMs: Math.round(serverNow - (sentAt + roundTrip / 2)),
    measuredAt: receivedAt,
  };
}

/** Keeps the later reading. Both come from this phone's clock. */
export function newerClock(
  left: ClockReading | null,
  right: ClockReading | null,
): ClockReading | null {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }
  return right.measuredAt >= left.measuredAt ? right : left;
}

export function parseClock(value: unknown): ClockReading | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const reading = value as Record<string, unknown>;
  if (
    typeof reading.offsetMs !== "number" ||
    !Number.isFinite(reading.offsetMs) ||
    typeof reading.measuredAt !== "number" ||
    !Number.isFinite(reading.measuredAt)
  ) {
    return null;
  }
  return { offsetMs: reading.offsetMs, measuredAt: reading.measuredAt };
}
