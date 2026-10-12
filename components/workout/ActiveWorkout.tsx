"use client";

import { Button } from "@/components/Button";
import { TopActions } from "@/components/TopActions";
import { Composer } from "@/components/workout/Composer";
import { ExerciseRow } from "@/components/workout/ExerciseRow";
import { useExerciseRest } from "@/components/useExerciseRest";
import { RestTimer } from "@/components/workout/RestTimer";
import { useWakeLock } from "@/components/workout/useWakeLock";
import { exerciseLink } from "@/lib/exerciseLink";
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
  ending,
  note,
  onRepeat,
  onEditSet,
  onFinish,
  onDiscard,
  idleNote,
  emptyMessage,
  exerciseCount,
  planList,
  composer,
  editingPlan = false,
  onEditingPlan,
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
  ending: boolean;
  note?: string | null;
  onRepeat: (group: Group) => void;
  onEditSet: (set: SetLine) => void;
  onFinish: () => void;
  onDiscard: () => void;
  idleNote?: string;
  emptyMessage?: string;
  exerciseCount?: number;
  planList?: ReactNode;
  composer: ComponentProps<typeof Composer>;
  editingPlan?: boolean;
  onEditingPlan?: (editing: boolean) => void;
  /** True while a superset round is still missing a member. */
  restHold?: boolean;
  /** Whose rest to run. Undefined follows the exercise that was just logged. */
  restExerciseName?: string | null;
  onLinkFree?: (index: number) => void;
}) {
  const empty = !loadingSets && setCount === 0;
  const canEditPlan = Boolean(onEditingPlan) && (planList !== undefined || groups.length > 0);
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
      <div className="px-5 pt-3 pb-[calc(16rem+env(safe-area-inset-bottom))]">
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
              {canEditPlan ? (
                <button
                  type="button"
                  onClick={() => onEditingPlan?.(!editingPlan)}
                  className="min-h-11 rounded-full px-3 text-base font-semibold hover:bg-fill-2"
                >
                  {editingPlan ? "Done" : "Edit plan"}
                </button>
              ) : null}
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
                exerciseHref={exerciseLink(group.exerciseId, "/") ?? undefined}
                onRepeat={() => onRepeat(group)}
                repeating={repeatingId === group.exerciseId}
                onEditSet={onEditSet}
                footer={
                  editingPlan && onLinkFree && index < groups.length - 1 ? (
                    <button
                      type="button"
                      onClick={() => onLinkFree(index)}
                      className="mb-2 ml-14 min-h-11 text-base font-medium text-muted"
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
      <div className="fixed inset-x-0 bottom-0 z-20">
        <RestTimer
          setCount={setCount}
          loading={loadingSets}
          hold={restHold}
          workoutKey={String(startedAt)}
          restLabel={!restHold && setCount > 0 ? restName : null}
          exerciseRestSeconds={setCount > 0 ? exerciseRest.restSeconds : null}
          onExerciseRest={restName ? (seconds) => void exerciseRest.save(seconds) : undefined}
        />
        <Composer {...composer} />
      </div>
    </>
  );
}
