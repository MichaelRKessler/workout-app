"use client";

import { Button } from "@/components/Button";
import { CloseIcon, MinusIcon, PlusIcon, SearchIcon } from "@/components/icons";
import { Sheet } from "@/components/Sheet";
import { usePreviousExercise } from "@/components/workout/usePreviousExercise";
import type { Id } from "@/convex/_generated/dataModel";
import { formatExerciseName } from "@/convex/lib/exerciseName";
import type { SetLine } from "@/lib/groupSets";
import { parseReps, parseWeightLb } from "@/lib/numbers";
import { prefillValues, type PrefillSource } from "@/lib/prefill";
import { FormEvent, useEffect, useState } from "react";

const MAX_CHIPS = 12;
const WEIGHT_STEP = 5;

type FormValues = { reps: string; weight: string; source: PrefillSource | "edit" };

function step(value: string, delta: number, min: number, max: number, parse: (value: string) => number | null) {
  const current = parse(value) ?? min;
  const next = Math.min(max, Math.max(min, Math.round((current + delta) * 100) / 100));
  return String(next);
}

export function ManualEntrySheet({
  open,
  mode,
  initialExercise,
  initialReps,
  initialWeight,
  library,
  sessionSets,
  excludeSessionId,
  pending,
  onClose,
  onAdd,
}: {
  open: boolean;
  mode: "add" | "edit";
  initialExercise: string;
  initialReps?: number;
  initialWeight?: number;
  /** Exercise names to offer, most relevant first. */
  library: string[];
  sessionSets: SetLine[];
  excludeSessionId?: Id<"sessions">;
  pending: boolean;
  onClose: () => void;
  onAdd: (set: { exerciseName: string; reps: number; weightLb: number }) => Promise<string | null>;
}) {
  const editing = mode === "edit";
  const [exerciseName, setExerciseName] = useState(initialExercise);
  const [pickedName, setPickedName] = useState(initialExercise);
  const [dirty, setDirty] = useState(editing);
  const [values, setValues] = useState<FormValues>(() =>
    editing
      ? { reps: String(initialReps ?? 10), weight: String(initialWeight ?? 0), source: "edit" }
      : prefillValues(initialExercise, sessionSets, null),
  );
  const [error, setError] = useState<string | null>(null);
  const history = usePreviousExercise(editing ? initialExercise : exerciseName, excludeSessionId);

  useEffect(() => {
    if (editing || dirty || history.loading) {
      return;
    }
    const typed = formatExerciseName(exerciseName);
    const picked = formatExerciseName(pickedName);
    if (!typed || !picked || typed.normalizedName !== picked.normalizedName) {
      return;
    }
    setValues(prefillValues(exerciseName, sessionSets, history.sets));
  }, [dirty, editing, exerciseName, history.loading, history.sets, pickedName, sessionSets]);

  const formatted = formatExerciseName(exerciseName);
  const query = formatted?.normalizedName ?? "";
  // Filter while typing a new name; once the field holds a known exercise, show them all again.
  const known = library.some((name) => formatExerciseName(name)?.normalizedName === query);
  const chips = library
    .filter((name) => {
      if (query.length === 0 || known) {
        return true;
      }
      return (formatExerciseName(name)?.normalizedName ?? "").includes(query);
    })
    .slice(0, MAX_CHIPS);

  function choose(name: string) {
    setExerciseName(name);
    setPickedName(name);
    setDirty(false);
    setValues(prefillValues(name, sessionSets, null));
    setError(null);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!formatted) {
      setError("Enter an exercise name up to 80 characters.");
      return;
    }
    const reps = parseReps(values.reps);
    if (reps === null) {
      setError("Reps must be a whole number from 1 to 999.");
      return;
    }
    const weightLb = parseWeightLb(values.weight);
    if (weightLb === null) {
      setError("Weight must be 0 to 2000 lb, with up to two decimal places.");
      return;
    }
    setError(null);
    const failure = await onAdd({ exerciseName: formatted.name, reps, weightLb });
    if (failure) {
      setError(failure);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} labelledBy="manual-title" dismissible={!pending}>
      <form onSubmit={(event) => void onSubmit(event)} className="flex flex-col">
        <div className="flex items-center justify-between">
          <h2 id="manual-title" className="text-xl font-semibold tracking-[-0.02em]">
            {editing ? "Edit set" : "Add a set"}
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

        <label
          htmlFor="manual-exercise"
          className="mt-3 text-[11px] font-medium tracking-[0.1em] text-subtle uppercase"
        >
          Exercise
        </label>
        <div className="mt-2 flex h-12 items-center gap-2 rounded-xl border border-line bg-background px-3 text-subtle focus-within:border-foreground">
          <SearchIcon className="size-[18px] shrink-0" strokeWidth={1.8} />
          <input
            id="manual-exercise"
            value={exerciseName}
            onChange={(event) => {
              setExerciseName(event.target.value);
              setError(null);
            }}
            readOnly={editing}
            placeholder="Type or pick an exercise"
            autoComplete="off"
            maxLength={80}
            className="h-11 min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-subtle read-only:text-foreground"
          />
        </div>

        {!editing && chips.length > 0 ? (
          <div
            role="group"
            aria-label="Exercises"
            className="-mx-5 mt-2.5 flex gap-2 overflow-x-auto px-5 [scrollbar-width:none]"
          >
            {chips.map((name) => {
              const selected = formatExerciseName(name)?.normalizedName === query && query.length > 0;
              return (
                <button
                  key={name}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => choose(name)}
                  className={`min-h-11 shrink-0 rounded-full border px-4 text-sm font-medium whitespace-nowrap ${
                    selected
                      ? "border-inverse bg-inverse text-inverse-ink"
                      : "border-line bg-surface text-foreground hover:bg-fill-2"
                  }`}
                >
                  {name}
                </button>
              );
            })}
          </div>
        ) : null}

        <div className="mt-5 grid grid-cols-2 gap-3">
          <Stepper
            id="manual-reps"
            label="Reps"
            value={values.reps}
            inputMode="numeric"
            decreaseLabel="Fewer reps"
            increaseLabel="More reps"
            onChange={(reps) => {
              setDirty(true);
              setValues({ ...values, reps, source: editing ? "edit" : values.source });
            }}
            onStep={(delta) => {
              setDirty(true);
              setValues({ ...values, reps: step(values.reps, delta, 1, 999, parseReps) });
            }}
          />
          <Stepper
            id="manual-weight"
            label="Weight · lb"
            value={values.weight}
            inputMode="decimal"
            decreaseLabel={`${WEIGHT_STEP} lb less`}
            increaseLabel={`${WEIGHT_STEP} lb more`}
            stepSize={WEIGHT_STEP}
            onChange={(weight) => {
              setDirty(true);
              setValues({ ...values, weight });
            }}
            onStep={(delta) => {
              setDirty(true);
              setValues({
                ...values,
                weight: step(values.weight, delta, 0, 2000, parseWeightLb),
              });
            }}
          />
        </div>

        {error ? (
          <p role="alert" className="mt-3 text-sm leading-5 text-danger">
            {error}
          </p>
        ) : (
          <p className="mt-3 text-[13px] text-subtle">
            {history.label ? <span className="text-muted">{history.label}. </span> : null}
            {values.source === "session" ? "Filled in from your last set. " : null}
            {editing ? "This set stays where it is. " : null}
            Use 0 for bodyweight.
          </p>
        )}

        <Button type="submit" size="lg" className="mt-5 w-full" disabled={pending}>
          {pending ? "Saving…" : editing ? "Save" : "Add set"}
        </Button>
      </form>
    </Sheet>
  );
}

function Stepper({
  id,
  label,
  value,
  inputMode,
  decreaseLabel,
  increaseLabel,
  stepSize = 1,
  onChange,
  onStep,
}: {
  id: string;
  label: string;
  value: string;
  inputMode: "numeric" | "decimal";
  decreaseLabel: string;
  increaseLabel: string;
  stepSize?: number;
  onChange: (value: string) => void;
  onStep: (delta: number) => void;
}) {
  const buttonClass =
    "flex size-11 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-foreground hover:bg-fill-2";
  return (
    <div className="flex flex-col gap-1.5 rounded-2xl border border-line bg-background p-3">
      <label htmlFor={id} className="text-[11px] font-medium tracking-[0.1em] text-subtle uppercase">
        {label}
      </label>
      <div className="flex items-center justify-between gap-1">
        <button type="button" aria-label={decreaseLabel} onClick={() => onStep(-stepSize)} className={buttonClass}>
          <MinusIcon className="size-[18px]" strokeWidth={1.8} />
        </button>
        <input
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          inputMode={inputMode}
          autoComplete="off"
          className="w-full min-w-0 bg-transparent text-center font-mono text-[28px] font-medium tracking-[-0.03em] text-foreground outline-none"
        />
        <button type="button" aria-label={increaseLabel} onClick={() => onStep(stepSize)} className={buttonClass}>
          <PlusIcon className="size-[18px]" strokeWidth={1.8} />
        </button>
      </div>
    </div>
  );
}
