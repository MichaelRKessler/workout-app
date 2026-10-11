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
}: {
  open: boolean;
  summary: string;
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Sheet open={open} onClose={onCancel} labelledBy="delete-workout-title" dismissible={!pending}>
      <h2 id="delete-workout-title" className="mt-2 text-xl font-semibold tracking-[-0.02em]">
        Delete this workout?
      </h2>
      <p className="mt-1.5 text-base leading-normal text-muted">
        This permanently deletes the workout from {summary} and every set in it. This can&apos;t be undone.
      </p>
      {error ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      ) : null}
      <div className="mt-6 flex gap-2.5">
        <Button variant="secondary" size="lg" className="flex-1" onClick={onCancel} disabled={pending}>
          Keep workout
        </Button>
        <Button
          variant="danger"
          size="lg"
          className="flex-1 border border-danger"
          onClick={onConfirm}
          disabled={pending}
        >
          {pending ? "Deleting…" : "Delete workout"}
        </Button>
      </div>
    </Sheet>
  );
}
