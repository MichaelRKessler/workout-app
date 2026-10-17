"use client";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  cleanSecondaryMuscles,
  MAX_SECONDARY_MUSCLES,
  MUSCLE_GROUPS,
  MUSCLE_LABELS,
  type MuscleGroup,
} from "@/convex/lib/muscleGroup";
import { readableError } from "@/lib/errors";
import { useMutation } from "convex/react";
import { useState } from "react";

export function MuscleGroupField({
  exerciseId,
  exerciseName,
  muscleGroup,
  muscleSource,
  secondaryMuscles,
  secondarySource,
  offline = false,
  compact = false,
}: {
  exerciseId: Id<"exercises">;
  exerciseName: string;
  muscleGroup: MuscleGroup;
  muscleSource: "saved" | "suggested";
  secondaryMuscles: MuscleGroup[];
  secondarySource: "saved" | "suggested";
  offline?: boolean;
  compact?: boolean;
}) {
  const setMuscle = useMutation(api.exercises.setMuscle);
  const setSecondary = useMutation(api.exercises.setSecondaryMuscles);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const value = muscleSource === "saved" ? muscleGroup : "auto";
  const fieldId = `muscle-${exerciseId}`;

  async function save(write: () => Promise<null>) {
    if (offline || pending) {
      return;
    }
    setPending(true);
    setError(null);
    try {
      await write();
    } catch (caught) {
      setError(readableError(caught));
    } finally {
      setPending(false);
    }
  }

  function onChange(next: string) {
    void save(() =>
      setMuscle({
        exerciseId,
        muscleGroup: next === "auto" ? null : (next as MuscleGroup),
      }),
    );
  }

  function onSecondary(next: MuscleGroup[] | null) {
    void save(() => setSecondary({ exerciseId, secondaryMuscles: next }));
  }

  const alsoWorks = (
    <SecondaryMusclePicker
      primary={muscleGroup}
      selected={secondaryMuscles}
      source={secondarySource}
      disabled={pending || offline}
      onChange={onSecondary}
      exerciseName={exerciseName}
    />
  );

  return (
    <div className={compact ? "min-w-0" : "mt-3"}>
      {compact ? null : (
        <label
          htmlFor={fieldId}
          className="text-xs font-medium tracking-[0.06em] text-subtle uppercase"
        >
          Muscle group
        </label>
      )}
      <select
        id={fieldId}
        aria-label={
          compact
            ? `Muscle group for ${exerciseName}`
            : undefined
        }
        value={value}
        disabled={pending || offline}
        onChange={(event) => onChange(event.target.value)}
        className={
          compact
            ? "h-11 max-w-full rounded-full border border-input bg-background px-3 text-sm outline-none focus:border-foreground disabled:opacity-60"
            : "mt-2 h-12 w-full rounded-xl border border-input bg-background px-3 text-base outline-none focus:border-foreground disabled:opacity-60"
        }
      >
        <option value="auto">
          {muscleSource === "suggested" ? `Auto · ${MUSCLE_LABELS[muscleGroup]}` : "Auto"}
        </option>
        {MUSCLE_GROUPS.map((group) => (
          <option key={group} value={group}>
            {MUSCLE_LABELS[group]}
          </option>
        ))}
      </select>
      {compact ? (
        <details className="mt-2">
          <summary className="min-h-11 cursor-pointer py-2.5 text-sm text-muted">
            Also works ·{" "}
            {secondaryMuscles.length > 0
              ? secondaryMuscles.map((group) => MUSCLE_LABELS[group]).join(", ")
              : "None"}
          </summary>
          {alsoWorks}
        </details>
      ) : (
        <p className="mt-1.5 text-sm leading-normal text-muted">
          {offline
            ? "Changing the muscle group needs a connection."
            : muscleSource === "suggested"
              ? "Suggested from the name. A choice you save stays if you rename it."
              : "Saved for this exercise. Auto follows the name again."}
        </p>
      )}
      {compact ? null : (
        <>
          <p className="mt-5 text-xs font-medium tracking-[0.06em] text-subtle uppercase">Also works</p>
          {alsoWorks}
        </>
      )}
      {error ? (
        <p role="alert" className="mt-1.5 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Toggle chips for the groups an exercise also works. Picking one saves the
 * whole list, so a suggested list becomes the exercise's own.
 */
export function SecondaryMusclePicker({
  primary,
  selected,
  source,
  disabled = false,
  onChange,
  exerciseName,
}: {
  primary: MuscleGroup;
  selected: MuscleGroup[];
  source: "saved" | "suggested";
  disabled?: boolean;
  onChange: (next: MuscleGroup[] | null) => void;
  exerciseName?: string;
}) {
  const choices = MUSCLE_GROUPS.filter(
    (group) => group !== primary && group !== "other" && group !== "cardio",
  );
  const full = selected.length >= MAX_SECONDARY_MUSCLES;

  function toggle(group: MuscleGroup) {
    const next = selected.includes(group)
      ? selected.filter((item) => item !== group)
      : [...selected, group];
    onChange(cleanSecondaryMuscles(next, primary));
  }

  return (
    <div className="mt-2">
      <div
        role="group"
        aria-label={exerciseName ? `Also works, for ${exerciseName}` : "Also works"}
        className="flex flex-wrap gap-2"
      >
        {choices.map((group) => {
          const on = selected.includes(group);
          return (
            <button
              key={group}
              type="button"
              aria-pressed={on}
              disabled={disabled || (!on && full)}
              onClick={() => toggle(group)}
              className={`min-h-11 rounded-full border px-3.5 text-sm font-medium disabled:opacity-50 ${
                on ? "border-transparent bg-inverse text-inverse-ink" : "border-line text-muted"
              }`}
            >
              {MUSCLE_LABELS[group]}
            </button>
          );
        })}
      </div>
      <p className="mt-1.5 text-sm leading-normal text-muted">
        {source === "suggested"
          ? "Suggested from the name. Each counts as half a set in your week."
          : "Saved for this exercise. Each counts as half a set in your week."}{" "}
        {source === "saved" ? (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange(null)}
            className="font-medium text-foreground underline decoration-line underline-offset-4 disabled:opacity-50"
          >
            Use suggestions
          </button>
        ) : null}
      </p>
    </div>
  );
}
