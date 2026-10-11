"use client";

import { setTypeLabel, type SetType } from "@/convex/lib/setType";

const OPTIONS: Array<{ id: SetType; label: string }> = [
  { id: "working", label: "Working" },
  { id: "warmup", label: "Warm-up" },
  { id: "drop", label: "Drop" },
  { id: "failure", label: "Failure" },
];

export function SetTypePicker({
  value,
  disabled = false,
  onChange,
}: {
  value: SetType;
  disabled?: boolean;
  onChange: (next: SetType) => void;
}) {
  return (
    <div role="group" aria-label="Set type" className="flex flex-wrap gap-1">
      {OPTIONS.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={value === option.id}
          disabled={disabled}
          onClick={() => onChange(option.id)}
          className={`min-h-11 rounded-full border border-line px-3 text-xs font-medium disabled:opacity-50 ${
            value === option.id ? "bg-inverse text-inverse-ink" : "text-muted"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** Small tag beside a set. Working sets stay unlabeled. */
export function SetTypeTag({ setType }: { setType?: string | null }) {
  const label = setTypeLabel(setType);
  if (!label) {
    return null;
  }
  return <span className="ml-1 font-sans text-xs tracking-normal text-muted">{label}</span>;
}
