/**
 * Offline when the browser says so, or when Convex has connected before and
 * the socket is down. The first connection attempt is not offline: the app is
 * still opening.
 */
export function isOffline(input: {
  browserOnline: boolean;
  hasEverConnected: boolean;
  isWebSocketConnected: boolean;
  connectionRetries: number;
}): boolean {
  if (!input.browserOnline) {
    return true;
  }
  if (input.isWebSocketConnected) {
    return false;
  }
  return input.hasEverConnected || input.connectionRetries > 0;
}
