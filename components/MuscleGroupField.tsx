"use client";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { MUSCLE_GROUPS, MUSCLE_LABELS, type MuscleGroup } from "@/convex/lib/muscleGroup";
import { readableError } from "@/lib/errors";
import { useMutation } from "convex/react";
import { useState } from "react";

export function MuscleGroupField({
  exerciseId,
  exerciseName,
  muscleGroup,
  muscleSource,
  offline = false,
  compact = false,
}: {
  exerciseId: Id<"exercises">;
  exerciseName: string;
  muscleGroup: MuscleGroup;
  muscleSource: "saved" | "suggested";
  offline?: boolean;
  compact?: boolean;
}) {
  const setMuscle = useMutation(api.exercises.setMuscle);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const value = muscleSource === "saved" ? muscleGroup : "auto";
  const fieldId = `muscle-${exerciseId}`;

  async function onChange(next: string) {
    if (offline || pending) {
      return;
    }
    setPending(true);
    setError(null);
    try {
      await setMuscle({
        exerciseId,
        muscleGroup: next === "auto" ? null : (next as MuscleGroup),
      });
    } catch (caught) {
      setError(readableError(caught));
    } finally {
      setPending(false);
    }
  }

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
        onChange={(event) => void onChange(event.target.value)}
        className={
          compact
            ? "h-11 max-w-full rounded-full border border-line bg-background px-3 text-sm outline-none focus:border-foreground disabled:opacity-60"
            : "mt-2 h-12 w-full rounded-xl border border-line bg-background px-3 text-base outline-none focus:border-foreground disabled:opacity-60"
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
      {compact ? null : (
        <p className="mt-1.5 text-sm leading-normal text-muted">
          {offline
            ? "Changing the muscle group needs a connection."
            : muscleSource === "suggested"
              ? "Suggested from the name. A choice you save stays if you rename it."
              : "Saved for this exercise. Auto follows the name again."}
        </p>
      )}
      {error ? (
        <p role="alert" className="mt-1.5 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
