"use client";

import { plannedCompletedAt, workoutLooksStale } from "@/convex/lib/sessionTiming";
import { formatDuration } from "@/lib/format";
import { useEffect, useState } from "react";

type Freshness = {
  showStale: boolean;
  idleNote: string | null;
  idleTrimmed: boolean;
  now: number;
};

const idleFreshness: Freshness = {
  showStale: false,
  idleNote: null,
  idleTrimmed: false,
  now: 0,
};

/**
 * The home screen used to store the clock on the whole workout page, so a
 * 30 second tick re-rendered every control. This updates only when the stale
 * prompt, the idle note, or an open finish sheet actually changes.
 */
export function useWorkoutFreshness(input: {
  active: boolean;
  startedAt: number;
  lastSetAt: number | null;
  resumedAt: number | null;
  voiceOrManualOpen: boolean;
  finishOpen: boolean;
  pendingFinish: boolean;
}): Freshness {
  const [fresh, setFresh] = useState<Freshness>(idleFreshness);

  useEffect(() => {
    function tick() {
      if (!input.active) {
        setFresh((prev) => {
          if (!prev.showStale && prev.idleNote === null && !prev.idleTrimmed && prev.now === 0) {
            return prev;
          }
          return idleFreshness;
        });
        return;
      }
      const now = Date.now();
      const stale =
        !input.pendingFinish &&
        workoutLooksStale(now, input.startedAt, input.lastSetAt, input.resumedAt);
      const showStale = stale && !input.voiceOrManualOpen;
      const savedEnd =
        input.lastSetAt !== null
          ? plannedCompletedAt({
              now,
              startedAt: input.startedAt,
              lastSetAt: input.lastSetAt,
            })
          : now;
      const idleTrimmed = input.lastSetAt !== null && now - savedEnd >= 60_000;
      const idleNote =
        stale && input.lastSetAt !== null ? `last set ${formatDuration(now - input.lastSetAt)} ago` : null;
      setFresh((prev) => {
        const clockChanged = input.finishOpen && prev.now !== now;
        if (
          prev.showStale === showStale &&
          prev.idleNote === idleNote &&
          prev.idleTrimmed === idleTrimmed &&
          !clockChanged
        ) {
          return prev;
        }
        return { showStale, idleNote, idleTrimmed, now };
      });
    }

    tick();
    const timer = window.setInterval(tick, 30_000);
    return () => window.clearInterval(timer);
  }, [
    input.active,
    input.finishOpen,
    input.lastSetAt,
    input.pendingFinish,
    input.resumedAt,
    input.startedAt,
    input.voiceOrManualOpen,
  ]);

  return fresh;
}
