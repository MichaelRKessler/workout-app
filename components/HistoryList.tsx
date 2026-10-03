"use client";

import { Button } from "@/components/Button";
import { LocalTime } from "@/components/LocalTime";
import { api } from "@/convex/_generated/api";
import { usePaginatedQuery } from "convex/react";
import Link from "next/link";

export function HistoryList() {
  const { results, status, loadMore } = usePaginatedQuery(
    api.sessions.listHistory,
    {},
    { initialNumItems: 15 },
  );

  if (status === "LoadingFirstPage") {
    return <p className="text-muted">Loading history…</p>;
  }

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h1 className="text-4xl font-semibold tracking-tight">History</h1>
        <p className="mt-2 text-sm leading-6 text-muted">
          Finished workouts stay here with the sets you logged.
        </p>
      </div>

      {results.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line px-4 py-6 text-sm text-muted">
          No finished workouts yet. Log one, then tap Finish workout.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {results.map((session) => (
            <li key={session._id}>
              <Link
                href={`/history/${session._id}`}
                className="block rounded-2xl border border-line bg-panel p-4"
              >
                <p className="font-semibold">
                  <LocalTime timestamp={session.startedAt} />
                </p>
                {session.exercises.length === 0 ? (
                  <p className="mt-2 text-sm text-muted">No sets</p>
                ) : (
                  <ul className="mt-2 flex flex-col gap-1 text-sm text-muted">
                    {session.exercises.map((exercise) => (
                      <li key={exercise.exerciseId}>
                        {exercise.name} · {exercise.setCount}{" "}
                        {exercise.setCount === 1 ? "set" : "sets"}
                      </li>
                    ))}
                  </ul>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}

      {status === "CanLoadMore" ? (
        <Button variant="secondary" className="w-full" onClick={() => loadMore(15)}>
          Load more
        </Button>
      ) : null}
      {status === "LoadingMore" ? <p className="text-sm text-muted">Loading more…</p> : null}
    </section>
  );
}
