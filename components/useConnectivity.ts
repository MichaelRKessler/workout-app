"use client";

import { isOffline } from "@/lib/offline/connectivity";
import { useConvexConnectionState } from "convex/react";
import { useEffect, useState } from "react";

export function useConnectivity() {
  const connection = useConvexConnectionState();
  const [browserOnline, setBrowserOnline] = useState(true);

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

  return {
    offline: isOffline({
      browserOnline,
      hasEverConnected: connection.hasEverConnected,
      isWebSocketConnected: connection.isWebSocketConnected,
      connectionRetries: connection.connectionRetries,
    }),
  };
}
