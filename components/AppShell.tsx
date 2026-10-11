"use client";

import { NoAccess } from "@/components/NoAccess";
import { WeightUnitProvider } from "@/components/WeightUnit";
import { BrandMark } from "@/components/icons";
import { api } from "@/convex/_generated/api";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { ReactNode, useEffect } from "react";

export function AppShell({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const status = useQuery(api.access.myStatus, isAuthenticated ? {} : "skip");

  if (isLoading || (isAuthenticated && status === undefined)) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-lg items-center justify-center px-5">
        <p className="text-[15px] text-muted">Loading your workouts…</p>
      </main>
    );
  }

  if (!isAuthenticated || status === undefined) {
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

  if (!status.allowed) {
    return (
      <main className="mx-auto min-h-dvh w-full max-w-lg">
        <NoAccess status={status} />
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-dvh w-full max-w-lg">
      <AdminSeed />
      <WeightUnitProvider>{children}</WeightUnitProvider>
    </main>
  );
}

/** Inserts the admin allow-list row once the admin is in the app. */
function AdminSeed() {
  const status = useQuery(api.access.myStatus);
  const ensureAdmin = useMutation(api.access.ensureAdmin);

  useEffect(() => {
    if (!status?.isAdmin) {
      return;
    }
    void ensureAdmin({}).catch(() => undefined);
  }, [ensureAdmin, status?.isAdmin]);

  return null;
}
