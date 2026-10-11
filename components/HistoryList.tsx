"use client";

import { Button } from "@/components/Button";
import { HistoryCalendar } from "@/components/HistoryCalendar";
import { ChevronRightIcon } from "@/components/icons";
import { PageHeader, SectionLabel } from "@/components/PageHeader";
import { useBrowserTimeZone } from "@/components/useBrowserTimeZone";
import { useWeightUnit } from "@/components/WeightUnit";
import { api } from "@/convex/_generated/api";
import { formatLongDate, formatMonthHeading, monthKey } from "@/lib/format";
import { formatHistoryDayMeta, visibleHistoryDays, type HistoryDay } from "@/lib/historyDays";
import { usePaginatedQuery } from "convex/react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

const HISTORY_VIEW_KEY = "workout-history-view";

type HistoryView = "list" | "calendar";

export function HistoryList() {
  const { results, status, loadMore } = usePaginatedQuery(
    api.sessions.listHistory,
    {},
    { initialNumItems: 15 },
  );
  const timeZone = useBrowserTimeZone();
  const unit = useWeightUnit();
  const [view, setView] = useState<HistoryView>("list");

  useEffect(() => {
    const stored = window.localStorage.getItem(HISTORY_VIEW_KEY);
    if (stored === "list" || stored === "calendar") {
      setView(stored);
    }
  }, []);

  function chooseView(next: HistoryView) {
    setView(next);
    window.localStorage.setItem(HISTORY_VIEW_KEY, next);
  }

  const months = useMemo(() => {
    if (!timeZone) {
      return [];
    }
    const hasMore = status === "CanLoadMore" || status === "LoadingMore";
    const days = visibleHistoryDays(
      results.map((session) => ({
        id: session._id,
        startedAt: session.startedAt,
        completedAt: session.completedAt,
        volumeLb: session.volumeLb ?? 0,
        exercises: session.exercises.map((exercise) => ({
          exerciseId: exercise.exerciseId,
          name: exercise.name,
          setCount: exercise.setCount,
        })),
      })),
      hasMore,
      timeZone,
    );
    const grouped: Array<{ key: string; label: string; days: HistoryDay[] }> = [];
    for (const day of days) {
      const key = monthKey(day.startedAt);
      const current = grouped[grouped.length - 1];
      if (current && current.key === key) {
        current.days.push(day);
      } else {
        grouped.push({ key, label: formatMonthHeading(day.startedAt), days: [day] });
      }
    }
    return grouped;
  }, [results, status, timeZone]);

  const waiting = !timeZone || status === "LoadingFirstPage";

  return (
    <div className="px-5 pt-3 pb-[calc(32px+env(safe-area-inset-bottom))]">
      <PageHeader backHref="/" title="History" />
      <Link
        href="/history/log"
        className="mt-4 inline-flex min-h-11 items-center rounded-full border border-line bg-surface px-4 text-base font-medium hover:bg-fill-2"
      >
        Log a past workout
      </Link>
      <div role="tablist" aria-label="History layout" className="mt-4 grid grid-cols-2 gap-1 rounded-full bg-fill p-1">
        <button
          type="button"
          role="tab"
          aria-selected={view === "list"}
          onClick={() => chooseView("list")}
          className={`min-h-11 rounded-full text-base font-medium ${
            view === "list" ? "bg-surface text-foreground shadow-float" : "text-muted"
          }`}
        >
          List
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === "calendar"}
          onClick={() => chooseView("calendar")}
          className={`min-h-11 rounded-full text-base font-medium ${
            view === "calendar" ? "bg-surface text-foreground shadow-float" : "text-muted"
          }`}
        >
          Calendar
        </button>
      </div>

      {view === "calendar" ? (
        timeZone ? (
          <HistoryCalendar timeZone={timeZone} />
        ) : (
          <p className="mt-8 text-base text-muted">Loading calendar…</p>
        )
      ) : waiting ? (
        <p className="mt-8 text-base text-muted">Loading history…</p>
      ) : results.length === 0 ? (
        <p className="mt-8 max-w-[22.5rem] text-base leading-normal text-muted">
          No finished workouts yet. Finish one and it shows up here.
        </p>
      ) : (
        months.map((month) => (
          <section key={month.key} aria-labelledby={`month-${month.key}`} className="mt-7">
            <SectionLabel id={`month-${month.key}`}>{month.label}</SectionLabel>
            <ul className="flex flex-col">
              {month.days.map((day) => {
                const href = `/history/day/${day.dayKey}`;
                const date = new Date(day.startedAt);
                const openLabel =
                  day.workoutCount > 1
                    ? `Open ${day.workoutCount} workouts on ${formatLongDate(day.startedAt)}`
                    : `Open workout on ${formatLongDate(day.startedAt)}`;
                return (
                  <li
                    key={day.dayKey}
                    className="flex min-h-18 items-center gap-3 border-b border-line py-2.5"
                  >
                    <Link
                      href={href}
                      aria-label={openLabel}
                      className="flex w-12 shrink-0 flex-col items-center rounded-lg hover:bg-fill-2"
                      suppressHydrationWarning
                    >
                      <span className="text-xs font-semibold tracking-[0.06em] text-subtle uppercase">
                        {date.toLocaleDateString(undefined, { weekday: "short" })}
                      </span>
                      <span className="font-mono text-day font-medium tracking-[-0.03em]">
                        {date.getDate()}
                      </span>
                    </Link>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="line-clamp-2 text-base font-medium">
                        {day.exercises.length === 0
                          ? "No sets"
                          : day.exercises.map((exercise, index) => (
                              <span key={exercise.exerciseId}>
                                {index > 0 ? ", " : null}
                                <Link
                                  href={`/exercises/${exercise.exerciseId}`}
                                  className="hover:underline"
                                >
                                  {exercise.name}
                                </Link>
                              </span>
                            ))}
                      </span>
                      <Link href={href} className="text-sm text-pretty text-muted hover:underline">
                        {formatHistoryDayMeta(day, unit)}
                      </Link>
                    </span>
                    <Link
                      href={href}
                      aria-label={openLabel}
                      className="flex size-11 shrink-0 items-center justify-center rounded-full text-subtle hover:bg-fill-2"
                    >
                      <ChevronRightIcon className="size-5" strokeWidth={1.8} />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}

      {view === "list" && status === "CanLoadMore" ? (
        <Button variant="secondary" className="mt-6 w-full" onClick={() => loadMore(15)}>
          Load more
        </Button>
      ) : null}
      {view === "list" && status === "LoadingMore" ? (
        <p className="mt-6 text-center text-sm text-muted">Loading more…</p>
      ) : null}
    </div>
  );
}
