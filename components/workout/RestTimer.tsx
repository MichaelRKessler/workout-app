"use client";

import { MinusIcon, PlusIcon } from "@/components/icons";
import { formatElapsed } from "@/lib/format";
import {
  adjustRestSeconds,
  DEFAULT_REST_SECONDS,
  readRestSeconds,
  REST_STORAGE_KEY,
  restEndFrom,
  shiftActiveRest,
  shouldVibrateRest,
  vibrateForRest,
} from "@/lib/restTimer";
import { useEffect, useRef, useState } from "react";

/** Countdown beside the workout clock. Starts after a set is added this visit. */
export function RestTimer({ setCount, loading }: { setCount: number; loading: boolean }) {
  const [seconds, setSeconds] = useState(DEFAULT_REST_SECONDS);
  const [ready, setReady] = useState(false);
  const [endsAt, setEndsAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const previousCount = useRef<number | null>(null);
  const vibratedFor = useRef<number | null>(null);
  const secondsRef = useRef(seconds);
  secondsRef.current = seconds;

  useEffect(() => {
    setSeconds(readRestSeconds(window.localStorage.getItem(REST_STORAGE_KEY)));
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) {
      return;
    }
    window.localStorage.setItem(REST_STORAGE_KEY, String(seconds));
  }, [ready, seconds]);

  useEffect(() => {
    if (loading) {
      return;
    }
    if (previousCount.current === null) {
      previousCount.current = setCount;
      return;
    }
    if (setCount > previousCount.current) {
      const start = Date.now();
      setEndsAt(restEndFrom(start, secondsRef.current));
      setNow(start);
      vibratedFor.current = null;
    }
    previousCount.current = setCount;
  }, [loading, setCount]);

  useEffect(() => {
    if (endsAt === null) {
      return;
    }
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [endsAt]);

  const remaining = endsAt === null ? null : endsAt - now;
  useEffect(() => {
    if (endsAt === null || remaining === null) {
      return;
    }
    if (!shouldVibrateRest(remaining, vibratedFor.current === endsAt)) {
      return;
    }
    vibratedFor.current = endsAt;
    const vibrate =
      typeof navigator !== "undefined" && typeof navigator.vibrate === "function"
        ? navigator.vibrate.bind(navigator)
        : undefined;
    vibrateForRest(vibrate);
  }, [endsAt, remaining]);

  function adjust(direction: -1 | 1) {
    const next = adjustRestSeconds(seconds, direction);
    const at = Date.now();
    setEndsAt((current) => shiftActiveRest(current, at, seconds, next));
    setSeconds(next);
    setNow(at);
  }

  const running = remaining !== null && remaining > 0;
  const done = remaining !== null && remaining <= 0;
  const readout = done ? "Done" : formatElapsed(running ? remaining : seconds * 1000);
  const spoken = done
    ? "Rest done"
    : running
      ? `Rest ${readout} remaining`
      : `Rest length ${readout}`;

  const buttonClass =
    "flex size-11 items-center justify-center rounded-full text-foreground hover:bg-fill-2";

  return (
    <div className="flex items-center gap-0.5 rounded-full border border-line bg-surface py-0.5 pr-0.5 pl-2.5">
      <span className="sr-only">{spoken}</span>
      <span aria-hidden="true" className="flex items-baseline gap-1 pr-0.5">
        <span className="text-xs font-medium tracking-[0.06em] text-subtle uppercase">Rest</span>
        <span
          className={`font-mono text-sm tabular-nums ${done ? "font-semibold text-foreground" : "text-foreground"}`}
        >
          {readout}
        </span>
      </span>
      <button
        type="button"
        aria-label="15 seconds less rest"
        onClick={() => adjust(-1)}
        className={buttonClass}
      >
        <MinusIcon className="size-4" strokeWidth={1.8} />
      </button>
      <button
        type="button"
        aria-label="15 seconds more rest"
        onClick={() => adjust(1)}
        className={buttonClass}
      >
        <PlusIcon className="size-4" strokeWidth={1.8} />
      </button>
    </div>
  );
}
