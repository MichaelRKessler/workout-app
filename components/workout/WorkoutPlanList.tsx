"use client";

import { SetTypeTag } from "@/components/SetTypePicker";
import { useProgression } from "@/components/useProgression";
import { ExerciseTile } from "@/components/workout/ExerciseRow";
import { usePreviousExercise } from "@/components/workout/usePreviousExercise";
import { useWeightUnit } from "@/components/WeightUnit";
import { PlusIcon, Spinner } from "@/components/icons";
import type { Id } from "@/convex/_generated/dataModel";
import { formatRoutineTarget, formatSetShort } from "@/lib/format";
import type { SetLine } from "@/lib/groupSets";
import { prefillValues, setFromPrefill } from "@/lib/prefill";
import { formatSuggestion, suggestionAlreadyShown, suggestNext } from "@/lib/suggestion";
import { planProgress, routinePrefillFromTarget } from "@/convex/lib/routinePlan";
import { cleanSupersetId, supersetBlocks, supersetNextId } from "@/convex/lib/superset";

export type PlanRow = {
  exerciseId: string;
  name: string;
  targetSets: number | null;
  targetReps: number | null;
  targetWeightLb: number | null;
  targetDurationSec: number | null;
  targetDistanceM: number | null;
  targetCalories?: number | null;
  skipped: boolean;
  sets: SetLine[];
  supersetId: string | null;
};

export function WorkoutPlanList({
  name,
  rows,
  loggingId,
  setsLoading = false,
  offline,
  sessionSets,
  excludeSessionId,
  onLog,
  onRepeat,
  repeatingId,
  onSkip,
  onMove,
  onLink,
  onUnlink,
  onEditSet,
  onRemoveSet,
  removingId,
}: {
  name: string | null;
  rows: PlanRow[];
  loggingId: string | null;
  setsLoading?: boolean;
  offline: boolean;
  sessionSets: SetLine[];
  excludeSessionId?: Id<"sessions">;
  onLog: (exerciseId: string, name: string, set: ReturnType<typeof setFromPrefill>) => void;
  onRepeat: (row: PlanRow) => void;
  repeatingId: string | null;
  onSkip: (exerciseId: string, skipped: boolean) => void;
  onMove: (index: number, direction: -1 | 1) => void;
  onLink: (index: number) => void;
  onUnlink: (index: number) => void;
  onEditSet: (set: SetLine) => void;
  onRemoveSet: (setId: string) => void;
  removingId: string | null;
}) {
  const nextId = supersetNextId(
    rows.map((row) => ({
      exerciseId: row.exerciseId,
      skipped: row.skipped,
      setCount: row.sets.length,
      targetSets: row.targetSets,
      supersetId: row.supersetId,
    })),
  );
  const blocks = supersetBlocks(rows);
  return (
    <section aria-label={name ? `${name} plan` : "Workout plan"} className="mt-2">
      <h2 className="pt-4 text-xs font-medium tracking-[0.06em] text-subtle uppercase">
        {name ? `Plan · ${name}` : "Plan"}
      </h2>
      <ul className="flex flex-col">
        {blocks.map((block) => (
          <li
            key={block.items.map((item) => item.exerciseId).join(":")}
            className={block.supersetId ? "my-1 border-l-2 border-foreground pl-2" : undefined}
          >
            {block.supersetId ? (
              <p className="pt-3 text-xs font-medium tracking-[0.06em] text-subtle uppercase">
                Superset
              </p>
            ) : null}
            <ul>
              {block.items.map((row) => {
                const index = rows.findIndex((item) => item.exerciseId === row.exerciseId);
                const next = rows[index + 1];
                const linkedWithNext =
                  cleanSupersetId(row.supersetId) !== undefined &&
                  cleanSupersetId(row.supersetId) === cleanSupersetId(next?.supersetId);
                return (
                  <PlanRowView
                    key={row.exerciseId}
                    row={row}
                    index={index}
                    count={rows.length}
                    isNext={row.exerciseId === nextId}
                    canLink={index >= 0 && index < rows.length - 1 && !linkedWithNext}
                    canUnlink={Boolean(cleanSupersetId(row.supersetId))}
                    logging={loggingId === row.exerciseId}
                    setsLoading={setsLoading}
                    offline={offline}
                    sessionSets={sessionSets}
                    excludeSessionId={excludeSessionId}
                    repeating={repeatingId === row.exerciseId}
                    removingId={removingId}
                    onLog={onLog}
                    onRepeat={() => onRepeat(row)}
                    onSkip={onSkip}
                    onMove={onMove}
                    onLink={onLink}
                    onUnlink={onUnlink}
                    onEditSet={onEditSet}
                    onRemoveSet={onRemoveSet}
                  />
                );
              })}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}

function PlanRowView({
  row,
  index,
  count,
  isNext,
  canLink,
  canUnlink,
  logging,
  setsLoading,
  offline,
  sessionSets,
  excludeSessionId,
  repeating,
  removingId,
  onLog,
  onRepeat,
  onSkip,
  onMove,
  onLink,
  onUnlink,
  onEditSet,
  onRemoveSet,
}: {
  row: PlanRow;
  index: number;
  count: number;
  isNext: boolean;
  canLink: boolean;
  canUnlink: boolean;
  logging: boolean;
  setsLoading: boolean;
  offline: boolean;
  sessionSets: SetLine[];
  excludeSessionId?: Id<"sessions">;
  repeating: boolean;
  removingId: string | null;
  onLog: (exerciseId: string, name: string, set: ReturnType<typeof setFromPrefill>) => void;
  onRepeat: () => void;
  onSkip: (exerciseId: string, skipped: boolean) => void;
  onMove: (index: number, direction: -1 | 1) => void;
  onLink: (index: number) => void;
  onUnlink: (index: number) => void;
  onEditSet: (set: SetLine) => void;
  onRemoveSet: (setId: string) => void;
}) {
  const unit = useWeightUnit();
  const progress = planProgress(row.sets.length, row.targetSets, row.skipped);
  const target = formatRoutineTarget(row, unit);
  const detail = [target, progress.label].filter((part) => part !== null).join(" · ");

  return (
    <li className={`border-b border-line-soft py-3 ${row.skipped ? "opacity-60" : ""}`}>
      <div className="flex items-center gap-3">
        <PlanMark done={progress.done} skipped={row.skipped} />
        <ExerciseTile name={row.name} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-base font-semibold tracking-[-0.01em]">{row.name}</span>
            {isNext ? (
              <span className="shrink-0 rounded-full bg-fill px-2 py-0.5 text-xs font-medium text-muted">
                Next
              </span>
            ) : null}
          </span>
          {detail ? <span className="text-sm text-muted">{detail}</span> : null}
          {row.sets.length > 0 ? (
            <span className="mt-0.5 flex flex-wrap gap-x-3 font-mono text-sm text-muted">
              {row.sets.map((set) => (
                <button
                  key={set._id}
                  type="button"
                  onClick={() => onEditSet(set)}
                  className="min-h-11 text-left"
                >
                  {formatSetShort(set, unit)}
                  <SetTypeTag setType={set.setType} />
                  {set.pending ? <span className="ml-1 font-sans text-xs">· pending</span> : null}
                </button>
              ))}
            </span>
          ) : null}
        </span>
        {row.sets.length === 0 ? (
          <PlanLogButton
            row={row}
            logging={logging}
            setsLoading={setsLoading}
            offline={offline}
            sessionSets={sessionSets}
            excludeSessionId={excludeSessionId}
            onLog={onLog}
          />
        ) : (
          <button
            type="button"
            onClick={onRepeat}
            disabled={repeating}
            aria-label={`Log another set of ${row.name}`}
            className="flex size-11 shrink-0 items-center justify-center rounded-full border border-line bg-surface hover:bg-fill-2 disabled:opacity-60"
          >
            {repeating ? <Spinner className="size-4" /> : <PlusIcon className="size-5" />}
          </button>
        )}
      </div>
      <div className="mt-1 flex flex-wrap gap-1 pl-8">
        <TextAction
          label={`Move ${row.name} up`}
          disabled={index === 0}
          onClick={() => onMove(index, -1)}
        >
          Up
        </TextAction>
        <TextAction
          label={`Move ${row.name} down`}
          disabled={index === count - 1}
          onClick={() => onMove(index, 1)}
        >
          Down
        </TextAction>
        <TextAction
          label={row.skipped ? `Put ${row.name} back on the plan` : `Skip ${row.name}`}
          onClick={() => onSkip(row.exerciseId, !row.skipped)}
        >
          {row.skipped ? "Undo skip" : "Skip"}
        </TextAction>
        {canLink ? (
          <TextAction label={`Superset ${row.name} with the next exercise`} onClick={() => onLink(index)}>
            Superset
          </TextAction>
        ) : null}
        {canUnlink ? (
          <TextAction label={`Ungroup ${row.name}`} onClick={() => onUnlink(index)}>
            Ungroup
          </TextAction>
        ) : null}
        {row.sets.length > 0 ? (
          <TextAction
            label={`Remove the last set of ${row.name}`}
            disabled={removingId !== null}
            onClick={() => {
              const last = row.sets[row.sets.length - 1];
              if (last) {
                onRemoveSet(last._id);
              }
            }}
          >
            {removingId && row.sets.some((set) => set._id === removingId) ? "Removing…" : "Remove set"}
          </TextAction>
        ) : null}
      </div>
    </li>
  );
}

function PlanLogButton({
  row,
  logging,
  setsLoading,
  offline,
  sessionSets,
  excludeSessionId,
  onLog,
}: {
  row: PlanRow;
  logging: boolean;
  setsLoading: boolean;
  offline: boolean;
  sessionSets: SetLine[];
  excludeSessionId?: Id<"sessions">;
  onLog: (exerciseId: string, name: string, set: ReturnType<typeof setFromPrefill>) => void;
}) {
  const unit = useWeightUnit();
  const progression = useProgression();
  const previous = usePreviousExercise(row.name, excludeSessionId);
  const ready = (offline || !previous.loading) && !setsLoading;
  const values = prefillValues(
    row.name,
    sessionSets,
    previous.sets,
    routinePrefillFromTarget(row),
  );
  const set = setFromPrefill(values);
  const suggestion =
    ready && previous.sets
      ? suggestNext(previous.sets, {
          enabled: progression.enabled,
          incrementLb: progression.incrementLb,
          routine: { targetSets: row.targetSets, targetReps: row.targetReps },
        })
      : null;
  const suggestionLabel =
    suggestion && set && !suggestionAlreadyShown(suggestion, { kind: values.kind, reps: values.reps, weightLb: set.weightLb })
      ? formatSuggestion(suggestion, unit)
      : null;

  function logSuggested() {
    if (!set || !suggestion) {
      return;
    }
    if (suggestion.kind === "weight") {
      onLog(row.exerciseId, row.name, { ...set, weightLb: suggestion.weightLb, setType: "working" });
      return;
    }
    onLog(row.exerciseId, row.name, { ...set, reps: suggestion.reps, setType: "working" });
  }

  return (
    <span className="flex shrink-0 flex-col items-end gap-1">
      {suggestionLabel ? (
        <button
          type="button"
          disabled={logging}
          onClick={logSuggested}
          className="min-h-11 max-w-40 rounded-full border border-line px-3 text-left text-sm font-medium disabled:opacity-60"
        >
          {suggestionLabel}
        </button>
      ) : null}
      <button
        type="button"
        disabled={!ready || logging || set === null}
        onClick={() => {
          if (set) {
            onLog(row.exerciseId, row.name, set);
          }
        }}
        className="min-h-11 shrink-0 rounded-full bg-inverse px-4 text-base font-semibold text-inverse-ink disabled:opacity-60"
      >
        {logging ? "Logging…" : ready ? "Log set" : "…"}
      </button>
    </span>
  );
}

function PlanMark({ done, skipped }: { done: boolean; skipped: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold ${
        done ? "border-foreground bg-foreground text-background" : "border-line text-transparent"
      }`}
    >
      {skipped ? "–" : done ? "✓" : ""}
    </span>
  );
}

function TextAction({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="min-h-11 rounded-full px-3 text-sm font-medium text-muted hover:bg-fill-2 disabled:opacity-40"
    >
      {children}
    </button>
  );
}
