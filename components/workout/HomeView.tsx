"use client";

import { BodyMap } from "@/components/BodyMap";
import { useWeightUnit } from "@/components/WeightUnit";
import { BrandMark, ChevronRightIcon, KeyboardIcon } from "@/components/icons";
import { TopActions } from "@/components/TopActions";
import { formatCalories } from "@/convex/lib/measures";
import { MUSCLE_LABELS, type MuscleGroup } from "@/convex/lib/muscleGroup";
import { untrainedGroups } from "@/lib/bodyMap/regions";
import {
  formatLongDate,
  formatShortDate,
  formatVolumeLb,
  pluralize,
  streakLabel,
} from "@/lib/format";
import { muscleFilterHref } from "@/lib/exerciseLink";
import { calendarDayKey, formatHistoryDayMeta, type HistoryDay } from "@/lib/historyDays";
import { MetaLine } from "@/components/MetaLine";
import { useBrowserTimeZone } from "@/components/useBrowserTimeZone";
import { formatSupersetNames } from "@/convex/lib/superset";
import Link from "next/link";
import { useRouter } from "next/navigation";

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

/** No workout open: the mic in the tab bar starts one with the first confirmed set. */
export function HomeView({
  lastWorkout,
  weekSummary,
  routines,
  offline = false,
  onType,
  onStartRoutine,
  onRepeat,
  repeating = false,
  typing = false,
  nextRoutine,
}: {
  lastWorkout: HistoryDay | null | undefined;
  weekSummary?: WeekSummary | null;
  /** Undefined while the list is still loading. An empty list offers to create one. */
  routines?: HomeRoutine[] | null;
  offline?: boolean;
  /** Opens the same typed-set bar used during a workout. */
  onType: () => void;
  onStartRoutine?: (routineId: string) => void;
  onRepeat?: (sessionIds: string[]) => void;
  repeating?: boolean;
  typing?: boolean;
  /** The routine after the last one used. Undefined while loading or offline. */
  nextRoutine?: HomeRoutine | null;
}) {
  const timeZone = useBrowserTimeZone();
  const doneToday = Boolean(
    lastWorkout && timeZone && lastWorkout.dayKey === calendarDayKey(Date.now(), timeZone),
  );
  return (
    <div
      className={`flex flex-col px-5 pt-3 ${
        typing
          ? "pb-[calc(8.5rem+var(--page-inset))]"
          : "pb-[calc(20px+var(--page-inset))]"
      }`}
    >
      <header className="flex min-h-11 items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <BrandMark />
          <span className="text-lg font-semibold tracking-[-0.01em]">Workout</span>
        </div>
        <TopActions />
      </header>

      <HomeHero
        lastWorkout={lastWorkout}
        nextRoutine={nextRoutine}
        offline={offline}
        onType={onType}
        onStartRoutine={onStartRoutine}
        starting={repeating}
        doneToday={doneToday}
      />

      {lastWorkout && !doneToday ? (
        <LastWorkoutCard workout={lastWorkout} onRepeat={onRepeat} repeating={repeating} />
      ) : null}

      {routines && routines.length > 0 ? (
        <div className="mt-5">
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <h2 className="text-xs font-medium tracking-[0.06em] text-subtle uppercase">Routines</h2>
            <Link href="/routines" className="text-sm font-medium text-muted hover:underline">
              Edit
            </Link>
          </div>
          <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none]">
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
          className="-ml-4 mt-3 inline-flex min-h-11 items-center self-start rounded-full px-4 text-base font-medium text-muted hover:bg-fill-2"
        >
          Create a routine
        </Link>
      ) : null}

      {weekSummary ? <WeeklySummary summary={weekSummary} /> : null}
    </div>
  );
}

function HomeHero({
  lastWorkout,
  nextRoutine,
  offline,
  onType,
  onStartRoutine,
  starting,
  doneToday,
}: {
  lastWorkout: HistoryDay | null | undefined;
  nextRoutine?: HomeRoutine | null;
  offline: boolean;
  onType: () => void;
  onStartRoutine?: (routineId: string) => void;
  starting: boolean;
  doneToday: boolean;
}) {
  const unit = useWeightUnit();
  const typeButton = (
    <button
      type="button"
      onClick={onType}
      className="-ml-4 mt-1 inline-flex min-h-11 items-center gap-2 self-start rounded-full px-4 text-base font-medium hover:bg-fill-2"
    >
      <KeyboardIcon className="size-5" />
      Type it instead
    </button>
  );
  const dateLine = (
    <p className="text-xs font-medium tracking-[0.06em] text-subtle uppercase" suppressHydrationWarning>
      {formatLongDate(Date.now())}
    </p>
  );

  if (doneToday && lastWorkout) {
    return (
      <section aria-labelledby="home-title" className="flex flex-col pt-5 pb-1">
        {dateLine}
        <h1 id="home-title" className="mt-1.5 text-3xl leading-[1.15] font-semibold tracking-[-0.025em]">
          Done today
        </h1>
        <Link
          href={`/history/day/${lastWorkout.dayKey}`}
          className="mt-1.5 flex items-center gap-1 self-start text-base text-pretty text-muted hover:text-foreground"
        >
          <MetaLine text={formatHistoryDayMeta(lastWorkout, unit, { volume: false })} />
          <ChevronRightIcon className="size-4 shrink-0" />
        </Link>
        <p className="mt-1.5 text-base text-muted">Tap the mic to add more.</p>
      </section>
    );
  }

  if (nextRoutine && onStartRoutine && !offline) {
    return (
      <section aria-labelledby="home-title" className="flex flex-col pt-5 pb-1">
        {dateLine}
        <p className="mt-1.5 text-base text-muted">Next up</p>
        <h1 id="home-title" className="text-3xl leading-[1.15] font-semibold tracking-[-0.025em] text-pretty">
          {nextRoutine.name}
        </h1>
        <button
          type="button"
          disabled={starting}
          onClick={() => onStartRoutine(nextRoutine._id)}
          className="mt-4 min-h-13 rounded-full bg-inverse px-6 text-lg font-semibold text-inverse-ink disabled:opacity-60"
        >
          {starting ? "Starting…" : `Start ${nextRoutine.name}`}
        </button>
        <p className="mt-3 text-base text-muted">Or tap the mic and say any set.</p>
        {typeButton}
      </section>
    );
  }

  return (
    <section aria-labelledby="home-title" className="flex flex-col pt-5 pb-1">
      {dateLine}
      <h1 id="home-title" className="mt-1.5 text-3xl leading-[1.15] font-semibold tracking-[-0.025em]">
        Ready when you are
      </h1>
      <p className="mt-1.5 text-base leading-normal text-pretty text-muted">
        {offline
          ? "Tap + below to add a set by hand. It stays on this phone until you reconnect."
          : lastWorkout === null
            ? "Tap the mic below and say your first set, like “Bench press, 3 sets of 10 at 135”."
            : "Tap the mic and say a set."}
      </p>
      {typeButton}
    </section>
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
    <div className="mt-4 flex flex-col rounded-[1.25rem] border border-line bg-surface p-4">
      <Link href={`/history/day/${workout.dayKey}`} className="flex min-w-0 flex-col gap-1 hover:opacity-80">
        <span className="text-xs leading-snug font-medium tracking-[0.06em] text-subtle uppercase" suppressHydrationWarning>
          Last workout · {formatShortDate(workout.startedAt)}
        </span>
        <span className="line-clamp-2 text-base font-medium text-pretty">
          {workout.exercises.length > 0 ? formatSupersetNames(workout.exercises) : "No sets"}
        </span>
        <MetaLine className="text-sm text-muted" text={formatHistoryDayMeta(workout, unit, { volume: false })} />
      </Link>
      {onRepeat ? (
        <button
          type="button"
          disabled={repeating}
          aria-label="Repeat last workout"
          onClick={() => onRepeat(workout.sessionIds)}
          className="mt-3 min-h-11 self-start rounded-full border border-input px-4 text-base font-semibold hover:bg-fill-2 disabled:opacity-60"
        >
          {repeating ? "Starting…" : "Repeat"}
        </button>
      ) : null}
    </div>
  );
}

function WeeklySummary({ summary }: { summary: WeekSummary }) {
  const unit = useWeightUnit();
  const router = useRouter();
  const untrained = untrainedGroups(summary.muscles);
  const trainedAny = summary.muscles.some((item) => item.sets > 0);
  return (
    <section aria-label="This week" className="mt-5 rounded-[1.25rem] border border-line bg-surface p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-xs font-medium tracking-[0.06em] text-subtle uppercase">This week</h2>
        <p className="text-sm text-muted">{streakLabel(summary.streakWeeks)}</p>
      </div>
      <p className="mt-2 text-base font-medium">
        <MetaLine
          text={[
            pluralize(summary.workouts, "workout"),
            pluralize(summary.sets, "set"),
            formatVolumeLb(summary.volumeLb, unit),
            ...((summary.calories ?? 0) > 0 ? [formatCalories(summary.calories ?? 0)] : []),
          ].join(" · ")}
        />
      </p>
      <BodyMap
        muscles={summary.muscles}
        onSelect={(group) => router.push(muscleFilterHref(group, true))}
        className="mt-3 h-56"
      />
      {trainedAny && untrained.length > 0 ? (
        <p className="mt-2 text-sm text-pretty">
          <span className="text-muted">Not trained yet · </span>
          {untrained.map((group, index) => (
            <span key={group}>
              {index > 0 ? <span className="text-muted"> · </span> : null}
              <Link href={muscleFilterHref(group, true)} className="font-medium hover:underline">
                {MUSCLE_LABELS[group]}
              </Link>
            </span>
          ))}
        </p>
      ) : null}
      <p className="mt-0.5 text-sm text-muted">
        <MetaLine
          text={[
            "Last week",
            pluralize(summary.previousWorkouts, "workout"),
            pluralize(summary.previousSets, "set"),
            formatVolumeLb(summary.previousVolumeLb, unit),
            ...((summary.previousCalories ?? 0) > 0 ? [formatCalories(summary.previousCalories ?? 0)] : []),
          ].join(" · ")}
        />
      </p>
    </section>
  );
}
