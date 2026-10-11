"use client";

import { useEffect, useState } from "react";

/** The browser zone, after mount, so server HTML does not group days in UTC. */
export function useBrowserTimeZone(): string | null {
  const [timeZone, setTimeZone] = useState<string | null>(null);
  useEffect(() => {
    setTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  }, []);
  return timeZone;
}
