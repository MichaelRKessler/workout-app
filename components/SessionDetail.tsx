"use client";

import { LocalTime } from "@/components/LocalTime";
import { api } from "@/convex/_generated/api";
import { formatWeightLb } from "@/lib/format";
import { groupSets } from "@/lib/groupSets";
import { useQuery } from "convex/react";
import Link from "next/link";
import { useMemo } from "react";

export function SessionDetail({ sessionId }: { sessionId: string }) {
  const session = useQuery(api.sessions.get, { sessionId });
  const groups = useMemo(() => groupSets(session?.sets ?? []), [session?.sets]);

  if (session === undefined) {
    return <p className="text-muted">Loading workout…</p>;
  }

  if (session === null) {
    return (
      <section className="flex flex-col gap-4">
        <Link href="/history" className="text-sm font-semibold text-accent">
          Back to history
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">Workout not found</h1>
        <p className="text-sm leading-6 text-muted">
          That session is not in your history.
        </p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-5">
      <Link href="/history" className="text-sm font-semibold text-accent">
        Back to history
      </Link>
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">
          <LocalTime timestamp={session.startedAt} />
        </h1>
        <p className="mt-2 text-sm text-muted">
          {session.status === "open"
            ? "This workout is still in progress."
            : "Finished workout"}
          {session.completedAt ? (
            <>
              {" "}
              · saved <LocalTime timestamp={session.completedAt} />
            </>
          ) : null}
        </p>
      </div>
      {session.status === "open" ? (
        <Link
          href="/"
          className="inline-flex min-h-12 items-center justify-center rounded-xl bg-accent px-4 font-semibold text-accent-ink"
        >
          Continue logging
        </Link>
      ) : null}
      {groups.length === 0 ? (
        <p className="text-sm text-muted">No sets were logged.</p>
      ) : (
        groups.map((group) => (
          <article key={group.exerciseId} className="rounded-2xl bg-panel p-4">
            <h2 className="text-lg font-semibold">{group.name}</h2>
            <ol className="mt-3 flex flex-col gap-2 text-sm">
              {group.sets.map((set, index) => (
                <li key={set._id}>
                  Set {index + 1} · {set.reps} reps · {formatWeightLb(set.weightLb)}
                </li>
              ))}
            </ol>
          </article>
        ))
      )}
    </section>
  );
}
