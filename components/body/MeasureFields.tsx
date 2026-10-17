"use client";

import type { LengthUnit } from "@/convex/lib/bodyMeasures";
import type { WeightUnit } from "@/convex/lib/units";
import type { BodyDraft } from "@/lib/bodyDraft";
import type { ReactNode } from "react";

export function MeasureFields({
  idPrefix,
  draft,
  maxDate,
  weightUnit,
  lengthUnit,
  extraOpen = false,
  weightPlaceholder,
  onChange,
}: {
  idPrefix: string;
  draft: BodyDraft;
  maxDate: string;
  weightUnit: WeightUnit;
  lengthUnit: LengthUnit;
  extraOpen?: boolean;
  /** Your last weight, so the empty field hints at a real number. */
  weightPlaceholder?: string;
  onChange: (patch: Partial<BodyDraft>) => void;
}) {
  return (
    <div className="mt-3 flex flex-col gap-3">
      <Field label="Date" id={`${idPrefix}-date`}>
        <input
          id={`${idPrefix}-date`}
          type="date"
          required
          max={maxDate}
          value={draft.date}
          onChange={(event) => onChange({ date: event.target.value })}
          className={fieldClass}
        />
      </Field>
      <Field label={`Weight (${weightUnit})`} id={`${idPrefix}-weight`}>
        <input
          id={`${idPrefix}-weight`}
          inputMode="decimal"
          autoComplete="off"
          placeholder={weightPlaceholder ?? (weightUnit === "kg" ? "80" : "180")}
          value={draft.weight}
          onChange={(event) => onChange({ weight: event.target.value })}
          className={fieldClass}
        />
      </Field>
      <details open={extraOpen || undefined} className="rounded-xl border border-line px-3 py-1">
        <summary className="flex min-h-11 cursor-pointer items-center text-base font-medium">
          More measurements
        </summary>
        <div className="flex flex-col gap-3 pb-3">
          <Field label="Body fat (%)" id={`${idPrefix}-fat`}>
            <input
              id={`${idPrefix}-fat`}
              inputMode="decimal"
              autoComplete="off"
              value={draft.bodyFat}
              onChange={(event) => onChange({ bodyFat: event.target.value })}
              className={fieldClass}
            />
          </Field>
          <LengthField
            id={`${idPrefix}-waist`}
            label="Waist"
            unit={lengthUnit}
            value={draft.waist}
            onChange={(waist) => onChange({ waist })}
          />
          <LengthField
            id={`${idPrefix}-chest`}
            label="Chest"
            unit={lengthUnit}
            value={draft.chest}
            onChange={(chest) => onChange({ chest })}
          />
          <LengthField
            id={`${idPrefix}-arm`}
            label="Arm"
            unit={lengthUnit}
            value={draft.arm}
            onChange={(arm) => onChange({ arm })}
          />
          <LengthField
            id={`${idPrefix}-hips`}
            label="Hips"
            unit={lengthUnit}
            value={draft.hips}
            onChange={(hips) => onChange({ hips })}
          />
          <LengthField
            id={`${idPrefix}-thigh`}
            label="Thigh"
            unit={lengthUnit}
            value={draft.thigh}
            onChange={(thigh) => onChange({ thigh })}
          />
          <Field label="Note" id={`${idPrefix}-note`}>
            <input
              id={`${idPrefix}-note`}
              autoComplete="off"
              maxLength={500}
              value={draft.note}
              onChange={(event) => onChange({ note: event.target.value })}
              className={fieldClass}
            />
          </Field>
        </div>
      </details>
    </div>
  );
}

function LengthField({
  id,
  label,
  unit,
  value,
  onChange,
}: {
  id: string;
  label: string;
  unit: LengthUnit;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field label={`${label} (${unit})`} id={id}>
      <input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={fieldClass}
      />
    </Field>
  );
}

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <label htmlFor={id} className="block">
      <span className="text-xs font-medium tracking-[0.06em] text-subtle uppercase">{label}</span>
      {children}
    </label>
  );
}

const fieldClass =
  "mt-1.5 h-12 w-full rounded-xl border border-input bg-background px-3 text-base outline-none focus:border-foreground";
