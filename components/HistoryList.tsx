"use client";

import { Button } from "@/components/Button";
import { ChevronRightIcon } from "@/components/icons";
import { PageHeader, SectionLabel } from "@/components/PageHeader";
import { api } from "@/convex/_generated/api";
import { formatDuration, formatMonthHeading, monthKey, pluralize } from "@/lib/format";
import { usePaginatedQuery } from "convex/react";
import Link from "next/link";
import { useMemo } from "react";

export function HistoryList() {
  const { results, status, loadMore } = usePaginatedQuery(
    api.sessions.listHistory,
    {},
    { initialNumItems: 15 },
  );

  const months = useMemo(() => {
    const grouped: Array<{ key: string; label: string; sessions: typeof results }> = [];
    for (const session of results) {
      const key = monthKey(session.startedAt);
      const current = grouped[grouped.length - 1];
      if (current && current.key === key) {
        current.sessions.push(session);
      } else {
        grouped.push({ key, label: formatMonthHeading(session.startedAt), sessions: [session] });
      }
    }
    return grouped;
  }, [results]);

  return (
    <div className="px-5 pt-3 pb-[calc(32px+env(safe-area-inset-bottom))]">
      <PageHeader backHref="/" title="History" />

      {status === "LoadingFirstPage" ? (
        <p className="mt-8 text-[15px] text-muted">Loading history…</p>
      ) : results.length === 0 ? (
        <p className="mt-8 max-w-[300px] text-[15px] leading-normal text-muted">
          No finished workouts yet. Finish one and it shows up here.
        </p>
      ) : (
        months.map((month) => (
          <section key={month.key} aria-labelledby={`month-${month.key}`} className="mt-7">
            <SectionLabel id={`month-${month.key}`}>{month.label}</SectionLabel>
            <ul className="flex flex-col">
              {month.sessions.map((session) => {
                const date = new Date(session.startedAt);
                const setCount = session.exercises.reduce(
                  (sum, exercise) => sum + exercise.setCount,
                  0,
                );
                return (
                  <li key={session._id}>
                    <Link
                      href={`/history/${session._id}`}
                      className="flex min-h-[72px] items-center gap-4 border-b border-line py-2.5 hover:bg-fill-2/60"
                    >
                      <span className="flex w-9 shrink-0 flex-col items-center" suppressHydrationWarning>
                        <span className="text-[11px] font-semibold tracking-[0.06em] text-subtle uppercase">
                          {date.toLocaleDateString(undefined, { weekday: "short" })}
                        </span>
                        <span className="font-mono text-[22px] font-medium tracking-[-0.03em]">
                          {date.getDate()}
                        </span>
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="truncate text-[15px] font-medium">
                          {session.exercises.map((exercise) => exercise.name).join(", ") ||
                            "No sets"}
                        </span>
                        <span className="text-[13px] text-muted">
                          {pluralize(session.exercises.length, "exercise")} ·{" "}
                          {pluralize(setCount, "set")} ·{" "}
                          {formatDuration(session.completedAt - session.startedAt)}
                        </span>
                      </span>
                      <ChevronRightIcon className="size-[18px] shrink-0 text-subtle" strokeWidth={1.8} />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}

      {status === "CanLoadMore" ? (
        <Button variant="secondary" className="mt-6 w-full" onClick={() => loadMore(15)}>
          Load more
        </Button>
      ) : null}
      {status === "LoadingMore" ? (
        <p className="mt-6 text-center text-sm text-muted">Loading more…</p>
      ) : null}
    </div>
  );
}
