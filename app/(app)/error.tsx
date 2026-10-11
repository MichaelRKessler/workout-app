"use client";

import { Button } from "@/components/Button";

export default function AppError({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <section className="flex min-h-[70dvh] flex-col justify-center gap-4 px-5">
      <h1 className="text-[28px] leading-tight font-semibold tracking-[-0.025em]">
        Something went wrong
      </h1>
      <p role="alert" className="text-[15px] leading-normal text-muted">
        {error.message}
      </p>
      <Button size="lg" className="self-start" onClick={reset}>
        Try again
      </Button>
    </section>
  );
}
