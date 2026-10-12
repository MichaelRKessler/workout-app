"use client";

import { SetTypePicker } from "@/components/SetTypePicker";
import type { SetKind } from "@/convex/lib/measures";
import type { SetType } from "@/convex/lib/setType";
import type { WeightUnit } from "@/convex/lib/units";

/**
 * The fields of one set, shared by the voice confirm sheet and past workouts.
 * Values stay text until `parseSetInput` reads them, so both forms accept the
 * same input and show the same messages.
 */
export type SetFieldValues = {
  reps: string;
  weight: string;
  duration: string;
  distance: string;
  calories: string;
  rpe: string;
  setType: SetType;
};

const fieldClass =
  "h-12 w-full min-w-0 rounded-xl border border-input bg-background text-center font-mono text-lg font-medium text-foreground outline-none focus:border-foreground disabled:opacity-60";

const KIND_OPTIONS: ReadonlyArray<{ id: SetKind; label: string }> = [
  { id: "strength", label: "Reps" },
  { id: "timed", label: "Time" },
  { id: "distance", label: "Distance" },
];

export function KindSwitch({
  kind,
  disabled = false,
  label = "How this set is measured",
  className = "",
  onChange,
}: {
  kind: SetKind;
  disabled?: boolean;
  label?: string;
  className?: string;
  onChange: (kind: SetKind) => void;
}) {
  return (
    <div role="group" aria-label={label} className={`flex rounded-full border border-input p-0.5 ${className}`}>
      {KIND_OPTIONS.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={kind === option.id}
          disabled={disabled}
          onClick={() => onChange(option.id)}
          className={`min-h-11 flex-1 rounded-full px-1.5 text-sm font-medium whitespace-nowrap disabled:opacity-50 ${
            kind === option.id ? "bg-inverse text-inverse-ink" : "text-muted"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** Reps, or time or distance, and weight: what a set row always shows. */
export function SetMeasureFields({
  kind,
  values,
  unit,
  disabled = false,
  labelPrefix,
  onChange,
}: {
  kind: SetKind;
  values: Pick<SetFieldValues, "reps" | "weight" | "duration" | "distance">;
  unit: WeightUnit;
  disabled?: boolean;
  /** Spoken before each label when several sets share a screen, like "Set 2". */
  labelPrefix?: string;
  onChange: (patch: Partial<SetFieldValues>) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {kind === "strength" ? (
        <SetField
          label="Reps"
          labelPrefix={labelPrefix}
          value={values.reps}
          inputMode="numeric"
          disabled={disabled}
          onChange={(reps) => onChange({ reps })}
        />
      ) : (
        <SetField
          label={kind === "distance" ? "Distance" : "Time"}
          labelPrefix={labelPrefix}
          value={kind === "distance" ? values.distance : values.duration}
          placeholder={kind === "distance" ? "2 km" : "1:30"}
          inputMode="text"
          disabled={disabled}
          onChange={(value) => onChange(kind === "distance" ? { distance: value } : { duration: value })}
        />
      )}
      <SetField
        label={`Weight · ${unit}`}
        spoken={`Weight in ${unit}`}
        labelPrefix={labelPrefix}
        value={values.weight}
        inputMode="decimal"
        disabled={disabled}
        onChange={(weight) => onChange({ weight })}
      />
      {kind === "distance" ? (
        <SetField
          label="Time"
          labelPrefix={labelPrefix}
          value={values.duration}
          placeholder="Optional"
          inputMode="text"
          disabled={disabled}
          onChange={(duration) => onChange({ duration })}
        />
      ) : null}
    </div>
  );
}

/** Set type, RPE, and calories: the details most sets leave alone. */
export function SetExtraFields({
  values,
  disabled = false,
  labelPrefix,
  onChange,
}: {
  values: Pick<SetFieldValues, "rpe" | "calories" | "setType">;
  disabled?: boolean;
  labelPrefix?: string;
  onChange: (patch: Partial<SetFieldValues>) => void;
}) {
  return (
    <>
      <SetTypePicker value={values.setType} disabled={disabled} onChange={(setType) => onChange({ setType })} />
      <div className="grid grid-cols-2 gap-2">
        <SetField
          label="RPE"
          labelPrefix={labelPrefix}
          value={values.rpe}
          placeholder="Optional"
          inputMode="numeric"
          disabled={disabled}
          onChange={(rpe) => onChange({ rpe })}
        />
        <SetField
          label="Calories"
          labelPrefix={labelPrefix}
          value={values.calories}
          placeholder="Optional"
          inputMode="numeric"
          disabled={disabled}
          onChange={(calories) => onChange({ calories })}
        />
      </div>
    </>
  );
}

function SetField({
  label,
  spoken = label,
  labelPrefix,
  value,
  placeholder,
  inputMode,
  disabled,
  onChange,
}: {
  label: string;
  /** What a screen reader says, when the visible label is shorthand. */
  spoken?: string;
  labelPrefix?: string;
  value: string;
  placeholder?: string;
  inputMode: "numeric" | "decimal" | "text";
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium tracking-[0.06em] text-subtle uppercase">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        inputMode={inputMode}
        placeholder={placeholder}
        autoComplete="off"
        disabled={disabled}
        aria-label={labelPrefix ? `${labelPrefix} ${spoken.toLowerCase()}` : spoken}
        className={fieldClass}
      />
    </label>
  );
}
