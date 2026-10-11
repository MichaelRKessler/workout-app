"use client";

import { createScreenWakeLock, requestScreenWakeLock } from "@/lib/wakeLock";
import { useEffect } from "react";

/** Holds the screen awake while this hook is mounted, including after the page is shown again. */
export function useWakeLock() {
  useEffect(() => {
    const controller = createScreenWakeLock({
      isVisible: () => document.visibilityState === "visible",
      request: requestScreenWakeLock,
    });
    void controller.sync();
    const onVisibility = () => {
      controller.onVisibilityChange();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      void controller.stop();
    };
  }, []);
}
