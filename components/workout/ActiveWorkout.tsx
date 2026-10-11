"use client";

import { Button } from "@/components/Button";
import { TopActions } from "@/components/TopActions";
import { Composer } from "@/components/workout/Composer";
import { ExerciseRow } from "@/components/workout/ExerciseRow";
import { formatElapsed, formatShortDate, pluralize } from "@/lib/format";
import type { SetLine } from "@/lib/groupSets";
import { ComponentProps, useEffect, useState } from "react";

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
  onRepeat,
  onRemoveSet,
  onFinish,
  onDiscard,
  idleNote,
  composer,
}: {
  startedAt: number;
  groups: Group[];
  setCount: number;
  newestSetId?: string;
  loadingSets: boolean;
  repeatingId: string | null;
  removingId: string | null;
  ending: boolean;
  onRepeat: (group: Group) => void;
  onRemoveSet: (setId: string) => void;
  onFinish: () => void;
  onDiscard: () => void;
  idleNote?: string;
  composer: ComponentProps<typeof Composer>;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const empty = !loadingSets && setCount === 0;

  return (
    <>
      <div className="px-5 pt-3 pb-[calc(112px+env(safe-area-inset-bottom))]">
        <header className="border-b border-line pb-4">
          <div className="flex h-11 items-center justify-between">
            <p className="text-[11px] font-medium tracking-[0.1em] text-subtle uppercase" suppressHydrationWarning>
              In progress · {formatShortDate(startedAt)}
            </p>
            <TopActions />
          </div>
          <div className="flex items-end justify-between gap-3">
            <div className="flex flex-col gap-0.5">
              <p className="font-mono text-[40px] leading-[1.15] font-medium tracking-[-0.04em]">
                <span className="sr-only">Elapsed </span>
                <ElapsedClock startedAt={startedAt} />
              </p>
              <p className="text-sm text-muted">
                {pluralize(groups.length, "exercise")} · {pluralize(setCount, "set")}
                {idleNote ? <span className="text-subtle"> · {idleNote}</span> : null}
              </p>
            </div>
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
        </header>

        {loadingSets ? (
          <p className="py-10 text-center text-[15px] text-muted">Loading sets…</p>
        ) : empty ? (
          <p className="mx-auto max-w-[280px] py-12 text-center text-[15px] leading-normal text-pretty text-muted">
            No sets yet. Tap the mic and say one, or type it below.
          </p>
        ) : (
          <ul aria-label="Sets in this workout" className="flex flex-col">
            {groups.map((group) => (
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
                onRemoveSet={onRemoveSet}
                removingId={removingId}
              />
            ))}
          </ul>
        )}
      </div>
      <Composer {...composer} />
    </>
  );
}
