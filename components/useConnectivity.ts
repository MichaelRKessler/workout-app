"use client";

import { isOffline, isSocketDown, SOCKET_GRACE_MS } from "@/lib/offline/connectivity";
import { useConvexConnectionState } from "convex/react";
import { useEffect, useState } from "react";

export function useConnectivity() {
  const connection = useConvexConnectionState();
  const [browserOnline, setBrowserOnline] = useState(true);
  const [downSince, setDownSince] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const socketDown = isSocketDown(connection);

  useEffect(() => {
    const sync = () => {
      setBrowserOnline(navigator.onLine);
    };
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  // Start the clock when the socket drops, and restart it when the page comes
  // back into view: a socket the phone closed while the tab was hidden is not
  // a lost connection.
  useEffect(() => {
    if (!socketDown) {
      setDownSince(null);
      return;
    }
    setDownSince((since) => since ?? Date.now());
    const onVisible = () => {
      if (document.visibilityState !== "visible") {
        return;
      }
      setDownSince(Date.now());
      // Convex reconnects at once on an "online" event, instead of waiting out
      // its backoff, and does nothing if the socket is already connecting.
      window.dispatchEvent(new Event("online"));
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onVisible);
    };
  }, [socketDown]);

  // Re-render once the grace period is over, so the banner can appear.
  useEffect(() => {
    if (downSince === null) {
      return;
    }
    setNow(Date.now());
    const wait = downSince + SOCKET_GRACE_MS - Date.now();
    if (wait <= 0) {
      return;
    }
    const timer = window.setTimeout(() => setNow(Date.now()), wait);
    return () => window.clearTimeout(timer);
  }, [downSince]);

  return {
    offline: isOffline({
      browserOnline,
      hasEverConnected: connection.hasEverConnected,
      isWebSocketConnected: connection.isWebSocketConnected,
      connectionRetries: connection.connectionRetries,
      socketDownForMs: downSince === null ? 0 : Math.max(0, now - downSince),
    }),
  };
}
