"use client";

import { PageHeader } from "@/components/PageHeader";
import { ExerciseRow } from "@/components/workout/ExerciseRow";
import { api } from "@/convex/_generated/api";
import {
  formatDuration,
  formatLongDate,
  formatTimeOfDay,
  pluralize,
} from "@/lib/format";
import { groupSets } from "@/lib/groupSets";
import { useQuery } from "convex/react";
import Link from "next/link";
import { useMemo } from "react";

export function SessionDetail({ sessionId }: { sessionId: string }) {
  const session = useQuery(api.sessions.get, { sessionId });
  const groups = useMemo(() => groupSets(session?.sets ?? []), [session?.sets]);

  if (session === undefined) {
    return (
      <div className="px-5 pt-3">
        <PageHeader backHref="/history" backLabel="Back to history" title="Workout" />
        <p className="mt-8 text-[15px] text-muted">Loading workout…</p>
      </div>
    );
  }

  if (session === null) {
    return (
      <div className="px-5 pt-3">
        <PageHeader backHref="/history" backLabel="Back to history" title="Workout not found" />
        <p className="mt-3 text-[15px] leading-normal text-muted">
          That session is not in your history.
        </p>
      </div>
    );
  }

  const meta = [
    formatTimeOfDay(session.startedAt),
    session.completedAt ? formatDuration(session.completedAt - session.startedAt) : "In progress",
    pluralize(groups.length, "exercise"),
    pluralize(session.sets.length, "set"),
  ].join(" · ");

  return (
    <div className="px-5 pt-3 pb-[calc(32px+env(safe-area-inset-bottom))]">
      <PageHeader
        backHref="/history"
        backLabel="Back to history"
        title={<span suppressHydrationWarning>{formatLongDate(session.startedAt)}</span>}
      >
        <p className="mt-1.5 text-[15px] text-muted" suppressHydrationWarning>
          {meta}
        </p>
      </PageHeader>

      {session.status === "open" ? (
        <Link
          href="/"
          className="mt-5 inline-flex min-h-11 items-center rounded-full bg-inverse px-5 text-[15px] font-semibold text-inverse-ink"
        >
          Continue workout
        </Link>
      ) : null}

      {groups.length === 0 ? (
        <p className="mt-8 text-[15px] text-muted">No sets were logged.</p>
      ) : (
        <ul aria-label="Exercises" className="mt-5 flex flex-col border-t border-line">
          {groups.map((group) => (
            <ExerciseRow key={group.exerciseId} name={group.name} sets={group.sets} />
          ))}
        </ul>
      )}
    </div>
  );
}
