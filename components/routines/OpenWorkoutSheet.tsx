"use client";

import { Button } from "@/components/Button";
import { Sheet } from "@/components/Sheet";

export function OpenWorkoutSheet({
  open,
  onContinue,
  onClose,
}: {
  open: boolean;
  onContinue: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} labelledBy="open-workout-title">
      <h2 id="open-workout-title" className="mt-2 text-xl font-semibold tracking-[-0.02em]">
        A workout is already open
      </h2>
      <p className="mt-1.5 text-base leading-normal text-muted">
        Finish or discard that one before starting another. Nothing new was created.
      </p>
      <div className="mt-6 flex gap-2.5">
        <Button variant="secondary" size="lg" className="flex-1" onClick={onClose}>
          Not now
        </Button>
        <Button size="lg" className="flex-1" onClick={onContinue}>
          Continue
        </Button>
      </div>
    </Sheet>
  );
}
