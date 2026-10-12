"use client";

import { SetTypeTag } from "@/components/SetTypePicker";
import { useWeightUnit } from "@/components/WeightUnit";
import { ExerciseGlyph, PlusIcon, Spinner } from "@/components/icons";
import { exerciseIconKind } from "@/lib/exerciseIcon";
import { describeSet, formatSetShort } from "@/lib/format";
import type { SetLine } from "@/lib/groupSets";
import Link from "next/link";
import { ReactNode, useId } from "react";

export function ExerciseTile({ name }: { name: string }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-fill text-foreground"
    >
      <ExerciseGlyph kind={exerciseIconKind(name)} />
    </span>
  );
}

function SetTokens({
  name,
  sets,
  newestSetId,
  onEditSet,
}: {
  name: string;
  sets: SetLine[];
  newestSetId?: string;
  onEditSet?: (set: SetLine) => void;
}) {
  const unit = useWeightUnit();
  return (
    <span className="flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-sm text-muted">
      {sets.map((set, index) => {
        const label = (
          <>
            {formatSetShort(set, unit)}
            <SetTypeTag setType={set.setType} />
            {set.pending ? <span className="ml-1 font-sans text-xs tracking-normal">· pending</span> : null}
          </>
        );
        const className = set._id === newestSetId ? "font-semibold text-foreground" : undefined;
        if (!onEditSet) {
          return (
            <span key={set._id} className={className}>
              {label}
            </span>
          );
        }
        return (
          <button
            key={set._id}
            type="button"
            onClick={() => onEditSet(set)}
            aria-label={`Edit set ${index + 1} of ${name}, ${describeSet(set, unit)}`}
            className={`min-h-11 text-left ${className ?? ""}`}
          >
            {label}
          </button>
        );
      })}
    </span>
  );
}

/**
 * One exercise and its sets. With `onRepeat` it is part of the open workout:
 * the + logs the last set again and tapping the row shows each set with Edit and Remove.
 */
export function ExerciseRow({
  name,
  sets,
  newestSetId,
  expanded = false,
  onToggle,
  onRepeat,
  repeating = false,
  onEditSet,
  onRemoveSet,
  removingId = null,
  exerciseHref,
  footer,
}: {
  name: string;
  sets: SetLine[];
  newestSetId?: string;
  expanded?: boolean;
  onToggle?: () => void;
  onRepeat?: () => void;
  repeating?: boolean;
  onEditSet?: (set: SetLine) => void;
  onRemoveSet?: (setId: string) => void;
  removingId?: string | null;
  exerciseHref?: string;
  footer?: ReactNode;
}) {
  const detailId = useId();
  const unit = useWeightUnit();
  const last = sets[sets.length - 1];
  const nameNode = exerciseHref ? (
    <Link href={exerciseHref} className="truncate text-base font-semibold tracking-[-0.01em] underline decoration-line underline-offset-4 hover:decoration-current">
      {name}
    </Link>
  ) : (
    <span className="truncate text-base font-semibold tracking-[-0.01em]">{name}</span>
  );
  const summary = (
    <>
      <ExerciseTile name={name} />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        {nameNode}
        {onToggle && exerciseHref && !onEditSet ? (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            aria-controls={detailId}
            aria-label={`${expanded ? "Hide" : "Show"} sets for ${name}`}
            className="text-left"
          >
            <SetTokens sets={sets} newestSetId={newestSetId} name={name} />
          </button>
        ) : (
          <SetTokens sets={sets} newestSetId={newestSetId} name={name} onEditSet={onEditSet} />
        )}
      </span>
    </>
  );

  return (
    <li className="border-b border-line-soft last:border-b-0">
      <div className="flex items-center gap-3.5 py-3.5">
        {onToggle && !exerciseHref && !onEditSet ? (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            aria-controls={detailId}
            className="flex min-w-0 flex-1 items-center gap-3.5 rounded-xl text-left"
          >
            {summary}
          </button>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-3.5">{summary}</div>
        )}
        {onRepeat && last ? (
          <button
            type="button"
            onClick={onRepeat}
            disabled={repeating}
            aria-label={`Log another set of ${name}, ${describeSet(last, unit)}`}
            className="flex size-11 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-foreground hover:bg-fill-2 disabled:opacity-60"
          >
            {repeating ? <Spinner className="size-4" /> : <PlusIcon className="size-5" />}
          </button>
        ) : null}
      </div>
      {onToggle && expanded ? (
        <ol id={detailId} className="-mt-1 flex flex-col pb-3 pl-[calc(var(--spacing)*14.5)]">
          {sets.map((set, index) => (
            <li key={set._id} className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm">
              <span className="min-w-0">
                <span className="text-subtle">Set {index + 1}</span>
                <span className="ml-3 font-mono">
                  {formatSetShort(set, unit)}
                  <SetTypeTag setType={set.setType} />
                  {set.pending ? <span className="ml-1 font-sans text-xs tracking-normal">· pending</span> : null}
                </span>
              </span>
              {onEditSet || onRemoveSet ? (
                <span className="flex items-center">
                  {onEditSet ? (
                    <button
                      type="button"
                      onClick={() => onEditSet(set)}
                      aria-label={`Edit set ${index + 1} of ${name}`}
                      className="min-h-11 rounded-full px-3 font-medium hover:bg-fill-2"
                    >
                      Edit
                    </button>
                  ) : null}
                  {onRemoveSet ? (
                    <button
                      type="button"
                      onClick={() => onRemoveSet(set._id)}
                      disabled={removingId === set._id}
                      aria-label={`Remove set ${index + 1} of ${name}`}
                      className="min-h-11 rounded-full px-3 font-medium text-danger hover:bg-fill-2 disabled:opacity-50"
                    >
                      {removingId === set._id ? "Removing…" : "Remove"}
                    </button>
                  ) : null}
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
      {footer}
    </li>
  );
}
