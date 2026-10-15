"use client";

import { Button } from "@/components/Button";
import { BadgeShelf, WorkoutRecap } from "@/components/WorkoutRecap";
import { Confetti } from "@/components/workout/Confetti";
import { api } from "@/convex/_generated/api";
import { hashSeed } from "@/convex/lib/recap";
import type { PersonalRecord } from "@/convex/lib/records";
import { formatCalories, formatDistance } from "@/convex/lib/measures";
import type { WeightUnit } from "@/convex/lib/units";
import { formatRecordDetail, formatVolumeLb, pluralize } from "@/lib/format";
import {
  formatSummaryMinutes,
  summaryMinutes,
  type WorkoutSummary,
} from "@/lib/workoutSummary";
import { headingFor } from "@/lib/recapText";
import { useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";

export function WorkoutSummaryCard({
  summary,
  records,
  unit,
  recordsPending = false,
  note,
}: {
  summary: WorkoutSummary;
  records: PersonalRecord[];
  unit: WeightUnit;
  /** True when the workout is still waiting to sync, so records are not final. */
  recordsPending?: boolean;
  note?: string | null;
}) {
  const clock =
    summary.totalMs !== null && summary.activeMs !== null
      ? summaryMinutes(summary.totalMs, summary.activeMs)
      : null;
  const stats: Array<{ label: string; value: string }> = [];
  if (clock) {
    stats.push(
      { label: "Time", value: formatSummaryMinutes(clock.total) },
      { label: "Active", value: formatSummaryMinutes(clock.active) },
      { label: "Rest", value: formatSummaryMinutes(clock.rest) },
    );
  }
  // A cardio-only or bodyweight workout has no volume, so "0 lb" would only add noise.
  if (summary.volumeLb > 0) {
    stats.push({ label: "Volume", value: volumeLabel(summary.volumeLb, unit) });
  }
  if (summary.distanceM > 0) {
    stats.push({ label: "Distance", value: formatDistance(summary.distanceM) });
  }
  if (summary.calories > 0) {
    stats.push({ label: "Calories", value: formatCalories(summary.calories) });
  }
  const counts = [
    pluralize(summary.exerciseCount, "exercise"),
    pluralize(summary.setCount, "set"),
  ].join(" · ");

  return (
    <section aria-label="Workout summary" className="rounded-[1.25rem] border border-line bg-surface px-4 py-3.5">
      {stats.length > 0 ? (
        <dl className="mb-2.5 grid grid-cols-3 gap-x-3 gap-y-2.5">
          {stats.map((stat) => (
            <Stat key={stat.label} label={stat.label} value={stat.value} />
          ))}
        </dl>
      ) : null}
      <p className="text-sm text-pretty text-muted">
        {counts}
        {summary.warmupCount > 0 ? (
          <span className="text-subtle">
            {" "}
            · {pluralize(summary.warmupCount, "warm-up")} not counted
          </span>
        ) : null}
      </p>
      {note ? <p className="mt-2 text-sm text-pretty text-subtle">{note}</p> : null}
      {records.length > 0 || recordsPending ? (
        <div className="mt-3 border-t border-line pt-2.5">
          {records.length > 0 ? (
            <>
              <h3 className="text-xs font-medium tracking-[0.06em] text-subtle uppercase">
                {pluralize(records.length, "new record")}
              </h3>
              <ul className="mt-1 flex flex-col gap-0.5">
                {records.map((record) => (
                  <li
                    key={`${record.exerciseName}-${record.kind}-${record.weightLb}`}
                    className="text-[0.9375rem] leading-snug text-pretty"
                  >
                    {formatRecordDetail(record, unit)}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-sm text-pretty text-muted">
              New records show in History after this workout syncs.
            </p>
          )}
        </div>
      ) : null}
    </section>
  );
}

function volumeLabel(pounds: number, unit: WeightUnit): string {
  return formatVolumeLb(pounds, unit);
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium tracking-[0.06em] text-subtle uppercase">{label}</dt>
      <dd className="text-[1.0625rem] leading-snug font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

export function FinishedWorkout({
  sessionId,
  summary,
  records,
  unit,
  recordsPending,
  note,
  dayKey,
  onDone,
}: {
  /** The saved workout on the server. Null while it waits to sync. */
  sessionId: string | null;
  summary: WorkoutSummary;
  records: PersonalRecord[];
  unit: WeightUnit;
  recordsPending: boolean;
  note?: string | null;
  dayKey: string;
  onDone: () => void;
}) {
  // Read once so the recap keeps the calendar it was opened with.
  const [utcOffsetMinutes] = useState(() => -new Date().getTimezoneOffset());
  const loaded = useQuery(
    api.recap.forSession,
    sessionId && !recordsPending ? { sessionId, utcOffsetMinutes } : "skip",
  );
  const recap = loaded?.recap ?? null;
  const names = loaded?.exerciseNames ?? {};
  const seed = recap?.seed ?? hashSeed(sessionId ?? dayKey);
  const heading = loaded === undefined && sessionId && !recordsPending
    ? "Workout saved"
    : headingFor(seed, recap?.confetti ?? false);

  return (
    <div className="px-5 pt-3 pb-[calc(32px+var(--page-inset))]">
      {recap?.confetti ? <Confetti /> : null}
      <h1 className="mt-2 text-title leading-tight font-semibold tracking-[-0.03em]">{heading}</h1>
      <p className="mt-1.5 text-base text-muted">Workout saved to History.</p>
      {recap ? (
        <div className="mt-5">
          <WorkoutRecap recap={recap} names={names} unit={unit} />
        </div>
      ) : null}
      <div className="mt-5">
        <WorkoutSummaryCard
          summary={summary}
          records={records}
          unit={unit}
          recordsPending={recordsPending}
          note={note}
        />
      </div>
      <div className="mt-6 flex flex-col gap-2.5">
        <Button size="lg" className="w-full" onClick={onDone}>
          Done
        </Button>
        <Link
          href={`/history/day/${dayKey}`}
          className="inline-flex min-h-13 items-center justify-center rounded-full border border-line bg-surface px-6 text-base font-semibold hover:bg-fill-2"
        >
          View in History
        </Link>
      </div>
      {recap ? <BadgeShelf badges={recap.badges} names={names} /> : null}
    </div>
  );
}
