"use client";

import { CloseIcon, Spinner } from "@/components/icons";
import { MAX_RECORDING_MS } from "@/lib/voice/capture";
import { useEffect, useRef } from "react";

const RING_RADIUS = 132;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;
// Resting bar heights, as a fraction of the tallest, for the idle and parsing pulse.
const BAR_SHAPE = [0.24, 0.45, 0.74, 1, 0.67, 0.4, 0.21];
// Which frequency bin drives each bar. Low voice bands sit in the middle.
const BAR_BINS = [9, 5, 3, 2, 4, 6, 11];

function formatSeconds(ms: number) {
  const seconds = Math.floor(ms / 1000);
  return `0:${String(seconds).padStart(2, "0")}`;
}

export function ListeningOverlay({
  status,
  elapsedMs,
  analyser,
  onStop,
  onCancel,
}: {
  status: "recording" | "parsing";
  elapsedMs: number;
  analyser: AnalyserNode | null;
  onStop: () => void;
  onCancel: () => void;
}) {
  const barsRef = useRef<Array<HTMLSpanElement | null>>([]);
  const stopRef = useRef<HTMLButtonElement>(null);
  const onCancelRef = useRef(onCancel);
  useEffect(() => {
    onCancelRef.current = onCancel;
  });

  const live = status === "recording" && analyser !== null;

  useEffect(() => {
    stopRef.current?.focus({ preventScroll: true });
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancelRef.current();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = overflow;
    };
  }, []);

  useEffect(() => {
    if (!live || !analyser) {
      return;
    }
    const data = new Uint8Array(analyser.frequencyBinCount);
    let frame = 0;
    const draw = () => {
      analyser.getByteFrequencyData(data);
      barsRef.current.forEach((bar, index) => {
        if (!bar) {
          return;
        }
        const level = (data[BAR_BINS[index] ?? 0] ?? 0) / 255;
        const shape = BAR_SHAPE[index] ?? 1;
        bar.style.transform = `scaleY(${Math.max(0.12, Math.min(1, level * 1.3) * shape + 0.08)})`;
      });
      frame = window.requestAnimationFrame(draw);
    };
    draw();
    const bars = barsRef.current;
    return () => {
      window.cancelAnimationFrame(frame);
      bars.forEach((bar) => {
        if (bar) {
          bar.style.transform = "";
        }
      });
    };
  }, [live, analyser]);

  const progress = Math.min(1, elapsedMs / MAX_RECORDING_MS);
  const parsing = status === "parsing";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="listening-title"
      className="fixed inset-0 z-50 flex animate-[fade-in_160ms_ease-out] justify-center bg-background"
    >
      <div className="flex w-full max-w-lg flex-col px-5 pt-[calc(12px+env(safe-area-inset-top))] pb-[calc(24px+env(safe-area-inset-bottom))]">
        <header className="flex h-11 items-center justify-between">
          <p id="listening-title" role="status" className="flex items-center gap-2.5 text-base font-semibold">
            <span
              aria-hidden="true"
              className={`size-2.5 rounded-full ${parsing ? "bg-subtle" : "animate-pulse bg-accent"}`}
            />
            {parsing ? "Reading that…" : "Listening"}
          </p>
          <button
            type="button"
            onClick={onCancel}
            aria-label={parsing ? "Cancel" : "Cancel recording"}
            className="flex size-11 items-center justify-center rounded-full bg-fill text-foreground"
          >
            <CloseIcon className="size-[18px]" strokeWidth={1.9} />
          </button>
        </header>

        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <div className="relative size-[min(280px,72vw)]">
            <svg
              viewBox="0 0 280 280"
              className="absolute inset-0 size-full"
              role="img"
              aria-label={`Recording, ${Math.floor(elapsedMs / 1000)} of ${MAX_RECORDING_MS / 1000} seconds`}
            >
              <circle cx="140" cy="140" r={RING_RADIUS} fill="none" stroke="var(--line)" strokeWidth="3" />
              <circle
                cx="140"
                cy="140"
                r={RING_RADIUS}
                fill="none"
                stroke="var(--accent)"
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray={`${progress * RING_LENGTH} ${RING_LENGTH}`}
                transform="rotate(-90 140 140)"
                className="transition-[stroke-dasharray] duration-100 ease-linear"
              />
              <circle cx="140" cy="140" r="106" fill="var(--accent)" fillOpacity="0.07" />
              <circle cx="140" cy="140" r="80" fill="var(--accent)" fillOpacity="0.12" />
            </svg>
            <div aria-hidden="true" className="absolute inset-0 flex items-center justify-center gap-2">
              {BAR_SHAPE.map((shape, index) => (
                <span
                  key={index}
                  ref={(element) => {
                    barsRef.current[index] = element;
                  }}
                  style={
                    live
                      ? { height: "30%" }
                      : {
                          height: `${shape * (parsing ? 12 : 30)}%`,
                          animationDelay: `${index * 110}ms`,
                        }
                  }
                  className={`w-2 rounded-full bg-accent transition-transform duration-75 ${
                    live ? "" : parsing ? "animate-[voice-pulse_1.2s_ease-in-out_infinite] opacity-60" : "animate-[voice-pulse_1.1s_ease-in-out_infinite]"
                  }`}
                />
              ))}
            </div>
          </div>

          <p className="mt-7 flex items-baseline gap-2 font-mono">
            <span className="text-[40px] font-medium tracking-[-0.04em]">{formatSeconds(elapsedMs)}</span>
            <span className="text-base text-subtle">/ {formatSeconds(MAX_RECORDING_MS)}</span>
          </p>
          <p className="mt-3.5 max-w-[280px] text-base leading-normal text-pretty text-muted">
            {parsing
              ? "Turning that into sets. Nothing is saved until you confirm."
              : "Say the exercise, then the sets, reps and weight."}
          </p>
          {parsing ? null : (
            <p className="mt-1.5 text-sm text-subtle">“Romanian deadlift, 3 sets of 8 at 185”</p>
          )}
        </div>

        <div className="flex flex-col items-center gap-2.5">
          <button
            ref={stopRef}
            type="button"
            onClick={onStop}
            disabled={parsing}
            aria-label={parsing ? "Reading the recording" : "Stop and review"}
            className="flex size-20 items-center justify-center rounded-full bg-inverse text-inverse-ink shadow-lift disabled:opacity-70"
          >
            {parsing ? (
              <Spinner className="size-7" />
            ) : (
              <span aria-hidden="true" className="size-6 rounded-md bg-inverse-ink" />
            )}
          </button>
          <span className="text-[13px] font-medium text-muted">{parsing ? "Reading…" : "Done"}</span>
        </div>
      </div>
    </div>
  );
}
