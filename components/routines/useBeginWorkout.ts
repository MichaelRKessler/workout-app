"use client";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useOfflineLog } from "@/components/OfflineSync";
import { readableError } from "@/lib/errors";
import {
  loadRoutineCache,
  publishPendingPlan,
  type CachedRoutine,
} from "@/lib/offline/routineCache";
import { cacheStore, loadCachedAccess } from "@/lib/offline/storage";
import { useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

function useViewerEmail(): string | null {
  const status = useQuery(api.access.myStatus);
  const [cached, setCached] = useState<string | null>(null);
  useEffect(() => {
    setCached(loadCachedAccess(cacheStore())?.email ?? null);
  }, []);
  return status?.email ?? cached;
}

export function useBeginWorkout() {
  const begin = useMutation(api.routines.begin);
  const repeat = useMutation(api.sessions.repeat);
  const log = useOfflineLog();
  const email = useViewerEmail();
  const router = useRouter();
  const [promptOpen, setPromptOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const continueOpen = useCallback(() => {
    setPromptOpen(false);
    router.push("/");
  }, [router]);

  const closePrompt = useCallback(() => setPromptOpen(false), []);
  const clearError = useCallback(() => setError(null), []);

  async function startRoutine(routineId: string) {
    setError(null);
    if (log.offline) {
      if (log.snapshot?.session) {
        setPromptOpen(true);
        return;
      }
      const cached = loadRoutineCache(cacheStore(), email)?.find(
        (routine) => routine._id === routineId,
      );
      if (!cached || cached.exercises.length === 0) {
        setError("You're offline. Reconnect to start this routine.");
        return;
      }
      startCached(cached);
      return;
    }
    setPending(true);
    try {
      const result = await begin({ routineId: routineId as Id<"routines"> });
      if (result.status === "alreadyOpen") {
        setPromptOpen(true);
        return;
      }
      publishPendingPlan(cacheStore(), email, null);
      router.push("/");
    } catch (caught) {
      setError(readableError(caught));
    } finally {
      setPending(false);
    }
  }

  function startCached(routine: CachedRoutine) {
    publishPendingPlan(cacheStore(), email, {
      startedAt: Date.now(),
      name: routine.name,
      routineId: routine._id,
      exercises: routine.exercises.map((exercise) => ({ ...exercise, skipped: false })),
    });
    router.push("/");
  }

  async function repeatWorkouts(sessionIds: string[]) {
    setError(null);
    if (log.offline) {
      setError("You're offline. Reconnect to repeat this workout.");
      return;
    }
    setPending(true);
    try {
      const result = await repeat({
        sessionIds: sessionIds as Id<"sessions">[],
      });
      if (result.status === "alreadyOpen") {
        setPromptOpen(true);
        return;
      }
      publishPendingPlan(cacheStore(), email, null);
      router.push("/");
    } catch (caught) {
      setError(readableError(caught));
    } finally {
      setPending(false);
    }
  }

  return {
    startRoutine,
    repeatWorkouts,
    promptOpen,
    closePrompt,
    continueOpen,
    pending,
    error,
    clearError,
  };
}
