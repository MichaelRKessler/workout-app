"use client";

import { useEffect } from "react";

/** Registers the network-first worker in production so an installed copy can open offline. */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) {
      return;
    }
    let canceled = false;
    const register = () => {
      void navigator.serviceWorker
        .register("/sw.js", { scope: "/", updateViaCache: "none" })
        .catch(() => undefined);
    };
    register();
    const onVisible = () => {
      if (canceled || document.visibilityState !== "visible") {
        return;
      }
      void navigator.serviceWorker
        .getRegistration("/")
        .then((registration) => registration?.update())
        .catch(() => undefined);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      canceled = true;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return null;
}
