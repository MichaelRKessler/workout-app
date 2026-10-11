"use client";

import { Button } from "@/components/Button";
import { PageHeader } from "@/components/PageHeader";
import { useBrowserTimeZone } from "@/components/useBrowserTimeZone";
import { useWeightUnit } from "@/components/WeightUnit";
import { TrendChart } from "@/components/workout/TrendChart";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { formatClock, formatDistance } from "@/convex/lib/measures";
import { SetTypeTag } from "@/components/SetTypePicker";
import { formatSetShort, formatShortDate, formatVolumeLb, formatWeightLb, pluralize } from "@/lib/format";
import { usePaginatedQuery, useQuery } from "convex/react";
import Link from "next/link";
import { useMemo } from "react";

export function ExerciseHistory({ exerciseId }: { exerciseId: string }) {
  const unit = useWeightUnit();
  const timeZone = useBrowserTimeZone();
  const detail = useQuery(api.exercises.detail, { exerciseId });
  const { results, status, loadMore } = usePaginatedQuery(
    api.exercises.history,
    { exerciseId },
    { initialNumItems: 30 },
  );

  const workouts = useMemo(() => {
    type HistorySet = (typeof results)[number];
    const order: Array<HistorySet["sessionId"]> = [];
    const groups = new Map<
      HistorySet["sessionId"],
      {
        sessionId: HistorySet["sessionId"];
        startedAt: number;
        sets: HistorySet[];
      }
    >();
    for (const set of results) {
      const existing = groups.get(set.sessionId);
      if (existing) {
        existing.sets.push(set);
        continue;
      }
      groups.set(set.sessionId, {
        sessionId: set.sessionId,
        startedAt: set.sessionStartedAt,
        sets: [set],
      });
      order.push(set.sessionId);
    }
    return order.map((sessionId) => {
      const group = groups.get(sessionId);
      if (!group) {
        return null;
      }
      group.sets.sort((left, right) => left.loggedAt - right.loggedAt);
      return group;
    }).filter((group) => group !== null);
  }, [results]);

  if (detail === undefined || status === "LoadingFirstPage") {
    return (
      <div className="px-5 pt-3">
        <PageHeader backHref="/history" backLabel="Back to history" title="Exercise" />
        <p className="mt-8 text-base text-muted">Loading exercise…</p>
      </div>
    );
  }

  if (detail === null) {
    return (
      <div className="px-5 pt-3">
        <PageHeader backHref="/history" backLabel="Back to history" title="Exercise not found" />
        <p className="mt-3 text-base leading-normal text-muted">
          That exercise is not in your history.
        </p>
      </div>
    );
  }

  const highlight = new Set<Id<"sets">>(
    [
      detail.bestWeight?.setId,
      detail.bestEpley?.setId,
      detail.bestBodyweight?.setId,
      detail.bestDuration?.setId,
      detail.bestDistance?.setId,
    ].filter((id): id is Id<"sets"> => id !== undefined),
  );

  return (
    <div className="px-5 pt-3 pb-[calc(32px+env(safe-area-inset-bottom))]">
      <PageHeader backHref="/history" backLabel="Back to history" title={detail.name}>
        <Records detail={detail} unit={unit} />
        <TrendChart
          points={detail.trend}
          recordUnit={detail.trendUnit}
          weightUnit={unit}
          timeZone={timeZone}
        />
        {detail.truncated ? (
          <p className="mt-2 text-sm text-subtle">Best of your latest 2,000 sets.</p>
        ) : null}
      </PageHeader>

      {workouts.length === 0 ? (
        <p className="mt-8 text-base text-muted">No sets logged for this exercise yet.</p>
      ) : (
        <ul className="mt-6 flex flex-col" aria-label="Past workouts">
          {workouts.map((workout) => (
            <li key={workout.sessionId} className="border-b border-line py-3">
              <Link
                href={`/history/${workout.sessionId}`}
                className="text-base font-medium hover:underline"
                suppressHydrationWarning
              >
                {formatShortDate(workout.startedAt)}
              </Link>
              <p className="mt-1 font-mono text-sm text-muted">
                {workout.sets.map((set) => (
                  <span key={set._id} className="mr-3 inline-flex items-center gap-1.5">
                    {formatSetShort(set, unit)}
                    <SetTypeTag setType={set.setType} />
                    {highlight.has(set._id) ? (
                      <span className="font-sans text-xs font-semibold tracking-[0.05em] text-accent uppercase">
                        PR
                      </span>
                    ) : null}
                  </span>
                ))}
              </p>
            </li>
          ))}
        </ul>
      )}

      {status === "CanLoadMore" ? (
        <Button variant="secondary" className="mt-6 w-full" onClick={() => loadMore(30)}>
          Load more
        </Button>
      ) : null}
      {status === "LoadingMore" ? (
        <p className="mt-6 text-center text-sm text-muted">Loading more…</p>
      ) : null}
    </div>
  );
}

function Records({
  detail,
  unit,
}: {
  detail: {
    bestWeight: { setId: string; reps: number | null; weightLb: number; epleyLb: number | null } | null;
    bestEpley: { setId: string; reps: number | null; weightLb: number; epleyLb: number | null } | null;
    bestBodyweight: { reps: number | null } | null;
    bestDuration: { durationSec: number | null; weightLb: number } | null;
    bestDistance: { distanceM: number | null; durationSec: number | null } | null;
  };
  unit: "lb" | "kg";
}) {
  const sameEffort = detail.bestWeight && detail.bestEpley && detail.bestWeight.setId === detail.bestEpley.setId;
  const hasStrength = Boolean(detail.bestWeight || detail.bestEpley || detail.bestBodyweight);
  return (
    <div className="mt-3 flex flex-col gap-1 text-base text-muted">
      {detail.bestWeight ? (
        <p>
          <SectionInline>Heaviest</SectionInline> {formatSetShort(detail.bestWeight, unit)}
          {sameEffort && detail.bestEpley?.epleyLb != null
            ? ` · est. 1RM ${formatVolumeLb(detail.bestEpley.epleyLb, unit)}`
            : ""}
        </p>
      ) : null}
      {detail.bestEpley && !sameEffort && detail.bestEpley.epleyLb !== null ? (
        <p>
          <SectionInline>Best est. 1RM</SectionInline> {formatVolumeLb(detail.bestEpley.epleyLb, unit)} ·{" "}
          {formatSetShort(detail.bestEpley, unit)}
        </p>
      ) : null}
      {detail.bestBodyweight?.reps ? (
        <p>
          <SectionInline>Most reps</SectionInline> {pluralize(detail.bestBodyweight.reps, "rep")} · bodyweight
        </p>
      ) : null}
      {detail.bestDuration?.durationSec ? (
        <p>
          <SectionInline>Longest</SectionInline> {formatClock(detail.bestDuration.durationSec)}
          {detail.bestDuration.weightLb > 0
            ? ` at ${formatWeightLb(detail.bestDuration.weightLb, unit)}`
            : ""}
        </p>
      ) : null}
      {detail.bestDistance?.distanceM ? (
        <p>
          <SectionInline>Farthest</SectionInline> {formatDistance(detail.bestDistance.distanceM)}
          {detail.bestDistance.durationSec ? ` in ${formatClock(detail.bestDistance.durationSec)}` : ""}
        </p>
      ) : null}
      {!hasStrength && !detail.bestDuration && !detail.bestDistance ? <p>No sets yet.</p> : null}
    </div>
  );
}

function SectionInline({ children }: { children: string }) {
  return <span className="font-medium text-foreground">{children}</span>;
}
