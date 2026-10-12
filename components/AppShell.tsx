"use client";

import { NoAccess } from "@/components/NoAccess";
import { OfflineBanner, OfflineSyncProvider } from "@/components/OfflineSync";
import { useConnectivity } from "@/components/useConnectivity";
import { WeightUnitProvider } from "@/components/WeightUnit";
import { BrandMark } from "@/components/icons";
import { clearShellCache } from "@/lib/pwa/clearShellCache";
import { api } from "@/convex/_generated/api";
import {
  cacheStore,
  loadCachedAccess,
  resumeOfflineWrites,
  saveCachedAccess,
  type CachedAccess,
} from "@/lib/offline/storage";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { ReactNode, useEffect, useRef, useState } from "react";

export function AppShell({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { offline } = useConnectivity();
  const status = useQuery(api.access.myStatus, isAuthenticated ? {} : "skip");
  const [cached, setCached] = useState<CachedAccess | null>(null);
  const [cacheReady, setCacheReady] = useState(false);

  useEffect(() => {
    setCached(loadCachedAccess(cacheStore()));
    setCacheReady(true);
  }, []);

  useEffect(() => {
    if (!status) {
      return;
    }
    const next: CachedAccess = {
      email: status.email,
      name: status.name,
      allowed: status.allowed,
      isAdmin: status.isAdmin,
      request: status.request,
    };
    saveCachedAccess(cacheStore(), next);
    setCached(next);
  }, [status]);

  useEffect(() => {
    if (isAuthenticated) {
      resumeOfflineWrites();
    }
  }, [isAuthenticated]);

  // Any sign-out clears cached pages, not only the Sign out button: an expired
  // session lands here too. Offline, auth can drop without a sign-out, so the
  // cache stays until the connection is back.
  const wasAuthenticated = useRef(false);
  useEffect(() => {
    if (isLoading) {
      return;
    }
    if (isAuthenticated) {
      wasAuthenticated.current = true;
      return;
    }
    if (wasAuthenticated.current && !offline) {
      wasAuthenticated.current = false;
      void clearShellCache().catch(() => undefined);
    }
  }, [isAuthenticated, isLoading, offline]);

  const useCache =
    offline &&
    cacheReady &&
    cached !== null &&
    status === undefined &&
    (isLoading || isAuthenticated);
  const effective = status ?? (useCache ? cached : null);

  if (!useCache && (isLoading || (isAuthenticated && status === undefined))) {
    if (offline && isAuthenticated && cacheReady && !cached) {
      return (
        <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col justify-center gap-3 px-5">
          <BrandMark className="size-8" />
          <p className="text-base leading-normal text-muted">
            You&apos;re offline. Open Workout once with a connection before logging here.
          </p>
        </main>
      );
    }
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-lg items-center justify-center px-5">
        <p className="text-base text-muted">Loading your workouts…</p>
      </main>
    );
  }

  if (!isAuthenticated || !effective) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col justify-center gap-6 px-5">
        <BrandMark className="size-8" />
        <h1 className="text-3xl leading-tight font-semibold tracking-[-0.025em]">
          Sign in to log a workout.
        </h1>
        {offline ? <p className="text-base text-muted">Sign-in needs a connection.</p> : null}
        <Link
          href="/signin"
          className="inline-flex min-h-13 items-center justify-center rounded-full bg-inverse px-6 text-base font-semibold text-inverse-ink"
        >
          Sign in with Google
        </Link>
      </main>
    );
  }

  if (!effective.allowed) {
    return (
      <main className="mx-auto min-h-dvh w-full max-w-lg">
        <OfflineSyncProvider email={effective.email} autoSync={false}>
          <NoAccess status={effective} />
        </OfflineSyncProvider>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-dvh w-full max-w-lg">
      <OfflineSyncProvider email={effective.email}>
        <WeightUnitProvider>
          <OfflineBanner />
          <AdminSeed />
          {children}
        </WeightUnitProvider>
      </OfflineSyncProvider>
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
