/**
 * How long the Convex socket may be down, with the browser online, before the
 * app calls itself offline. Phones drop the socket whenever a tab is put in
 * the background or the screen sleeps, and Convex takes a moment (with backoff,
 * up to 16 seconds) to reconnect, so a dropped socket alone is not proof.
 */
export const SOCKET_GRACE_MS = 8_000;

/**
 * Offline when the browser says so, or when Convex has connected before and
 * the socket has been down for longer than the grace period. The first
 * connection attempt is not offline: the app is still opening.
 */
export function isOffline(input: {
  browserOnline: boolean;
  hasEverConnected: boolean;
  isWebSocketConnected: boolean;
  connectionRetries: number;
  /** How long the socket has been down while the page was visible, in ms. */
  socketDownForMs: number;
}): boolean {
  if (!input.browserOnline) {
    return true;
  }
  if (!isSocketDown(input)) {
    return false;
  }
  return input.socketDownForMs >= SOCKET_GRACE_MS;
}

/** The socket is down after having connected, or after a failed first try. */
export function isSocketDown(input: {
  hasEverConnected: boolean;
  isWebSocketConnected: boolean;
  connectionRetries: number;
}): boolean {
  if (input.isWebSocketConnected) {
    return false;
  }
  return input.hasEverConnected || input.connectionRetries > 0;
}
