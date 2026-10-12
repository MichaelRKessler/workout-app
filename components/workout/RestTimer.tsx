"use client";

import { formatElapsed } from "@/lib/format";
import {
  playRestChime,
  readRestChime,
  REST_CHIME_KEY,
  shouldPlayRestChime,
  unlockRestAudio,
} from "@/lib/restChime";
import {
  bumpRest,
  bumpRestSeconds,
  DEFAULT_REST_SECONDS,
  readRestSeconds,
  REST_STORAGE_KEY,
  restEndFrom,
  restIntervalActive,
  shiftActiveRest,
  shouldVibrateRest,
  vibrateForRest,
} from "@/lib/restTimer";
import { useEffect, useRef, useState } from "react";

/**
 * Rest controls above the composer. Changing the time during a rest does not
 * save it. "Save for <exercise>" stores it for that exercise only. Before any
 * set, the buttons change the device default, which Settings also edits.
 */
export function RestTimer({
  setCount,
  loading,
  exerciseRestSeconds = null,
  onExerciseRest,
  hold = false,
  restLabel = null,
}: {
  setCount: number;
  loading: boolean;
  exerciseRestSeconds?: number | null;
  onExerciseRest?: (seconds: number) => void;
  /** A superset round is still open, so this set does not start a countdown. */
  hold?: boolean;
  restLabel?: string | null;
}) {
  const [globalSeconds, setGlobalSeconds] = useState(DEFAULT_REST_SECONDS);
  const [displaySeconds, setDisplaySeconds] = useState(DEFAULT_REST_SECONDS);
  const [ready, setReady] = useState(false);
  const [endsAt, setEndsAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [chimeOn, setChimeOn] = useState(true);
  const [announcement, setAnnouncement] = useState("");
  const [savedFlash, setSavedFlash] = useState(false);
  const previousCount = useRef<number | null>(null);
  const vibratedFor = useRef<number | null>(null);
  const chimedFor = useRef<number | null>(null);
  const adjusted = useRef(false);
  const skipped = useRef(false);
  const globalRef = useRef(globalSeconds);
  const displayRef = useRef(displaySeconds);
  const setCountRef = useRef(setCount);
  const holdRef = useRef(hold);
  const endsAtRef = useRef(endsAt);
  globalRef.current = globalSeconds;
  displayRef.current = displaySeconds;
  setCountRef.current = setCount;
  holdRef.current = hold;
  endsAtRef.current = endsAt;

  useEffect(() => {
    const stored = readRestSeconds(window.localStorage.getItem(REST_STORAGE_KEY));
    setGlobalSeconds(stored);
    setDisplaySeconds(stored);
    setChimeOn(readRestChime(window.localStorage.getItem(REST_CHIME_KEY)));
    setReady(true);
    // iOS unlocks audio on touchend or click, not on a touch pointerdown.
    const unlock = () => unlockRestAudio();
    const events = ["pointerdown", "touchend", "click"] as const;
    for (const name of events) {
      window.addEventListener(name, unlock, { passive: true });
    }
    return () => {
      for (const name of events) {
        window.removeEventListener(name, unlock);
      }
    };
  }, []);

  useEffect(() => {
    if (!ready) {
      return;
    }
    window.localStorage.setItem(REST_STORAGE_KEY, String(globalSeconds));
    window.dispatchEvent(new Event("workout-rest-default"));
  }, [ready, globalSeconds]);

  useEffect(() => {
    function syncDefault() {
      const stored = readRestSeconds(window.localStorage.getItem(REST_STORAGE_KEY));
      setGlobalSeconds(stored);
      if (setCountRef.current === 0 && endsAtRef.current === null) {
        setDisplaySeconds(stored);
      }
    }
    function syncChime() {
      setChimeOn(readRestChime(window.localStorage.getItem(REST_CHIME_KEY)));
    }
    window.addEventListener("workout-rest-default", syncDefault);
    window.addEventListener("workout-rest-chime", syncChime);
    return () => {
      window.removeEventListener("workout-rest-default", syncDefault);
      window.removeEventListener("workout-rest-chime", syncChime);
    };
  }, []);

  useEffect(() => {
    if (loading) {
      return;
    }
    if (previousCount.current === null) {
      previousCount.current = setCount;
      return;
    }
    if (setCount > previousCount.current) {
      adjusted.current = false;
      skipped.current = false;
      vibratedFor.current = null;
      chimedFor.current = null;
      setSavedFlash(false);
      if (hold) {
        setEndsAt(null);
      } else {
        const duration = exerciseRestSeconds ?? globalRef.current;
        const start = Date.now();
        setDisplaySeconds(duration);
        setEndsAt(restEndFrom(start, duration));
        setNow(start);
        setAnnouncement(`Rest ${formatElapsed(duration * 1000)}`);
      }
    }
    previousCount.current = setCount;
  }, [exerciseRestSeconds, hold, loading, setCount]);

  useEffect(() => {
    if (adjusted.current || endsAt === null || setCountRef.current === 0) {
      return;
    }
    const next = exerciseRestSeconds ?? globalRef.current;
    if (next === displayRef.current) {
      return;
    }
    const at = Date.now();
    setEndsAt((current) => shiftActiveRest(current, at, displayRef.current, next));
    setDisplaySeconds(next);
    setNow(at);
  }, [endsAt, exerciseRestSeconds]);

  useEffect(() => {
    if (!restIntervalActive(endsAt, Date.now())) {
      return;
    }
    const timer = window.setInterval(() => {
      const at = Date.now();
      setNow(at);
      if (endsAt !== null && at >= endsAt) {
        window.clearInterval(timer);
      }
    }, 250);
    return () => window.clearInterval(timer);
  }, [endsAt]);

  const remaining = endsAt === null ? null : endsAt - now;
  useEffect(() => {
    if (endsAt === null || remaining === null || remaining > 0 || skipped.current) {
      return;
    }
    if (shouldVibrateRest(remaining, vibratedFor.current === endsAt)) {
      vibratedFor.current = endsAt;
      const vibrate =
        typeof navigator !== "undefined" && typeof navigator.vibrate === "function"
          ? navigator.vibrate.bind(navigator)
          : undefined;
      vibrateForRest(vibrate);
    }
    if (
      shouldPlayRestChime({
        enabled: chimeOn,
        remainingMs: remaining,
        alreadyPlayed: chimedFor.current === endsAt,
        skipped: skipped.current,
      })
    ) {
      chimedFor.current = endsAt;
      playRestChime();
    }
    setAnnouncement((current) => (current === "Rest done" ? current : "Rest done"));
  }, [chimeOn, endsAt, remaining]);

  function adjust(direction: -1 | 1) {
    const at = Date.now();
    const previous = displayRef.current;
    const next = bumpRestSeconds(previous, direction);
    setSavedFlash(false);
    const beforeAnySet = setCountRef.current === 0;
    if (beforeAnySet) {
      setGlobalSeconds(next);
      setDisplaySeconds(next);
      setAnnouncement(`Rest ${formatElapsed(next * 1000)}`);
      return;
    }
    adjusted.current = true;
    if (holdRef.current) {
      setDisplaySeconds(next);
      setAnnouncement(`Rest ${formatElapsed(next * 1000)}`);
      return;
    }
    const bumped = bumpRest({ endsAt: endsAtRef.current, now: at, seconds: previous, direction });
    if (bumped.restarted) {
      // A skipped rest that starts again should still chime when it ends.
      skipped.current = false;
      vibratedFor.current = null;
      chimedFor.current = null;
    }
    setDisplaySeconds(bumped.seconds);
    setEndsAt(bumped.endsAt);
    setNow(at);
    const spoken =
      bumped.restarted && bumped.endsAt !== null ? bumped.endsAt - at : bumped.seconds * 1000;
    setAnnouncement(`Rest ${formatElapsed(spoken)}`);
  }

  function skip() {
    if (endsAtRef.current === null) {
      return;
    }
    skipped.current = true;
    vibratedFor.current = endsAtRef.current;
    chimedFor.current = endsAtRef.current;
    const at = Date.now();
    setEndsAt(at);
    setNow(at);
    setAnnouncement("Rest skipped");
  }

  function saveDefault() {
    onExerciseRest?.(displayRef.current);
    setSavedFlash(true);
    setAnnouncement(
      `Saved ${formatElapsed(displayRef.current * 1000)} as the rest for ${restLabel ?? "this exercise"}`,
    );
  }

  const running = remaining !== null && remaining > 0;
  const done = remaining !== null && remaining <= 0;
  const readout = done ? "Done" : formatElapsed(running ? remaining : displaySeconds * 1000);
  const savedLength = setCount > 0 ? (exerciseRestSeconds ?? globalSeconds) : globalSeconds;
  const canSave = setCount > 0 && Boolean(onExerciseRest) && displaySeconds !== savedLength;
  const buttonClass =
    "min-h-11 rounded-full border border-input bg-surface px-3 text-base font-semibold text-foreground hover:bg-fill-2";

  return (
    <div className="border-t border-line bg-background px-4 pt-2 pb-1">
      <div className="mx-auto flex max-w-lg flex-wrap items-center gap-2">
        <p className="mr-auto min-w-0" title={restLabel ? `Rest follows ${restLabel}` : undefined}>
          <span className="block text-xs font-medium tracking-[0.06em] text-subtle uppercase">
            Rest{restLabel && !hold ? ` · ${restLabel}` : ""}
          </span>
          <span className="font-mono text-2xl leading-none font-medium tabular-nums">{readout}</span>
        </p>
        <button type="button" onClick={() => adjust(-1)} className={buttonClass}>
          −30s
        </button>
        <button type="button" onClick={() => adjust(1)} className={buttonClass}>
          +30s
        </button>
        {running ? (
          <button type="button" onClick={skip} className={buttonClass}>
            Skip
          </button>
        ) : null}
        {canSave ? (
          <button type="button" onClick={saveDefault} className={buttonClass}>
            {savedFlash ? "Saved" : `Save for ${restLabel ?? "this exercise"}`}
          </button>
        ) : null}
      </div>
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}
