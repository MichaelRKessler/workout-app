"use client";

import { BrandMark, ChevronRightIcon, KeyboardIcon, MicIcon } from "@/components/icons";
import { TopActions } from "@/components/TopActions";
import { formatDuration, formatLongDate, formatShortDate, pluralize } from "@/lib/format";
import Link from "next/link";

export type LastWorkout = {
  _id: string;
  startedAt: number;
  completedAt: number;
  exercises: Array<{ name: string; setCount: number }>;
};

/** No workout open: the mic starts one with the first confirmed set. */
export function HomeView({
  lastWorkout,
  voiceBusy,
  onVoice,
  onManual,
}: {
  lastWorkout: LastWorkout | null | undefined;
  voiceBusy: boolean;
  onVoice: () => void;
  onManual: () => void;
}) {
  return (
    <div className="flex min-h-[calc(100dvh-env(safe-area-inset-top))] flex-col px-5 pt-3 pb-[calc(20px+env(safe-area-inset-bottom))]">
      <header className="flex h-11 items-center justify-between">
        <div className="flex items-center gap-2.5">
          <BrandMark />
          <span className="text-[17px] font-semibold tracking-[-0.01em]">Workout</span>
        </div>
        <TopActions />
      </header>

      <main className="flex flex-1 flex-col items-center justify-center py-8 text-center">
        <p className="text-xs font-medium tracking-[0.1em] text-subtle uppercase" suppressHydrationWarning>
          {formatLongDate(Date.now())}
        </p>
        <h1 className="mt-3 text-[30px] leading-[1.15] font-semibold tracking-[-0.025em]">
          Start a workout
        </h1>
        <p className="mt-2.5 max-w-[270px] text-[15px] leading-normal text-pretty text-muted">
          Say your first set. The workout starts when you confirm it.
        </p>

        <button
          type="button"
          onClick={onVoice}
          disabled={voiceBusy}
          aria-label="Log a set by voice"
          className="mt-11 flex size-[136px] items-center justify-center rounded-full border border-line transition active:scale-[0.98] disabled:opacity-70"
        >
          <span className="flex size-28 items-center justify-center rounded-full bg-inverse text-inverse-ink shadow-lift">
            <MicIcon className="size-10" strokeWidth={1.6} />
          </span>
        </button>
        <p className="mt-4 text-sm text-subtle">“Bench press, 3 sets of 10 at 135”</p>

        <button
          type="button"
          onClick={onManual}
          className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-[15px] font-medium hover:bg-fill-2"
        >
          <KeyboardIcon className="size-[18px]" />
          Type it instead
        </button>
      </main>

      {lastWorkout ? (
        <Link
          href={`/history/${lastWorkout._id}`}
          className="flex items-center gap-3.5 rounded-[18px] border border-line bg-surface p-4 hover:bg-fill-2"
        >
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-[11px] font-medium tracking-[0.1em] text-subtle uppercase" suppressHydrationWarning>
              Last workout · {formatShortDate(lastWorkout.startedAt)}
            </span>
            <span className="truncate text-[15px] font-medium">
              {lastWorkout.exercises.map((exercise) => exercise.name).join(", ") || "No sets"}
            </span>
            <span className="text-[13px] text-muted">
              {pluralize(lastWorkout.exercises.length, "exercise")} ·{" "}
              {pluralize(
                lastWorkout.exercises.reduce((sum, exercise) => sum + exercise.setCount, 0),
                "set",
              )}{" "}
              · {formatDuration(lastWorkout.completedAt - lastWorkout.startedAt)}
            </span>
          </span>
          <ChevronRightIcon className="size-5 shrink-0 text-subtle" />
        </Link>
      ) : null}
    </div>
  );
}
