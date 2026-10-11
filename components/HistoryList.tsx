"use client";

import { Button } from "@/components/Button";
import { ChevronRightIcon } from "@/components/icons";
import { PageHeader, SectionLabel } from "@/components/PageHeader";
import { OpenWorkoutSheet } from "@/components/routines/OpenWorkoutSheet";
import { SaveRoutineSheet } from "@/components/routines/SaveRoutineSheet";
import { useBeginWorkout } from "@/components/routines/useBeginWorkout";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { readableError } from "@/lib/errors";
import { formatMonthHeading, formatWorkoutLength, monthKey, pluralize, suggestRoutineName } from "@/lib/format";
import { groupByLocalDay } from "@/lib/historyDays";
import { useMutation, usePaginatedQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

export function HistoryList() {
  const router = useRouter();
  const { results, status, loadMore } = usePaginatedQuery(
    api.sessions.listHistory,
    {},
    { initialNumItems: 15 },
  );
  const createFromSessions = useMutation(api.routines.createFromSessions);
  const begin = useBeginWorkout();
  const [saving, setSaving] = useState<{
    sessionIds: string[];
    name: string;
    summary: string;
  } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savePending, setSavePending] = useState(false);

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
      <Link
        href="/history/log"
        className="mt-4 inline-flex min-h-11 items-center rounded-full border border-line bg-surface px-4 text-base font-medium hover:bg-fill-2"
      >
        Log a past workout
      </Link>

      {status === "LoadingFirstPage" ? (
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
              {groupByLocalDay(month.sessions).map((day) => (
                <li key={day.key} className="flex flex-col">
                  {day.items.length > 1 ? (
                    <div className="flex flex-wrap items-center gap-1 pt-3">
                      <p className="mr-auto text-sm text-muted">
                        {pluralize(day.items.length, "workout")} this day
                      </p>
                      <Button
                        variant="ghost"
                        disabled={begin.pending}
                        onClick={() => void begin.repeatWorkouts(day.items.map((session) => session._id))}
                      >
                        Repeat this day
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => {
                          const names = day.items.flatMap((session) =>
                            session.exercises.map((exercise) => exercise.name),
                          );
                          setSaveError(null);
                          setSaving({
                            sessionIds: day.items.map((session) => session._id),
                            name: suggestRoutineName(day.items[0]?.startedAt ?? Date.now()),
                            summary: uniqueNames(names).join(", ") || "These workouts",
                          });
                        }}
                      >
                        Save as routine
                      </Button>
                    </div>
                  ) : null}
                  <ul className="flex flex-col">
              {day.items.map((session) => {
                const date = new Date(session.startedAt);
                const setCount = session.exercises.reduce(
                  (sum, exercise) => sum + exercise.setCount,
                  0,
                );
                const length = formatWorkoutLength(session.startedAt, session.completedAt);
                return (
                  <li
                    key={session._id}
                    className="flex min-h-18 items-center gap-4 border-b border-line py-2.5"
                  >
                    <Link
                      href={`/history/${session._id}`}
                      aria-label={`Open workout on ${date.toLocaleDateString(undefined, { month: "long", day: "numeric" })}`}
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
                      <span className="truncate text-base font-medium">
                        {session.exercises.length === 0
                          ? "No sets"
                          : session.exercises.map((exercise, index) => (
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
                      <Link href={`/history/${session._id}`} className="text-sm text-muted hover:underline">
                        {pluralize(session.exercises.length, "exercise")} · {pluralize(setCount, "set")}
                        {length ? ` · ${length}` : ""}
                      </Link>
                    </span>
                    <Link
                      href={`/history/${session._id}`}
                      aria-label="Open workout"
                      className="flex size-11 shrink-0 items-center justify-center rounded-full text-subtle hover:bg-fill-2"
                    >
                      <ChevronRightIcon className="size-5" strokeWidth={1.8} />
                    </Link>
                  </li>
                );
              })}
                  </ul>
                </li>
              ))}
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

      {begin.error ? (
        <p role="alert" className="mt-4 text-sm text-danger">
          {begin.error}
        </p>
      ) : null}

      <SaveRoutineSheet
        key={saving?.sessionIds.join("-") ?? "save-routine"}
        open={saving !== null}
        defaultName={saving?.name ?? ""}
        summary={saving ? `${saving.summary}.` : ""}
        pending={savePending}
        error={saveError}
        onCancel={() => setSaving(null)}
        onSave={(name) => void saveRoutine(name)}
      />
      <OpenWorkoutSheet
        open={begin.promptOpen}
        onClose={begin.closePrompt}
        onContinue={begin.continueOpen}
      />
    </div>
  );

  async function saveRoutine(name: string) {
    if (!saving) {
      return;
    }
    setSavePending(true);
    setSaveError(null);
    try {
      const routineId = await createFromSessions({
        name,
        sessionIds: saving.sessionIds as Id<"sessions">[],
      });
      router.push(`/routines/${routineId}`);
    } catch (caught) {
      setSaveError(readableError(caught));
      setSavePending(false);
    }
  }
}

function uniqueNames(names: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const name of names) {
    const key = name.toLocaleLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(name);
  }
  return unique;
}
