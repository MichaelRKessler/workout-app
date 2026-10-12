"use client";

import { readSession, writeSession } from "@/lib/localValue";
import { useCallback, useEffect, useState } from "react";

/**
 * Text that survives leaving the page in this tab, such as a set typed in the
 * composer before checking an exercise's progress. Clearing it forgets it.
 */
export function useSessionText(key: string): [string, (value: string) => void] {
  const [text, setText] = useState("");

  useEffect(() => {
    const saved = readSession(key);
    if (saved) {
      setText(saved);
    }
  }, [key]);

  const change = useCallback(
    (value: string) => {
      setText(value);
      writeSession(key, value === "" ? null : value);
    },
    [key],
  );

  return [text, change];
}
