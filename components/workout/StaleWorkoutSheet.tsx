"use client";

import { Button } from "@/components/Button";
import { Sheet } from "@/components/Sheet";
import { STALE_END_MARGIN_MS } from "@/convex/lib/sessionTiming";
import { formatDuration } from "@/lib/format";

export function StaleWorkoutSheet({
  open,
  idleMs,
  finishing,
  keeping,
  error,
  onKeepGoing,
  onFinish,
}: {
  open: boolean;
  idleMs: number;
  finishing: boolean;
  keeping: boolean;
  error: string | null;
  onKeepGoing: () => void;
  onFinish: () => void;
}) {
  const idle = formatDuration(idleMs);
  const margin = formatDuration(STALE_END_MARGIN_MS);
  const pending = finishing || keeping;

  return (
    <Sheet open={open} onClose={() => undefined} labelledBy="stale-title" dismissible={false}>
      <h2 id="stale-title" className="mt-2 text-xl font-semibold tracking-[-0.02em]">
        Still working out?
      </h2>
      <p className="mt-1.5 text-base leading-normal text-muted">
        Your last set was {idle} ago. The timer kept running. Finish saves this workout as ending{" "}
        {margin} after that set, so the idle time stays out of History.
      </p>
      {error ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      ) : null}
      <div className="mt-6 flex gap-2.5">
        <Button
          variant="secondary"
          size="lg"
          className="flex-1"
          onClick={onKeepGoing}
          disabled={pending}
        >
          {keeping ? "Saving…" : "Keep going"}
        </Button>
        <Button size="lg" className="flex-1" onClick={onFinish} disabled={pending}>
          {finishing ? "Saving…" : "Finish"}
        </Button>
      </div>
    </Sheet>
  );
}
