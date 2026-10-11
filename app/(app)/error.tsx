"use client";

import { Button } from "@/components/Button";
import { errorPageMessage } from "@/lib/errors";

export default function AppError({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <section className="flex min-h-[70dvh] flex-col justify-center gap-4 px-5">
      <h1 className="text-3xl leading-tight font-semibold tracking-[-0.025em]">
        Something went wrong
      </h1>
      <p role="alert" className="text-base leading-normal text-muted">
        {errorPageMessage(error)}
      </p>
      <Button size="lg" className="self-start" onClick={reset}>
        Try again
      </Button>
    </section>
  );
}
