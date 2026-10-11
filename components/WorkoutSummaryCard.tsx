"use client";

import { Button } from "@/components/Button";
import type { PersonalRecord } from "@/convex/lib/records";
import { formatDistance } from "@/convex/lib/measures";
import type { WeightUnit } from "@/convex/lib/units";
import { formatPersonalRecord, formatVolumeLb, pluralize } from "@/lib/format";
import {
  formatSummaryMinutes,
  summaryMinutes,
  type WorkoutSummary,
} from "@/lib/workoutSummary";
import Link from "next/link";

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
  const recordHeading =
    records.length === 0
      ? "Records"
      : `${pluralize(records.length, "new record")}`;

  return (
    <section aria-label="Workout summary" className="rounded-[1.25rem] border border-line bg-surface p-4">
      <h2 className="text-xs font-medium tracking-[0.06em] text-subtle uppercase">Summary</h2>
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-3">
        {clock ? (
          <>
            <Stat label="Time" value={formatSummaryMinutes(clock.total)} />
            <Stat label="Volume" value={volumeLabel(summary.volumeLb, unit)} />
            <Stat label="Active" value={formatSummaryMinutes(clock.active)} />
            <Stat label="Rest" value={formatSummaryMinutes(clock.rest)} />
          </>
        ) : (
          <Stat label="Volume" value={volumeLabel(summary.volumeLb, unit)} />
        )}
        <Stat label="Exercises" value={String(summary.exerciseCount)} />
        <Stat label="Sets" value={String(summary.setCount)} />
        {summary.distanceM > 0 ? (
          <Stat label="Distance" value={formatDistance(summary.distanceM)} />
        ) : null}
      </dl>
      {summary.warmupCount > 0 ? (
        <p className="mt-3 text-sm text-pretty text-subtle">
          {pluralize(summary.warmupCount, "warm-up")} not included in sets or volume.
        </p>
      ) : null}
      {note ? <p className="mt-2 text-sm text-pretty text-subtle">{note}</p> : null}
      <div className="mt-3 border-t border-line pt-3">
        <h3 className="text-xs font-medium tracking-[0.06em] text-subtle uppercase">{recordHeading}</h3>
        {records.length > 0 ? (
          <ul className="mt-1.5 flex flex-col gap-1">
            {records.map((record) => (
              <li key={`${record.exerciseName}-${record.kind}-${record.weightLb}`} className="text-base">
                {formatPersonalRecord(record, unit)}
              </li>
            ))}
          </ul>
        ) : recordsPending ? (
          <p className="mt-1.5 text-base text-pretty text-muted">
            New records show in History after this workout syncs.
          </p>
        ) : (
          <p className="mt-1.5 text-base text-muted">No new records.</p>
        )}
      </div>
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
      <dd className="mt-0.5 truncate font-mono text-lg font-medium tracking-[-0.03em]">{value}</dd>
    </div>
  );
}

export function FinishedWorkout({
  summary,
  records,
  unit,
  recordsPending,
  note,
  dayKey,
  onDone,
}: {
  summary: WorkoutSummary;
  records: PersonalRecord[];
  unit: WeightUnit;
  recordsPending: boolean;
  note?: string | null;
  dayKey: string;
  onDone: () => void;
}) {
  return (
    <div className="px-5 pt-3 pb-[calc(32px+env(safe-area-inset-bottom))]">
      <h1 className="mt-2 text-title leading-tight font-semibold tracking-[-0.03em]">Workout saved</h1>
      <p className="mt-1.5 text-base text-muted">It is in History with this summary.</p>
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
        <Link
          href={`/history/day/${dayKey}`}
          className="inline-flex min-h-13 items-center justify-center rounded-full bg-inverse px-6 text-base font-semibold text-inverse-ink hover:opacity-90"
        >
          View in History
        </Link>
        <Button variant="secondary" size="lg" className="w-full" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  );
}
