"use client";

import { Button } from "@/components/Button";
import { Sheet } from "@/components/Sheet";

export function FinishSheet({
  open,
  summary,
  note,
  pending,
  error,
  workoutNote,
  onWorkoutNoteChange,
  onCancel,
  onFinish,
}: {
  open: boolean;
  summary: string;
  note?: string | null;
  pending: boolean;
  error: string | null;
  workoutNote?: string;
  onWorkoutNoteChange?: (note: string) => void;
  onCancel: () => void;
  onFinish: () => void;
}) {
  return (
    <Sheet open={open} onClose={onCancel} labelledBy="finish-title" dismissible={!pending}>
      <h2 id="finish-title" className="mt-2 text-xl font-semibold tracking-[-0.02em]">
        Finish workout?
      </h2>
      <p className="mt-1.5 text-[15px] text-muted">{summary}. It moves to History.</p>
      {note ? <p className="mt-2 text-[15px] leading-normal text-muted">{note}</p> : null}
      {onWorkoutNoteChange ? (
        <label className="mt-4 block">
          <span className="text-[11px] font-medium tracking-[0.1em] text-subtle uppercase">
            Note
          </span>
          <textarea
            value={workoutNote ?? ""}
            onChange={(event) => onWorkoutNoteChange(event.target.value)}
            maxLength={500}
            rows={3}
            placeholder="Optional. How the workout felt."
            className="mt-2 w-full resize-none rounded-xl border border-line bg-background px-3 py-2 text-[15px] outline-none focus:border-foreground"
          />
        </label>
      ) : null}
      {error ? (
        <p role="alert" className="mt-3 text-sm leading-5 text-danger">
          {error}
        </p>
      ) : null}
      <div className="mt-6 flex gap-2.5">
        <Button variant="secondary" size="lg" className="flex-1" onClick={onCancel} disabled={pending}>
          Keep going
        </Button>
        <Button size="lg" className="flex-1" onClick={onFinish} disabled={pending}>
          {pending ? "Saving…" : "Finish"}
        </Button>
      </div>
    </Sheet>
  );
}
