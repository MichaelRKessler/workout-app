"use client";

import { Button } from "@/components/Button";
import { Sheet } from "@/components/Sheet";

export function FinishSheet({
  open,
  summary,
  note,
  pending,
  error,
  onCancel,
  onFinish,
}: {
  open: boolean;
  summary: string;
  note?: string | null;
  pending: boolean;
  error: string | null;
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
