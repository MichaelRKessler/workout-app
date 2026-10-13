"use client";

import { SetTypeTag } from "@/components/SetTypePicker";
import { useProgression } from "@/components/useProgression";
import { ExerciseTile } from "@/components/workout/ExerciseRow";
import { usePreviousExercise } from "@/components/workout/usePreviousExercise";
import { useWeightUnit } from "@/components/WeightUnit";
import { PlusIcon, Spinner } from "@/components/icons";
import type { Id } from "@/convex/_generated/dataModel";
import { setKind } from "@/convex/lib/measures";
import { planProgress, routinePrefillFromTarget } from "@/convex/lib/routinePlan";
import { cleanSupersetId, supersetBlocks, supersetNextId } from "@/convex/lib/superset";
import { exerciseLink } from "@/lib/exerciseLink";
import { describeSet, formatRoutineTarget, formatSetShort, pluralize } from "@/lib/format";
import type { SetLine } from "@/lib/groupSets";
import { lastTimeSpeech, planLogOffer, planLogSpeech, type LoggedPlanSet } from "@/lib/planLog";
import { readLocal, writeLocal } from "@/lib/localValue";
import { explainSuggestion, formatSuggestion, suggestionAlreadyShown, suggestNext } from "@/lib/suggestion";
import { guidedNextId, guidedProgress } from "@/lib/workoutPlan";
import Link from "next/link";
import { useEffect, useState } from "react";

const PLAN_VIEW_KEY = "workout:planView";

/** Guided shows one exercise at a time; the list shows the whole plan. Kept per device. */
function usePlanView(): ["guided" | "list", (view: "guided" | "list") => void] {
  const [view, setView] = useState<"guided" | "list">("guided");
  useEffect(() => {
    if (readLocal(PLAN_VIEW_KEY) === "list") {
      setView("list");
    }
  }, []);
  return [
    view,
    (next) => {
      setView(next);
      writeLocal(PLAN_VIEW_KEY, next);
    },
  ];
}

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
  onNeedForm,
  editing = false,
}: {
  name: string | null;
  rows: PlanRow[];
  loggingId: string | null;
  setsLoading?: boolean;
  offline: boolean;
  sessionSets: SetLine[];
  excludeSessionId?: Id<"sessions">;
  onLog: (exerciseId: string, name: string, set: LoggedPlanSet) => void;
  onRepeat: (row: PlanRow) => void;
  repeatingId: string | null;
  onSkip: (exerciseId: string, skipped: boolean) => void;
  onMove: (index: number, direction: -1 | 1) => void;
  onLink: (index: number) => void;
  onUnlink: (index: number) => void;
  onEditSet: (set: SetLine) => void;
  /** Opens the set form when there is no target and no previous set. */
  onNeedForm: (exerciseName: string) => void;
  editing?: boolean;
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
  const [view, setView] = usePlanView();
  const guidedId = guidedNextId(rows);
  const nextRow = rows.find((row) => row.exerciseId === guidedId) ?? null;
  const guided = view === "guided" && !editing && nextRow !== null;
  const heading = (
    <div className="flex items-center justify-between gap-3 pt-4">
      <h2 className="text-xs font-medium tracking-[0.06em] text-subtle uppercase">
        {name ? `Plan · ${name}` : "Plan"}
      </h2>
      {nextRow && !editing ? (
        <button
          type="button"
          onClick={() => setView(guided ? "list" : "guided")}
          className="-my-2 min-h-11 rounded-full px-3 text-sm font-medium text-muted hover:bg-fill-2"
        >
          {guided ? "Show full plan" : "One at a time"}
        </button>
      ) : null}
    </div>
  );
  if (guided && nextRow) {
    // Start from the first member of the next exercise's superset, so a partner
    // that comes earlier in the plan still shows as up next.
    const group = cleanSupersetId(nextRow.supersetId);
    const start = group
      ? rows.findIndex((row) => cleanSupersetId(row.supersetId) === group)
      : rows.indexOf(nextRow);
    const upNext = rows
      .slice(start)
      .filter(
        (row) =>
          row !== nextRow && !planProgress(row.sets.length, row.targetSets, row.skipped).done,
      )
      .map((row) => row.name);
    return (
      <section aria-label={name ? `${name} plan` : "Workout plan"} className="mt-2">
        {heading}
        <GuidedCard
          row={nextRow}
          progress={guidedProgress(rows, guidedId)}
          supersetNames={
            cleanSupersetId(nextRow.supersetId)
              ? rows
                  .filter((item) => cleanSupersetId(item.supersetId) === cleanSupersetId(nextRow.supersetId))
                  .map((item) => item.name)
              : []
          }
          upNext={upNext}
          logging={loggingId === nextRow.exerciseId}
          setsLoading={setsLoading}
          offline={offline}
          sessionSets={sessionSets}
          excludeSessionId={excludeSessionId}
          repeating={repeatingId === nextRow.exerciseId}
          onLog={onLog}
          onRepeat={() => onRepeat(nextRow)}
          onSkip={() => onSkip(nextRow.exerciseId, true)}
          onEditSet={onEditSet}
          onNeedForm={onNeedForm}
        />
      </section>
    );
  }
  return (
    <section aria-label={name ? `${name} plan` : "Workout plan"} className="mt-2">
      {heading}
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
                    onLog={onLog}
                    onRepeat={() => onRepeat(row)}
                    onSkip={onSkip}
                    onMove={onMove}
                    onLink={onLink}
                    onUnlink={onUnlink}
                    onEditSet={onEditSet}
                    onNeedForm={onNeedForm}
                    editing={editing}
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
  onLog,
  onRepeat,
  onSkip,
  onMove,
  onLink,
  onUnlink,
  onEditSet,
  onNeedForm,
  editing,
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
  onLog: (exerciseId: string, name: string, set: LoggedPlanSet) => void;
  onRepeat: () => void;
  onSkip: (exerciseId: string, skipped: boolean) => void;
  onMove: (index: number, direction: -1 | 1) => void;
  onLink: (index: number) => void;
  onUnlink: (index: number) => void;
  onEditSet: (set: SetLine) => void;
  onNeedForm: (exerciseName: string) => void;
  editing: boolean;
}) {
  const unit = useWeightUnit();
  const progress = planProgress(row.sets.length, row.targetSets, row.skipped);
  const target = formatRoutineTarget(row, unit);
  const detail = [target, progress.label].filter((part) => part !== null).join(" · ");
  const progressHref = exerciseLink(row.exerciseId, "/");
  const name = progressHref ? (
    <Link href={progressHref} className="truncate text-base font-semibold tracking-[-0.01em] underline decoration-line underline-offset-4 hover:decoration-current">
      {row.name}
    </Link>
  ) : (
    <span className="truncate text-base font-semibold tracking-[-0.01em]">{row.name}</span>
  );

  return (
    <li className={`border-b border-line-soft py-3 ${row.skipped ? "opacity-60" : ""}`}>
      <div className="flex items-center gap-3">
        <PlanMark done={progress.done} skipped={row.skipped} />
        <ExerciseTile name={row.name} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-center gap-2">
            {name}
            {isNext ? (
              <span className="shrink-0 rounded-full bg-fill px-2 py-0.5 text-xs font-medium text-muted">
                Next
              </span>
            ) : null}
          </span>
          {detail ? <span className="text-sm text-muted">{detail}</span> : null}
          {row.sets.length > 0 ? (
            <span className="mt-0.5 flex flex-wrap gap-x-3 font-mono text-sm text-muted">
              {row.sets.map((set, setIndex) => (
                <button
                  key={set._id}
                  type="button"
                  onClick={() => onEditSet(set)}
                  aria-label={`Edit set ${setIndex + 1} of ${row.name}, ${describeSet(set, unit)}`}
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
        {row.sets.length > 0 ? (
          <button
            type="button"
            onClick={onRepeat}
            disabled={repeating}
            aria-label={`Log another set of ${row.name}`}
            className="flex size-11 shrink-0 items-center justify-center rounded-full border border-line bg-surface hover:bg-fill-2 disabled:opacity-60"
          >
            {repeating ? <Spinner className="size-4" /> : <PlusIcon className="size-5" />}
          </button>
        ) : null}
      </div>
      {row.sets.length === 0 ? (
        <PlanLogButton
          row={row}
          logging={logging}
          setsLoading={setsLoading}
          offline={offline}
          sessionSets={sessionSets}
          excludeSessionId={excludeSessionId}
          onLog={onLog}
          onNeedForm={onNeedForm}
        />
      ) : null}
      {editing ? (
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
        </div>
      ) : null}
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
  onNeedForm,
  indent = true,
}: {
  row: PlanRow;
  logging: boolean;
  setsLoading: boolean;
  offline: boolean;
  sessionSets: SetLine[];
  excludeSessionId?: Id<"sessions">;
  onLog: (exerciseId: string, name: string, set: LoggedPlanSet) => void;
  onNeedForm: (exerciseName: string) => void;
  /** Lines the buttons up under the exercise name in the list view. */
  indent?: boolean;
}) {
  const unit = useWeightUnit();
  const progression = useProgression();
  const previous = usePreviousExercise(row.name, excludeSessionId);
  const ready = (offline || !previous.loading) && !setsLoading;
  const offer = ready
    ? planLogOffer(row.name, sessionSets, previous.sets, routinePrefillFromTarget(row), unit)
    : null;
  const primary = offer?.primary ?? null;
  const suggestion =
    ready && previous.sets
      ? suggestNext(previous.sets, {
          enabled: progression.enabled,
          incrementLb: progression.incrementLb,
          unit,
          routine: { targetSets: row.targetSets, targetReps: row.targetReps },
        })
      : null;
  const suggestionLabel =
    suggestion &&
    primary &&
    !suggestionAlreadyShown(suggestion, {
      kind: setKind(primary.set),
      reps: primary.set.reps ? String(primary.set.reps) : "",
      weightLb: primary.set.weightLb,
    })
      ? formatSuggestion(suggestion, unit)
      : null;
  const reason =
    suggestion && previous.sets
      ? explainSuggestion(previous.sets, suggestion, {
          unit,
          routine: { targetSets: row.targetSets, targetReps: row.targetReps },
        })
      : null;

  function logSuggested() {
    if (!primary || !suggestion) {
      return;
    }
    if (suggestion.kind === "weight") {
      onLog(row.exerciseId, row.name, { ...primary.set, weightLb: suggestion.weightLb, setType: "working" });
      return;
    }
    onLog(row.exerciseId, row.name, { ...primary.set, reps: suggestion.reps, setType: "working" });
  }

  const buttonClass =
    "min-h-12 w-full rounded-full px-4 text-left text-lg font-semibold disabled:opacity-60";

  return (
    <div className={`mt-2 flex flex-col gap-2 ${indent ? "pl-14" : ""}`}>
      <button
        type="button"
        disabled={!ready || logging}
        aria-label={
          logging
            ? undefined
            : primary
              ? planLogSpeech(row.name, primary.label, primary.set, unit)
              : `Add a set of ${row.name}`
        }
        onClick={() => {
          if (!ready) {
            return;
          }
          if (primary) {
            onLog(row.exerciseId, row.name, primary.set);
            return;
          }
          onNeedForm(row.name);
        }}
        className={`${buttonClass} bg-inverse text-inverse-ink`}
      >
        {logging ? "Logging…" : !ready ? "…" : (primary?.label ?? "Add set")}
      </button>
      {offer?.lastTime ? (
        <button
          type="button"
          disabled={logging}
          aria-label={lastTimeSpeech(row.name, offer.lastTime.set, unit)}
          onClick={() => {
            if (offer.lastTime) {
              onLog(row.exerciseId, row.name, offer.lastTime.set);
            }
          }}
          className="min-h-11 w-full rounded-full px-1 text-left text-base font-medium text-muted disabled:opacity-60"
        >
          {offer.lastTime.label}
        </button>
      ) : null}
      {suggestionLabel ? (
        <button
          type="button"
          disabled={logging}
          onClick={logSuggested}
          className="min-h-11 w-full rounded-full border border-line px-4 text-left text-base font-medium disabled:opacity-60"
        >
          {suggestionLabel}
        </button>
      ) : null}
      {reason ? <p className="px-1 text-sm text-pretty text-muted">{reason}</p> : null}
    </div>
  );
}

function GuidedCard({
  row,
  progress,
  supersetNames,
  upNext,
  logging,
  setsLoading,
  offline,
  sessionSets,
  excludeSessionId,
  repeating,
  onLog,
  onRepeat,
  onSkip,
  onEditSet,
  onNeedForm,
}: {
  row: PlanRow;
  progress: ReturnType<typeof guidedProgress>;
  /** Every exercise in the next one's superset, in plan order. Empty when it stands alone. */
  supersetNames: string[];
  upNext: string[];
  logging: boolean;
  setsLoading: boolean;
  offline: boolean;
  sessionSets: SetLine[];
  excludeSessionId?: Id<"sessions">;
  repeating: boolean;
  onLog: (exerciseId: string, name: string, set: LoggedPlanSet) => void;
  onRepeat: () => void;
  onSkip: () => void;
  onEditSet: (set: SetLine) => void;
  onNeedForm: (exerciseName: string) => void;
}) {
  const unit = useWeightUnit();
  const target = formatRoutineTarget(row, unit);
  const setProgress = planProgress(row.sets.length, row.targetSets, row.skipped);
  const detail = [target, setProgress.label].filter((part) => part !== null).join(" · ");
  const progressHref = exerciseLink(row.exerciseId, "/");
  const last = row.sets[row.sets.length - 1];
  const percent = progress.setsPlanned > 0 ? Math.round((progress.setsDone / progress.setsPlanned) * 100) : 0;

  return (
    <div className="mt-3">
      <div className="flex items-baseline justify-between gap-3 text-sm text-muted">
        <span>
          {progress.position !== null ? `Exercise ${progress.position} of ${progress.exercises}` : null}
        </span>
        <span>
          {progress.setsDone} of {pluralize(progress.setsPlanned, "set")}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label="Planned sets done"
        aria-valuemin={0}
        aria-valuemax={progress.setsPlanned}
        aria-valuenow={progress.setsDone}
        className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-fill"
      >
        <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${percent}%` }} />
      </div>

      <div className="mt-4 rounded-[1.25rem] border border-line bg-surface p-4">
        {supersetNames.length > 1 ? (
          <p className="mb-2 text-xs font-medium tracking-[0.06em] text-subtle uppercase">
            Superset · {supersetNames.join(" + ")}
          </p>
        ) : null}
        <div className="flex items-center gap-3">
          <ExerciseTile name={row.name} />
          <span className="flex min-w-0 flex-1 flex-col">
            {progressHref ? (
              <Link
                href={progressHref}
                className="text-xl font-semibold tracking-[-0.02em] text-pretty underline decoration-line underline-offset-4 hover:decoration-current"
              >
                {row.name}
              </Link>
            ) : (
              <span className="text-xl font-semibold tracking-[-0.02em] text-pretty">{row.name}</span>
            )}
            {detail ? <span className="text-sm text-muted">{detail}</span> : null}
          </span>
        </div>

        {row.sets.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-x-3 font-mono text-sm text-muted">
            {row.sets.map((set, setIndex) => (
              <button
                key={set._id}
                type="button"
                onClick={() => onEditSet(set)}
                aria-label={`Edit set ${setIndex + 1} of ${row.name}, ${describeSet(set, unit)}`}
                className="min-h-11 text-left"
              >
                {formatSetShort(set, unit)}
                <SetTypeTag setType={set.setType} />
                {set.pending ? <span className="ml-1 font-sans text-xs">· pending</span> : null}
              </button>
            ))}
          </div>
        ) : null}

        {last ? (
          <button
            type="button"
            onClick={onRepeat}
            disabled={repeating}
            aria-label={`Log set ${row.sets.length + 1} of ${row.name}, ${describeSet(last, unit)}`}
            className="mt-3 min-h-12 w-full rounded-full bg-inverse px-4 text-left text-lg font-semibold text-inverse-ink disabled:opacity-60"
          >
            {repeating ? "Logging…" : `Set ${row.sets.length + 1} · ${formatSetShort(last, unit)}`}
          </button>
        ) : (
          <PlanLogButton
            row={row}
            logging={logging}
            setsLoading={setsLoading}
            offline={offline}
            sessionSets={sessionSets}
            excludeSessionId={excludeSessionId}
            onLog={onLog}
            onNeedForm={onNeedForm}
            indent={false}
          />
        )}
        <div className="mt-1 flex justify-end">
          <TextAction label={`Skip ${row.name}`} onClick={onSkip}>
            Skip
          </TextAction>
        </div>
      </div>

      {upNext.length > 0 ? (
        <p className="mt-3 px-1 text-sm text-pretty text-muted">
          <span className="font-medium text-foreground">Up next · </span>
          {upNext.join(" · ")}
        </p>
      ) : null}
    </div>
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
      className="min-h-11 rounded-full px-3 text-base font-medium text-muted hover:bg-fill-2 disabled:opacity-40"
    >
      {children}
    </button>
  );
}
