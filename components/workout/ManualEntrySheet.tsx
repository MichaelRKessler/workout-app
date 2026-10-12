"use client";

import { Button } from "@/components/Button";
import { CloseIcon, MinusIcon, PlusIcon, SearchIcon } from "@/components/icons";
import { SetTypePicker } from "@/components/SetTypePicker";
import { Sheet } from "@/components/Sheet";
import { useProgression } from "@/components/useProgression";
import { useWeightUnit } from "@/components/WeightUnit";
import { usePreviousExercise } from "@/components/workout/usePreviousExercise";
import type { Id } from "@/convex/_generated/dataModel";
import { formatExerciseName } from "@/convex/lib/exerciseName";
import {
  formatClock,
  parseCaloriesInput,
  parseClock,
  parseDistanceInput,
  setKind,
  type SetKind,
} from "@/convex/lib/measures";
import {
  formatWeightAmount,
  maxDisplayWeight,
  parseDisplayWeight,
  WEIGHT_STEP,
  weightLbFromDisplay,
  type WeightUnit,
} from "@/convex/lib/units";
import { resolvedSetType, type SetType } from "@/convex/lib/setType";
import type { SetLine } from "@/lib/groupSets";
import { parseReps } from "@/lib/numbers";
import { prefillValues, type PrefillSource } from "@/lib/prefill";
import {
  formatSuggestion,
  suggestionAlreadyShown,
  suggestNext,
} from "@/lib/suggestion";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

const MAX_CHIPS = 12;

type LoggedSet = {
  exerciseName: string;
  reps?: number;
  weightLb: number;
  durationSec?: number;
  distanceM?: number;
  calories?: number;
  rpe?: number;
  setType: SetType;
};

type FormValues = {
  kind: SetKind;
  reps: string;
  weight: string;
  duration: string;
  distance: string;
  calories: string;
  rpe: string;
  setType: SetType;
  source: PrefillSource | "edit";
  weightLb: number | null;
};

function step(value: string, delta: number, min: number, max: number, parse: (value: string) => number | null) {
  const current = parse(value) ?? min;
  const next = Math.min(max, Math.max(min, Math.round((current + delta) * 100) / 100));
  return String(next);
}

function showPrefill(
  values: ReturnType<typeof prefillValues>,
  unit: WeightUnit,
): FormValues {
  const pounds = Number(values.weight);
  return {
    kind: values.kind,
    reps: values.reps,
    weight: Number.isFinite(pounds) ? formatWeightAmount(pounds, unit) : values.weight,
    duration: values.duration,
    distance: values.distance,
    calories: values.calories,
    rpe: values.rpe,
    setType: values.setType,
    source: values.source,
    weightLb: Number.isFinite(pounds) ? pounds : null,
  };
}

export function ManualEntrySheet({
  open,
  mode,
  initialExercise,
  initialSet,
  library,
  sessionSets,
  excludeSessionId,
  pending,
  truncatedLibrary = false,
  planTargets,
  onClose,
  onAdd,
  onDelete,
}: {
  open: boolean;
  mode: "add" | "edit";
  initialExercise: string;
  initialSet?: {
    reps: number | null;
    weightLb: number;
    durationSec: number | null;
    distanceM: number | null;
    calories?: number | null;
    rpe: number | null;
    setType?: SetType;
  };
  /** Exercise names to offer, most relevant first. */
  library: string[];
  sessionSets: SetLine[];
  excludeSessionId?: Id<"sessions">;
  pending: boolean;
  truncatedLibrary?: boolean;
  planTargets?: Array<{
    name: string;
    targetSets: number | null;
    targetReps: number | null;
  }>;
  onClose: () => void;
  onAdd: (set: LoggedSet) => Promise<string | null>;
  /** Removes the set being edited. Shown only while editing. */
  onDelete?: () => void;
}) {
  const unit = useWeightUnit();
  const progression = useProgression();
  const editing = mode === "edit";
  const [exerciseName, setExerciseName] = useState(initialExercise);
  const [pickedName, setPickedName] = useState(initialExercise);
  const [dirty, setDirty] = useState(editing);
  const [values, setValues] = useState<FormValues>(() =>
    editing && initialSet
      ? {
          kind: setKind(initialSet),
          reps: initialSet.reps ? String(initialSet.reps) : "",
          weight: formatWeightAmount(initialSet.weightLb, unit),
          duration: initialSet.durationSec ? formatClock(initialSet.durationSec) : "",
          distance: initialSet.distanceM ? String(initialSet.distanceM) : "",
          calories: initialSet.calories ? String(initialSet.calories) : "",
          rpe: initialSet.rpe ? String(initialSet.rpe) : "",
          setType: resolvedSetType(initialSet.setType),
          source: "edit",
          weightLb: initialSet.weightLb,
        }
      : showPrefill(prefillValues(initialExercise, sessionSets, null), unit),
  );
  const [error, setError] = useState<string | null>(null);
  const seenUnit = useRef(unit);
  const history = usePreviousExercise(editing ? initialExercise : exerciseName, excludeSessionId);

  useEffect(() => {
    if (seenUnit.current === unit) {
      return;
    }
    seenUnit.current = unit;
    setValues((current) => {
      if (current.weightLb === null) {
        return current;
      }
      return { ...current, weight: formatWeightAmount(current.weightLb, unit) };
    });
  }, [unit]);

  useEffect(() => {
    if (editing || dirty || history.loading) {
      return;
    }
    const typed = formatExerciseName(exerciseName);
    const picked = formatExerciseName(pickedName);
    if (!typed || !picked || typed.normalizedName !== picked.normalizedName) {
      return;
    }
    setValues(showPrefill(prefillValues(exerciseName, sessionSets, history.sets), unit));
  }, [dirty, editing, exerciseName, history.loading, history.sets, pickedName, sessionSets, unit]);

  const formatted = formatExerciseName(exerciseName);
  const planTarget = (planTargets ?? []).find(
    (item) => formatExerciseName(item.name)?.normalizedName === formatted?.normalizedName,
  );
  const suggestion = useMemo(() => {
    if (editing || !history.sets) {
      return null;
    }
    return suggestNext(history.sets, {
      enabled: progression.enabled,
      incrementLb: progression.incrementLb,
      unit,
      routine: planTarget
        ? { targetSets: planTarget.targetSets, targetReps: planTarget.targetReps }
        : null,
    });
  }, [editing, history.sets, planTarget, progression.enabled, progression.incrementLb, unit]);
  const suggestionLabel =
    suggestion &&
    !suggestionAlreadyShown(suggestion, {
      kind: values.kind,
      reps: values.reps,
      weightLb: values.weightLb,
    })
      ? formatSuggestion(suggestion, unit)
      : null;

  function acceptSuggestion() {
    if (!suggestion) {
      return;
    }
    setDirty(true);
    setValues((current) => {
      const setType =
        current.setType === "warmup" || current.setType === "drop" ? "working" : current.setType;
      if (suggestion.kind === "weight") {
        return {
          ...current,
          setType,
          weight: formatWeightAmount(suggestion.weightLb, unit),
          weightLb: suggestion.weightLb,
        };
      }
      return { ...current, setType, reps: String(suggestion.reps) };
    });
  }
  const query = formatted?.normalizedName ?? "";
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
    setValues(showPrefill(prefillValues(name, sessionSets, null), unit));
    setError(null);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!formatted) {
      setError("Enter an exercise name up to 80 characters.");
      return;
    }
    const weightLb = weightLbFromDisplay(values.weight, unit, values.weightLb);
    if (weightLb === null) {
      setError(
        `Weight must be 0 to ${maxDisplayWeight(unit)} ${unit}, with up to two decimal places.`,
      );
      return;
    }
    const caloriesText = values.calories.trim();
    let calories: number | undefined;
    if (caloriesText.length > 0) {
      const parsed = parseCaloriesInput(caloriesText);
      if (parsed === null) {
        setError("Calories must be a whole number from 1 to 20000.");
        return;
      }
      calories = parsed;
    }

    const rpeText = values.rpe.trim();
    const rpe = rpeText.length === 0 ? undefined : Number(rpeText);
    if (rpe !== undefined && (!Number.isInteger(rpe) || rpe < 1 || rpe > 10)) {
      setError("RPE must be a whole number from 1 to 10, or blank.");
      return;
    }

    const logged: LoggedSet = {
      exerciseName: formatted.name,
      weightLb,
      setType: values.setType,
      ...(calories ? { calories } : {}),
      ...(rpe ? { rpe } : {}),
    };
    if (values.kind === "timed") {
      const durationSec = parseClock(values.duration);
      if (durationSec === null) {
        setError("Time must be from 1 second to 24 hours, like 90 or 1:30.");
        return;
      }
      logged.durationSec = durationSec;
    } else if (values.kind === "distance") {
      const distanceM = parseDistanceInput(values.distance);
      if (distanceM === null) {
        setError("Distance must be from 1 meter to 200 kilometers, like 400, 2 km, or 3 mi.");
        return;
      }
      logged.distanceM = distanceM;
      if (values.duration.trim().length > 0) {
        const durationSec = parseClock(values.duration);
        if (durationSec === null) {
          setError("Time must be from 1 second to 24 hours, like 90 or 7:30.");
          return;
        }
        logged.durationSec = durationSec;
      }
    } else {
      const reps = parseReps(values.reps);
      if (reps === null) {
        setError("Reps must be a whole number from 1 to 999.");
        return;
      }
      logged.reps = reps;
    }

    setError(null);
    const failure = await onAdd(logged);
    if (failure) {
      setError(failure);
    }
  }

  const weightStep = WEIGHT_STEP[unit];

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
          className="mt-3 text-xs font-medium tracking-[0.06em] text-subtle uppercase"
        >
          Exercise
        </label>
        <div className="mt-2 flex h-12 items-center gap-2 rounded-xl border border-input bg-background px-3 text-subtle focus-within:border-foreground">
          <SearchIcon className="size-5 shrink-0" strokeWidth={1.8} />
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
        {!editing && truncatedLibrary ? (
          <p className="mt-2 text-sm text-subtle">
            Showing 200 exercises. The rest are in Settings, under Exercises.
          </p>
        ) : null}

        <div role="group" aria-label="How this set is measured" className="mt-4 flex rounded-full border border-line p-0.5">
          {(
            [
              ["strength", "Reps"],
              ["timed", "Time"],
              ["distance", "Distance"],
            ] as const
          ).map(([kind, label]) => (
            <button
              key={kind}
              type="button"
              aria-pressed={values.kind === kind}
              onClick={() => {
                setDirty(true);
                setValues({ ...values, kind });
              }}
              className={`min-h-11 flex-1 rounded-full px-1 text-sm font-medium whitespace-nowrap ${
                values.kind === kind ? "bg-inverse text-inverse-ink" : "text-muted"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="mt-3">
          <SetTypePicker
            value={values.setType}
            onChange={(setType) => {
              setDirty(true);
              setValues({ ...values, setType });
            }}
          />
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          {values.kind === "strength" ? (
            <Stepper
              id="manual-reps"
              label="Reps"
              value={values.reps}
              inputMode="numeric"
              decreaseLabel="Fewer reps"
              increaseLabel="More reps"
              onChange={(reps) => {
                setDirty(true);
                setValues({ ...values, reps });
              }}
              onStep={(delta) => {
                setDirty(true);
                setValues({ ...values, reps: step(values.reps, delta, 1, 999, parseReps) });
              }}
            />
          ) : (
            <label className="flex flex-col gap-1.5 rounded-2xl border border-input bg-background p-3">
              <span className="text-xs font-medium tracking-[0.06em] text-subtle uppercase">
                {values.kind === "timed" ? "Time" : "Distance"}
              </span>
              <input
                value={values.kind === "timed" ? values.duration : values.distance}
                onChange={(event) => {
                  setDirty(true);
                  setValues(
                    values.kind === "timed"
                      ? { ...values, duration: event.target.value }
                      : { ...values, distance: event.target.value },
                  );
                }}
                inputMode="text"
                placeholder={values.kind === "timed" ? "1:30" : "2 km"}
                className="min-h-12 bg-transparent py-1 text-center font-mono text-metric font-medium tracking-[-0.03em] outline-none"
              />
            </label>
          )}
          <Stepper
            id="manual-weight"
            label={`Weight · ${unit}`}
            value={values.weight}
            inputMode="decimal"
            decreaseLabel={`${weightStep} ${unit} less`}
            increaseLabel={`${weightStep} ${unit} more`}
            stepSize={weightStep}
            onChange={(weight) => {
              setDirty(true);
              setValues({ ...values, weight, weightLb: null });
            }}
            onStep={(delta) => {
              setDirty(true);
              setValues({
                ...values,
                weightLb: null,
                weight: step(values.weight, delta, 0, maxDisplayWeight(unit), (value) =>
                  parseDisplayWeight(value, unit),
                ),
              });
            }}
          />
          {values.kind === "distance" ? (
            <label className="col-span-2 flex flex-col gap-1.5 rounded-2xl border border-input bg-background p-3">
              <span className="text-xs font-medium tracking-[0.06em] text-subtle uppercase">
                Time, optional
              </span>
              <input
                value={values.duration}
                onChange={(event) => {
                  setDirty(true);
                  setValues({ ...values, duration: event.target.value });
                }}
                inputMode="text"
                placeholder="7:30"
                className="min-h-12 bg-transparent py-1 text-center font-mono text-2xl font-medium outline-none"
              />
            </label>
          ) : null}
          {values.kind !== "strength" || values.calories.trim().length > 0 ? (
            <label className="col-span-2 flex flex-col gap-1.5 rounded-2xl border border-input bg-background p-3">
              <span className="text-xs font-medium tracking-[0.06em] text-subtle uppercase">
                Calories, optional
              </span>
              <input
                value={values.calories}
                onChange={(event) => {
                  setDirty(true);
                  setValues({ ...values, calories: event.target.value });
                }}
                inputMode="numeric"
                placeholder="450"
                aria-label="Calories"
                className="min-h-12 bg-transparent py-1 text-center font-mono text-metric font-medium outline-none"
              />
            </label>
          ) : null}
          <label className="col-span-2 flex items-center justify-between gap-3 rounded-2xl border border-input bg-background px-3 py-2">
            <span className="shrink-0 text-xs font-medium tracking-[0.06em] text-subtle uppercase">RPE</span>
            <input
              value={values.rpe}
              onChange={(event) => {
                setDirty(true);
                setValues({ ...values, rpe: event.target.value });
              }}
              inputMode="numeric"
              placeholder="Optional, 1–10"
              aria-label="RPE"
              className="h-12 min-w-0 flex-1 bg-transparent text-right font-mono text-lg outline-none"
            />
          </label>
        </div>

        {error ? (
          <p role="alert" className="mt-3 text-sm text-danger">
            {error}
          </p>
        ) : (
          <p className="mt-3 text-sm text-subtle">
            {history.label ? <span className="text-muted">{history.label}. </span> : null}
            {values.source === "session" ? "Filled in from your last set. " : null}
            {editing ? "This set stays where it is. " : null}
            Use 0 for bodyweight. Weights are in {unit}.
          </p>
        )}

        {suggestionLabel ? (
          <button
            type="button"
            onClick={acceptSuggestion}
            className="mt-3 min-h-11 self-start text-left text-base font-medium"
          >
            {suggestionLabel}
          </button>
        ) : null}

        <Button type="submit" size="lg" className="mt-5 w-full" disabled={pending}>
          {pending ? "Saving…" : editing ? "Save" : "Add set"}
        </Button>
        {editing && onDelete ? (
          <Button
            type="button"
            variant="danger"
            size="lg"
            className="mt-2 w-full"
            disabled={pending}
            onClick={onDelete}
          >
            Delete set
          </Button>
        ) : null}
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
    "flex h-12 min-w-0 flex-1 items-center justify-center rounded-full border border-input bg-surface text-foreground hover:bg-fill-2";
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-2xl border border-input bg-background p-3">
      <label htmlFor={id} className="text-xs font-medium tracking-[0.06em] text-subtle uppercase">
        {label}
      </label>
      <input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        inputMode={inputMode}
        autoComplete="off"
        className="w-full min-w-0 bg-transparent py-1 text-center font-mono text-metric font-medium tracking-[-0.03em] text-foreground outline-none"
      />
      <div className="flex items-center gap-2">
        <button type="button" aria-label={decreaseLabel} onClick={() => onStep(-stepSize)} className={buttonClass}>
          <MinusIcon className="size-5" strokeWidth={1.8} />
        </button>
        <button type="button" aria-label={increaseLabel} onClick={() => onStep(stepSize)} className={buttonClass}>
          <PlusIcon className="size-5" strokeWidth={1.8} />
        </button>
      </div>
    </div>
  );
}
