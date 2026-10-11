"use client";

import { Button } from "@/components/Button";
import { TopActions } from "@/components/TopActions";
import { Composer } from "@/components/workout/Composer";
import { ExerciseRow } from "@/components/workout/ExerciseRow";
import { useExerciseRest } from "@/components/useExerciseRest";
import { RestTimer } from "@/components/workout/RestTimer";
import { useWakeLock } from "@/components/workout/useWakeLock";
import { formatElapsed, formatShortDate, pluralize } from "@/lib/format";
import type { SetLine } from "@/lib/groupSets";
import { ComponentProps, ReactNode, useEffect, useState } from "react";

type Group = { exerciseId: string; name: string; sets: SetLine[] };

function ElapsedClock({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return <span suppressHydrationWarning>{formatElapsed(now - startedAt)}</span>;
}

export function ActiveWorkout({
  startedAt,
  groups,
  setCount,
  newestSetId,
  loadingSets,
  repeatingId,
  removingId,
  ending,
  note,
  onRepeat,
  onEditSet,
  onRemoveSet,
  onFinish,
  onDiscard,
  idleNote,
  emptyMessage,
  exerciseCount,
  planList,
  composer,
  restHold = false,
  restExerciseName,
  onLinkFree,
}: {
  startedAt: number;
  groups: Group[];
  setCount: number;
  newestSetId?: string;
  loadingSets: boolean;
  repeatingId: string | null;
  removingId: string | null;
  ending: boolean;
  note?: string | null;
  onRepeat: (group: Group) => void;
  onEditSet: (set: SetLine) => void;
  onRemoveSet: (setId: string) => void;
  onFinish: () => void;
  onDiscard: () => void;
  idleNote?: string;
  emptyMessage?: string;
  exerciseCount?: number;
  planList?: ReactNode;
  composer: ComponentProps<typeof Composer>;
  /** True while a superset round is still missing a member. */
  restHold?: boolean;
  /** Whose rest to run. Undefined follows the exercise that was just logged. */
  restExerciseName?: string | null;
  onLinkFree?: (index: number) => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const empty = !loadingSets && setCount === 0;
  useWakeLock();
  let newestName: string | null = null;
  let newestAt = -1;
  for (const group of groups) {
    for (const set of group.sets) {
      if (set.loggedAt >= newestAt) {
        newestAt = set.loggedAt;
        newestName = group.name;
      }
    }
  }
  const restName = restExerciseName !== undefined ? restExerciseName : setCount > 0 ? newestName : null;
  const exerciseRest = useExerciseRest(restName);

  return (
    <>
      <div className="px-5 pt-3 pb-[calc(8.5rem+env(safe-area-inset-bottom))]">
        <header className="border-b border-line pb-4">
          <div className="flex items-center justify-between gap-3">
            <p className="min-w-0 text-xs leading-snug" suppressHydrationWarning>
              <span className="font-medium tracking-[0.06em] text-subtle uppercase">In progress</span>
              <span className="mt-0.5 block text-subtle">{formatShortDate(startedAt)}</span>
            </p>
            <TopActions />
          </div>
          <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-2">
            <div className="flex flex-col gap-0.5">
              <p className="font-mono text-timer leading-[1.15] font-medium tracking-[-0.04em]">
                <span className="sr-only">Elapsed </span>
                <ElapsedClock startedAt={startedAt} />
              </p>
              <p className="text-sm text-muted">
                {pluralize(exerciseCount ?? groups.length, "exercise")} · {pluralize(setCount, "set")}
                {idleNote ? <span className="text-subtle"> · {idleNote}</span> : null}
              </p>
              {note ? <p className="mt-1 text-sm text-muted">{note}</p> : null}
            </div>
            <div className="flex items-center gap-2">
              <RestTimer
                setCount={setCount}
                loading={loadingSets}
                hold={restHold}
                restLabel={!restHold && setCount > 0 ? restName : null}
                exerciseRestSeconds={setCount > 0 ? exerciseRest.restSeconds : null}
                onExerciseRest={restName ? (seconds) => void exerciseRest.save(seconds) : undefined}
              />
              {empty ? (
                <Button variant="secondary" onClick={onDiscard} disabled={ending}>
                  {ending ? "Discarding…" : "Discard"}
                </Button>
              ) : (
                <Button variant="outline" onClick={onFinish} disabled={ending || loadingSets}>
                  Finish
                </Button>
              )}
            </div>
          </div>
        </header>

        {planList}
        {loadingSets ? (
          <p className="py-10 text-center text-base text-muted">Loading sets…</p>
        ) : planList ? null : empty ? (
          <p className="mx-auto max-w-[21rem] py-12 text-center text-base leading-normal text-pretty text-muted">
            {emptyMessage ?? "No sets yet. Tap the mic and say one, or type it below."}
          </p>
        ) : (
          <ul aria-label="Sets in this workout" className="flex flex-col">
            {groups.map((group, index) => (
              <ExerciseRow
                key={group.exerciseId}
                name={group.name}
                sets={group.sets}
                newestSetId={newestSetId}
                expanded={expandedId === group.exerciseId}
                onToggle={() =>
                  setExpandedId((current) => (current === group.exerciseId ? null : group.exerciseId))
                }
                onRepeat={() => onRepeat(group)}
                repeating={repeatingId === group.exerciseId}
                onEditSet={onEditSet}
                onRemoveSet={onRemoveSet}
                removingId={removingId}
                footer={
                  onLinkFree && index < groups.length - 1 ? (
                    <button
                      type="button"
                      onClick={() => onLinkFree(index)}
                      className="mb-2 ml-14 min-h-11 text-sm font-medium text-muted"
                    >
                      Superset with next
                    </button>
                  ) : null
                }
              />
            ))}
          </ul>
        )}
      </div>
      <Composer {...composer} />
    </>
  );
}
