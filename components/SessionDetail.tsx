"use client";

import { useOfflineLog } from "@/components/OfflineSync";
import { PageHeader } from "@/components/PageHeader";
import { DayDetail } from "@/components/DayDetail";
import { Toast, type ToastMessage } from "@/components/Toast";
import { useBrowserTimeZone } from "@/components/useBrowserTimeZone";
import { useConnectivity } from "@/components/useConnectivity";
import { ExerciseRow } from "@/components/workout/ExerciseRow";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { exerciseLink } from "@/lib/exerciseLink";
import { formatLongDate, formatTimeOfDay, pluralize } from "@/lib/format";
import { groupSets } from "@/lib/groupSets";
import { packSupersetOrder, supersetBlocks } from "@/convex/lib/superset";
import { calendarDayKey } from "@/lib/historyDays";
import { mergeVisibleSets } from "@/lib/offline/outbox";
import { takeToast } from "@/lib/pendingToast";
import { useQuery } from "convex/react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type Toasted = ToastMessage & { id: number };

/**
 * Bookmarks and exercise-history links still use a session id.
 * A finished workout opens the combined day. An in-progress workout stays
 * on its own page until it is finished.
 */
export function SessionDetail({ sessionId }: { sessionId: string }) {
  const session = useQuery(api.sessions.get, { sessionId });
  const timeZone = useBrowserTimeZone();
  const { offline } = useConnectivity();

  if (session === undefined || (session?.status === "completed" && !timeZone)) {
    return (
      <div className="px-5 pt-3">
        <PageHeader backHref="/history" backLabel="Back to history" title="Workout" />
        <p className="mt-8 text-base text-muted">
          {offline ? "You're offline. This workout will load when you reconnect." : "Loading workout…"}
        </p>
      </div>
    );
  }

  if (session === null) {
    return (
      <div className="px-5 pt-3">
        <PageHeader backHref="/history" backLabel="Back to history" title="Workout not found" />
        <p className="mt-3 text-base leading-normal text-muted">
          That session is not in your history.
        </p>
      </div>
    );
  }

  if (session.status === "completed" && timeZone) {
    return <DayDetail dayKey={calendarDayKey(session.startedAt, timeZone)} />;
  }

  return <OpenSessionDetail session={session} />;
}

function OpenSessionDetail({
  session,
}: {
  session: {
    _id: Id<"sessions">;
    startedAt: number;
    note: string | null;
    exercises: Array<{ exerciseId: string; supersetId: string | null }>;
    sets: Array<{
      _id: string;
      exerciseId: string;
      exerciseName: string;
      reps: number | null;
      weightLb: number;
      durationSec: number | null;
      distanceM: number | null;
      rpe: number | null;
      loggedAt: number;
      clientId: string | null;
    }>;
  };
}) {
  const log = useOfflineLog();
  const [toast, setToast] = useState<Toasted | null>(null);
  const visibleSets = useMemo(
    () => mergeVisibleSets(session.sets, log.outbox, { kind: "session", sessionId: session._id }),
    [log.outbox, session._id, session.sets],
  );
  const groups = useMemo(() => {
    const performed = groupSets(visibleSets);
    const supersetByExercise = new Map(
      session.exercises.map((exercise) => [exercise.exerciseId, exercise.supersetId]),
    );
    return packSupersetOrder(
      performed.map((group) => ({
        ...group,
        supersetId: supersetByExercise.get(group.exerciseId) ?? null,
      })),
    );
  }, [session.exercises, visibleSets]);

  useEffect(() => {
    log.reconcile(session.sets);
  }, [log, session.sets]);

  useEffect(() => {
    const pending = takeToast();
    if (pending) {
      setToast({ id: Date.now(), tone: "info", message: pending });
    }
  }, []);

  const meta = [
    formatTimeOfDay(session.startedAt),
    "In progress",
    pluralize(groups.length, "exercise"),
    pluralize(visibleSets.length, "set"),
  ].join(" · ");

  return (
    <div className="px-5 pt-3 pb-[calc(32px+env(safe-area-inset-bottom))]">
      <PageHeader
        backHref="/history"
        backLabel="Back to history"
        title={<span suppressHydrationWarning>{formatLongDate(session.startedAt)}</span>}
      >
        <p className="mt-1.5 text-base text-muted" suppressHydrationWarning>
          {meta}
        </p>
        {session.note ? <p className="mt-3 text-base leading-normal text-muted">{session.note}</p> : null}
      </PageHeader>

      <Link
        href="/"
        className="mt-5 inline-flex min-h-11 items-center rounded-full bg-inverse px-5 text-base font-semibold text-inverse-ink"
      >
        Continue workout
      </Link>

      {groups.length === 0 ? (
        <p className="mt-8 text-base text-muted">No sets were logged.</p>
      ) : (
        <ul aria-label="Exercises" className="mt-5 flex flex-col border-t border-line">
          {supersetBlocks(groups).map((block) => (
            <li
              key={block.items.map((item) => item.exerciseId).join(":")}
              className={block.supersetId ? "border-l-2 border-foreground pl-3" : undefined}
            >
              {block.supersetId ? (
                <p className="pt-3 text-xs font-medium tracking-[0.06em] text-subtle uppercase">
                  Superset
                </p>
              ) : null}
              <ul>
                {block.items.map((group) => (
                  <ExerciseRow
                    key={group.exerciseId}
                    name={group.name}
                    sets={group.sets}
                    exerciseHref={exerciseLink(group.exerciseId, `/history/${session._id}`) ?? undefined}
                  />
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}

      <Toast
        key={toast ? `${toast.id}-${toast.message}` : "none"}
        toast={toast}
        raised={false}
        onDismiss={() => setToast(null)}
      />
    </div>
  );
}
