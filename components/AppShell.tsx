"use client";

import { BrandMark } from "@/components/icons";
import { useConvexAuth } from "convex/react";
import Link from "next/link";
import { ReactNode } from "react";

export function AppShell({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useConvexAuth();

  if (isLoading) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-lg items-center justify-center px-5">
        <p className="text-[15px] text-muted">Loading your workouts…</p>
      </main>
    );
  }

  if (!isAuthenticated) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col justify-center gap-6 px-5">
        <BrandMark className="size-8" />
        <h1 className="text-[30px] leading-tight font-semibold tracking-[-0.025em]">
          Sign in to log a workout.
        </h1>
        <Link
          href="/signin"
          className="inline-flex min-h-[52px] items-center justify-center rounded-full bg-inverse px-6 font-semibold text-inverse-ink"
        >
          Sign in with Google
        </Link>
      </main>
    );
  }

  return <main className="mx-auto min-h-dvh w-full max-w-lg">{children}</main>;
}
