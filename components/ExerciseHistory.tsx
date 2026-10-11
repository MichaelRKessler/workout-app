"use client";

import { Button } from "@/components/Button";
import { PageHeader } from "@/components/PageHeader";
import { TrendChart } from "@/components/workout/TrendChart";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { formatSetShort, formatShortDate, formatVolumeLb, pluralize } from "@/lib/format";
import { usePaginatedQuery, useQuery } from "convex/react";
import Link from "next/link";
import { useMemo } from "react";

export function ExerciseHistory({ exerciseId }: { exerciseId: string }) {
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
        <p className="mt-8 text-[15px] text-muted">Loading exercise…</p>
      </div>
    );
  }

  if (detail === null) {
    return (
      <div className="px-5 pt-3">
        <PageHeader backHref="/history" backLabel="Back to history" title="Exercise not found" />
        <p className="mt-3 text-[15px] leading-normal text-muted">
          That exercise is not in your history.
        </p>
      </div>
    );
  }

  const highlight = new Set<Id<"sets">>(
    [detail.bestWeight?.setId, detail.bestEpley?.setId, detail.bestBodyweight?.setId].filter(
      (id): id is Id<"sets"> => id !== undefined,
    ),
  );

  return (
    <div className="px-5 pt-3 pb-[calc(32px+env(safe-area-inset-bottom))]">
      <PageHeader backHref="/history" backLabel="Back to history" title={detail.name}>
        <Records detail={detail} />
        <TrendChart points={detail.trend} unit={detail.trendUnit} />
        {detail.truncated ? (
          <p className="mt-2 text-[13px] text-subtle">Best of your latest 2,000 sets.</p>
        ) : null}
      </PageHeader>

      {workouts.length === 0 ? (
        <p className="mt-8 text-[15px] text-muted">No sets logged for this exercise yet.</p>
      ) : (
        <ul className="mt-6 flex flex-col" aria-label="Past workouts">
          {workouts.map((workout) => (
            <li key={workout.sessionId} className="border-b border-line py-3">
              <Link
                href={`/history/${workout.sessionId}`}
                className="text-[15px] font-medium hover:underline"
                suppressHydrationWarning
              >
                {formatShortDate(workout.startedAt)}
              </Link>
              <p className="mt-1 font-mono text-sm text-muted">
                {workout.sets.map((set) => (
                  <span key={set._id} className="mr-3 inline-flex items-center gap-1.5">
                    {formatSetShort(set)}
                    {highlight.has(set._id) ? (
                      <span className="font-sans text-[11px] font-semibold tracking-[0.08em] text-accent uppercase">
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
}: {
  detail: {
    bestWeight: { setId: string; reps: number; weightLb: number; epleyLb: number | null } | null;
    bestEpley: { setId: string; reps: number; weightLb: number; epleyLb: number | null } | null;
    bestBodyweight: { reps: number } | null;
  };
}) {
  const sameEffort = detail.bestWeight && detail.bestEpley && detail.bestWeight.setId === detail.bestEpley.setId;
  return (
    <div className="mt-3 flex flex-col gap-1 text-[15px] text-muted">
      {detail.bestWeight ? (
        <p>
          <SectionInline>Heaviest</SectionInline> {formatSetShort(detail.bestWeight)}
          {sameEffort && detail.bestEpley?.epleyLb != null
            ? ` · est. 1RM ${formatVolumeLb(detail.bestEpley.epleyLb)}`
            : ""}
        </p>
      ) : null}
      {detail.bestEpley && !sameEffort && detail.bestEpley.epleyLb !== null ? (
        <p>
          <SectionInline>Best est. 1RM</SectionInline> {formatVolumeLb(detail.bestEpley.epleyLb)} ·{" "}
          {formatSetShort(detail.bestEpley)}
        </p>
      ) : null}
      {detail.bestBodyweight ? (
        <p>
          <SectionInline>Most reps</SectionInline> {pluralize(detail.bestBodyweight.reps, "rep")} · bodyweight
        </p>
      ) : null}
      {!detail.bestWeight && !detail.bestEpley && !detail.bestBodyweight ? (
        <p>No sets yet.</p>
      ) : null}
    </div>
  );
}

function SectionInline({ children }: { children: string }) {
  return <span className="font-medium text-foreground">{children}</span>;
}
