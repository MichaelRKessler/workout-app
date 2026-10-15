"use client";

import { Button } from "@/components/Button";
import { SetTypeTag } from "@/components/SetTypePicker";
import { Sheet } from "@/components/Sheet";
import { useWeightUnit } from "@/components/WeightUnit";
import { CloseIcon } from "@/components/icons";
import { formatExerciseName } from "@/convex/lib/exerciseName";
import { formatSetShort, pluralize } from "@/lib/format";
import type { SetLine } from "@/lib/groupSets";
import { type FormEvent, useState } from "react";

/**
 * One exercise on a finished workout: its sets with Edit and Remove, a new
 * set, a different name for this workout, or the whole exercise removed.
 */
export function ExerciseEditSheet({
  open,
  name,
  sets,
  offline,
  pending,
  error,
  onClose,
  onEditSet,
  onRemoveSet,
  onAddSet,
  onRename,
  onDelete,
}: {
  open: boolean;
  name: string;
  sets: SetLine[];
  offline: boolean;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onEditSet: (set: SetLine) => void;
  onRemoveSet: (setId: string) => void;
  onAddSet: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const unit = useWeightUnit();
  const [draft, setDraft] = useState(name);
  const [nameError, setNameError] = useState<string | null>(null);
  const formatted = formatExerciseName(draft);
  const changed = formatted !== null && formatted.name !== name;
  const syncing = sets.some((set) => set.pending);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!formatted) {
      setNameError("Enter an exercise name up to 80 characters.");
      return;
    }
    setNameError(null);
    if (changed) {
      onRename(formatted.name);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} labelledBy="exercise-edit-title" dismissible={!pending}>
      <div className="flex items-center justify-between">
        <h2 id="exercise-edit-title" className="text-xl font-semibold tracking-[-0.02em]">
          Edit exercise
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="-mr-2 flex size-11 items-center justify-center rounded-full hover:bg-fill-2"
        >
          <CloseIcon className="size-5" strokeWidth={1.8} />
        </button>
      </div>

      <form onSubmit={submit} className="mt-3">
        <label
          htmlFor="exercise-edit-name"
          className="text-xs font-medium tracking-[0.06em] text-subtle uppercase"
        >
          Exercise
        </label>
        <div className="mt-2 flex gap-2">
          <input
            id="exercise-edit-name"
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              setNameError(null);
            }}
            maxLength={80}
            autoComplete="off"
            className="h-12 min-w-0 flex-1 rounded-xl border border-input bg-background px-3 text-base outline-none focus:border-foreground"
          />
          {changed ? (
            <Button type="submit" disabled={pending || offline || syncing}>
              {pending ? "Saving…" : "Save"}
            </Button>
          ) : null}
        </div>
        <p className="mt-1.5 text-sm text-pretty text-subtle">
          {offline
            ? "You're offline. Reconnect to change the name."
            : syncing
              ? "Some sets are still syncing. The name can change once they finish."
              : "Changes this workout only. Rename it everywhere from the Exercises tab."}
        </p>
      </form>

      <p className="mt-5 text-xs font-medium tracking-[0.06em] text-subtle uppercase">
        {pluralize(sets.length, "set")}
      </p>
      <ol className="mt-1 flex flex-col border-t border-line-soft">
        {sets.map((set, index) => (
          <li
            key={set._id}
            className="flex min-h-12 items-center justify-between gap-3 border-b border-line-soft text-sm"
          >
            <span className="min-w-0">
              <span className="text-subtle">Set {index + 1}</span>
              <span className="ml-3 font-mono">
                {formatSetShort(set, unit)}
                <SetTypeTag setType={set.setType} />
                {set.pending ? (
                  <span className="ml-1 font-sans text-xs tracking-normal">· pending</span>
                ) : null}
              </span>
            </span>
            <span className="flex shrink-0 items-center">
              <button
                type="button"
                onClick={() => onEditSet(set)}
                disabled={pending}
                aria-label={`Edit set ${index + 1} of ${name}`}
                className="min-h-11 rounded-full px-3 font-medium hover:bg-fill-2 disabled:opacity-50"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => onRemoveSet(set._id)}
                disabled={pending}
                aria-label={`Remove set ${index + 1} of ${name}`}
                className="min-h-11 rounded-full px-3 font-medium text-danger hover:bg-fill-2 disabled:opacity-50"
              >
                Remove
              </button>
            </span>
          </li>
        ))}
      </ol>

      {error || nameError ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error ?? nameError}
        </p>
      ) : null}

      <Button variant="secondary" size="lg" className="mt-4 w-full" onClick={onAddSet} disabled={pending}>
        Add a set
      </Button>
      <Button
        variant="danger"
        size="lg"
        className="mt-2 w-full"
        onClick={onDelete}
        disabled={pending}
      >
        Delete exercise
      </Button>
    </Sheet>
  );
}
