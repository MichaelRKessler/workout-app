"use client";

import { Button } from "@/components/Button";
import { Sheet } from "@/components/Sheet";

export function DeleteWorkoutSheet({
  open,
  summary,
  pending,
  error,
  onCancel,
  onConfirm,
  title = "Delete this workout?",
  body,
  confirmLabel = "Delete workout",
  cancelLabel = "Keep workout",
}: {
  open: boolean;
  summary: string;
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
  title?: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}) {
  const message =
    body ??
    `This permanently deletes the workout from ${summary} and every set in it. This can't be undone.`;
  return (
    <Sheet open={open} onClose={onCancel} labelledBy="delete-workout-title" dismissible={!pending}>
      <h2 id="delete-workout-title" className="mt-2 text-xl font-semibold tracking-[-0.02em]">
        {title}
      </h2>
      <p className="mt-1.5 text-base leading-normal text-muted">{message}</p>
      {error ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      ) : null}
      <div className="mt-6 flex gap-2.5">
        <Button variant="secondary" size="lg" className="flex-1" onClick={onCancel} disabled={pending}>
          {cancelLabel}
        </Button>
        <Button
          variant="danger"
          size="lg"
          className="flex-1 border border-danger"
          onClick={onConfirm}
          disabled={pending}
        >
          {pending ? "Deleting…" : confirmLabel}
        </Button>
      </div>
    </Sheet>
  );
}
