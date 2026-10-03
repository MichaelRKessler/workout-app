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
    <section className="flex flex-col gap-4">
      <h1 className="text-3xl font-semibold tracking-tight">Something went wrong</h1>
      <p role="alert" className="text-sm leading-6 text-muted">
        {error.message}
      </p>
      <Button onClick={reset}>Try again</Button>
    </section>
  );
}
