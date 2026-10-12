"use client";

import { useWeightUnit } from "@/components/WeightUnit";
import { BrandMark, ChevronRightIcon, KeyboardIcon, MicIcon } from "@/components/icons";
import { TopActions } from "@/components/TopActions";
import { formatCalories } from "@/convex/lib/measures";
import { formatMuscleSummary, type MuscleGroup } from "@/convex/lib/muscleGroup";
import {
  formatLongDate,
  formatShortDate,
  formatVolumeLb,
  pluralize,
  streakLabel,
} from "@/lib/format";
import { formatHistoryDayMeta, type HistoryDay } from "@/lib/historyDays";
import { formatSupersetNames } from "@/convex/lib/superset";
import { OFFLINE_VOICE_MESSAGE } from "@/lib/offline/messages";
import Link from "next/link";

export type WeekSummary = {
  workouts: number;
  sets: number;
  volumeLb: number;
  calories?: number;
  previousWorkouts: number;
  previousSets: number;
  previousVolumeLb: number;
  previousCalories?: number;
  streakWeeks: number;
  muscles: Array<{ group: MuscleGroup; sets: number }>;
};

export type HomeRoutine = {
  _id: string;
  name: string;
};

/** No workout open: the mic starts one with the first confirmed set. */
export function HomeView({
  lastWorkout,
  weekSummary,
  routines,
  voiceBusy,
  offline = false,
  onVoice,
  onType,
  onStartRoutine,
  onRepeat,
  repeating = false,
  typing = false,
}: {
  lastWorkout: HistoryDay | null | undefined;
  weekSummary?: WeekSummary | null;
  /** Undefined while the list is still loading. An empty list offers to create one. */
  routines?: HomeRoutine[] | null;
  voiceBusy: boolean;
  offline?: boolean;
  onVoice: () => void;
  /** Opens the same typed-set bar used during a workout. */
  onType: () => void;
  onStartRoutine?: (routineId: string) => void;
  onRepeat?: (sessionIds: string[]) => void;
  repeating?: boolean;
  typing?: boolean;
}) {
  return (
    <div
      className={`flex min-h-[calc(100dvh-env(safe-area-inset-top))] flex-col px-5 pt-3 ${
        typing
          ? "pb-[calc(8.5rem+env(safe-area-inset-bottom))]"
          : "pb-[calc(20px+env(safe-area-inset-bottom))]"
      }`}
    >
      <header className="flex min-h-11 items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <BrandMark />
          <span className="text-lg font-semibold tracking-[-0.01em]">Workout</span>
        </div>
        <TopActions />
      </header>

      <main className="flex flex-1 flex-col items-center justify-center py-8 text-center">
        <p className="text-xs font-medium tracking-[0.06em] text-subtle uppercase" suppressHydrationWarning>
          {formatLongDate(Date.now())}
        </p>
        <h1 className="mt-3 text-3xl leading-[1.15] font-semibold tracking-[-0.025em]">
          Start a workout
        </h1>
        <p className="mt-2.5 max-w-[21.5rem] text-base leading-normal text-pretty text-muted">
          {offline
            ? "Add the first set by hand. It stays on this phone until you reconnect."
            : "Say your first set. The workout starts when you confirm it."}
        </p>

        <button
          type="button"
          onClick={onVoice}
          disabled={voiceBusy || offline}
          aria-label="Log a set by voice"
          className="mt-11 flex size-34 items-center justify-center rounded-full border border-line transition active:scale-[0.98] disabled:opacity-70"
        >
          <span className="flex size-28 items-center justify-center rounded-full bg-inverse text-inverse-ink shadow-lift">
            <MicIcon className="size-10" strokeWidth={1.6} />
          </span>
        </button>
        <p className="mt-4 text-sm text-subtle">
          {offline ? OFFLINE_VOICE_MESSAGE : "“Bench press, 3 sets of 10 at 135”"}
        </p>

        <button
          type="button"
          onClick={onType}
          className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-base font-medium hover:bg-fill-2"
        >
          <KeyboardIcon className="size-5" />
          Type it instead
        </button>
        <div className="mt-1 flex flex-wrap items-center justify-center">
          <Link
            href="/history/log"
            className="inline-flex min-h-11 items-center rounded-full px-4 text-base font-medium text-muted hover:bg-fill-2"
          >
            Log a past workout
          </Link>
          <Link
            href="/body"
            className="inline-flex min-h-11 items-center rounded-full px-4 text-base font-medium text-muted hover:bg-fill-2"
          >
            Body
          </Link>
        </div>
        {routines && routines.length > 0 ? (
          <div className="mt-5 w-full max-w-[22rem]">
            <div className="mb-2 flex items-baseline justify-between gap-3 px-1">
              <h2 className="text-xs font-medium tracking-[0.06em] text-subtle uppercase">Routines</h2>
              <Link href="/routines" className="text-sm font-medium text-muted hover:underline">
                Edit
              </Link>
            </div>
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
              {routines.map((routine) => (
                <button
                  key={routine._id}
                  type="button"
                  onClick={() => onStartRoutine?.(routine._id)}
                  className="min-h-11 max-w-[14rem] shrink-0 truncate rounded-full border border-line bg-surface px-4 text-base font-medium hover:bg-fill-2"
                >
                  {routine.name}
                </button>
              ))}
            </div>
          </div>
        ) : routines ? (
          <Link
            href="/routines/new"
            className="mt-1 inline-flex min-h-11 items-center rounded-full px-4 text-base font-medium text-muted hover:bg-fill-2"
          >
            Create a routine
          </Link>
        ) : null}
      </main>

      {weekSummary ? <WeeklySummary summary={weekSummary} /> : null}

      {lastWorkout ? (
        <LastWorkoutCard workout={lastWorkout} onRepeat={onRepeat} repeating={repeating} />
      ) : null}
    </div>
  );
}

function LastWorkoutCard({
  workout,
  onRepeat,
  repeating,
}: {
  workout: HistoryDay;
  onRepeat?: (sessionIds: string[]) => void;
  repeating: boolean;
}) {
  const unit = useWeightUnit();
  return (
    <div className="flex items-center gap-3 rounded-[1.25rem] border border-line bg-surface p-4">
      <Link
        href={`/history/day/${workout.dayKey}`}
        className="flex min-w-0 flex-1 items-center gap-3 hover:opacity-80"
      >
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-xs leading-snug font-medium tracking-[0.06em] text-subtle uppercase" suppressHydrationWarning>
            Last workout · {formatShortDate(workout.startedAt)}
          </span>
          <span className="line-clamp-2 text-base font-medium">
            {workout.exercises.length > 0 ? formatSupersetNames(workout.exercises) : "No sets"}
          </span>
          <span className="text-sm text-pretty text-muted">{formatHistoryDayMeta(workout, unit)}</span>
        </span>
        <ChevronRightIcon className="size-5 shrink-0 text-subtle" />
      </Link>
      {onRepeat ? (
        <button
          type="button"
          disabled={repeating}
          aria-label="Repeat last workout"
          onClick={() => onRepeat(workout.sessionIds)}
          className="min-h-12 shrink-0 rounded-full bg-inverse px-4 text-base font-semibold text-inverse-ink disabled:opacity-60"
        >
          {repeating ? "Starting…" : "Repeat"}
        </button>
      ) : null}
    </div>
  );
}

function WeeklySummary({ summary }: { summary: WeekSummary }) {
  const unit = useWeightUnit();
  const muscles = formatMuscleSummary(summary.muscles);
  return (
    <section aria-label="This week" className="mb-3 rounded-[1.25rem] border border-line bg-surface p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-xs font-medium tracking-[0.06em] text-subtle uppercase">This week</h2>
        <p className="text-sm text-muted">{streakLabel(summary.streakWeeks)}</p>
      </div>
      <p className="mt-2 text-base font-medium text-pretty">
        {pluralize(summary.workouts, "workout")} · {pluralize(summary.sets, "set")} ·{" "}
        {formatVolumeLb(summary.volumeLb, unit)}
        {(summary.calories ?? 0) > 0 ? ` · ${formatCalories(summary.calories ?? 0)}` : ""}
      </p>
      {muscles ? <p className="mt-1 text-sm text-pretty text-muted">{muscles}</p> : null}
      <p className="mt-0.5 text-sm text-pretty text-muted">
        Last week · {pluralize(summary.previousWorkouts, "workout")} ·{" "}
        {pluralize(summary.previousSets, "set")} · {formatVolumeLb(summary.previousVolumeLb, unit)}
        {(summary.previousCalories ?? 0) > 0 ? ` · ${formatCalories(summary.previousCalories ?? 0)}` : ""}
      </p>
    </section>
  );
}
