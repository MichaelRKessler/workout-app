/** Earliest logged time the server will store. */
export const EARLIEST_CLIENT_AT = Date.UTC(2000, 0, 1);

/** Largest clock error a phone's own reading may correct. A larger one is treated as a bad reading. */
export const MAX_CLOCK_OFFSET_MS = 366 * 24 * 60 * 60 * 1000;

/**
 * How far the phone's clock is behind the server.
 * A positive offset means the phone is slow and its timestamps need to move forward.
 * Missing or non-finite clocks are left alone.
 */
export function clockOffsetMs(clientNow: number | undefined, serverNow: number): number {
  if (clientNow === undefined || !Number.isFinite(clientNow) || !Number.isFinite(serverNow)) {
    return 0;
  }
  const offset = serverNow - clientNow;
  return Number.isFinite(offset) ? offset : 0;
}

/**
 * The shift for one request. A phone that measured its clock on a quick
 * round trip sends that offset, which stays right however late the request
 * is delivered. A phone on the older client sends only its clock at send
 * time, so any delivery delay counts as clock error; it keeps that behavior
 * until it updates. A request with neither is not shifted.
 */
export function requestOffsetMs(
  input: { clockOffsetMs?: number; clientNow?: number },
  serverNow: number,
): number {
  if (input.clockOffsetMs !== undefined) {
    const offset = input.clockOffsetMs;
    return Number.isFinite(offset) && Math.abs(offset) <= MAX_CLOCK_OFFSET_MS ? offset : 0;
  }
  return clockOffsetMs(input.clientNow, serverNow);
}

/**
 * Shifts a phone timestamp onto server time, then clamps it to
 * [1 Jan 2000, server now]. A fast clock no longer produces a time the
 * server has to reject, and a slow clock is not left in the past.
 */
export function correctClientTime(
  value: number,
  offsetMs: number,
  serverNow: number,
): number | null {
  if (!Number.isFinite(value) || !Number.isFinite(serverNow)) {
    return null;
  }
  const shifted = value + (Number.isFinite(offsetMs) ? offsetMs : 0);
  if (!Number.isFinite(shifted)) {
    return null;
  }
  if (shifted < EARLIEST_CLIENT_AT) {
    return EARLIEST_CLIENT_AT;
  }
  if (shifted > serverNow) {
    return serverNow;
  }
  return shifted;
}

/** Keeps a set inside the workout that will hold it. */
export function clampToWindow(value: number, start: number, end: number): number {
  const low = Math.min(start, end);
  const high = Math.max(start, end);
  if (value < low) {
    return low;
  }
  if (value > high) {
    return high;
  }
  return value;
}
