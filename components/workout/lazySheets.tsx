"use client";

import dynamic from "next/dynamic";
import { useEffect } from "react";

/*
 * Sheets and overlays on Home that only appear after a tap: the mic overlay,
 * the voice and weigh-in confirm sheets, the add-a-set sheet, the finish and
 * stale-workout sheets, and the end-of-workout recap. Splitting them out keeps
 * them off the critical path when the app opens. usePreloadHomeSheets fetches
 * them once the screen is idle, so they still open instantly and are stored by
 * the service worker for offline use (the offline + button opens the add-a-set
 * sheet).
 */
const loaders = {
  listening: () => import("@/components/workout/ListeningOverlay"),
  confirm: () => import("@/components/workout/ConfirmSheet"),
  body: () => import("@/components/body/BodyConfirmSheet"),
  manual: () => import("@/components/workout/ManualEntrySheet"),
  finish: () => import("@/components/workout/FinishSheet"),
  stale: () => import("@/components/workout/StaleWorkoutSheet"),
  finished: () => import("@/components/WorkoutSummaryCard"),
};

export const ListeningOverlay = dynamic(() => loaders.listening().then((m) => m.ListeningOverlay), { ssr: false });
export const ConfirmSheet = dynamic(() => loaders.confirm().then((m) => m.ConfirmSheet), { ssr: false });
export const BodyConfirmSheet = dynamic(() => loaders.body().then((m) => m.BodyConfirmSheet), { ssr: false });
export const ManualEntrySheet = dynamic(() => loaders.manual().then((m) => m.ManualEntrySheet), { ssr: false });
export const FinishSheet = dynamic(() => loaders.finish().then((m) => m.FinishSheet), { ssr: false });
export const StaleWorkoutSheet = dynamic(() => loaders.stale().then((m) => m.StaleWorkoutSheet), { ssr: false });
export const FinishedWorkout = dynamic(() => loaders.finished().then((m) => m.FinishedWorkout), { ssr: false });

let preloaded = false;

/** Loads every sheet in the background after Home has painted. */
export function usePreloadHomeSheets(): void {
  useEffect(() => {
    if (preloaded) {
      return;
    }
    const run = () => {
      preloaded = true;
      for (const load of Object.values(loaders)) {
        void load().catch(() => {
          // A failed fetch is retried the next time the sheet opens.
          preloaded = false;
        });
      }
    };
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(run, { timeout: 2500 });
      return () => window.cancelIdleCallback(id);
    }
    const id = window.setTimeout(run, 1200);
    return () => window.clearTimeout(id);
  }, []);
}
