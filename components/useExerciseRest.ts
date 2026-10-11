"use client";

import { useOfflineLog } from "@/components/OfflineSync";
import { api } from "@/convex/_generated/api";
import {
  clearPendingRest,
  pendingRestForName,
  readRememberedRest,
  rememberRest,
} from "@/lib/exerciseRest";
import { browserStore } from "@/lib/offline/storage";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";

/** Account rest for one exercise, with the on-device value used while offline. */
export function useExerciseRest(name: string | null) {
  const server = useQuery(api.exercises.restForName, name ? { name } : "skip");
  const setRest = useMutation(api.exercises.setRest);
  const { offline, queueExerciseRest } = useOfflineLog();
  const [local, setLocal] = useState<number | null | undefined>(undefined);

  useEffect(() => {
    if (!name) {
      setLocal(undefined);
      return;
    }
    const store = browserStore();
    const pending = pendingRestForName(store, name);
    if (pending !== undefined) {
      setLocal(pending);
      return;
    }
    setLocal(readRememberedRest(store, name));
  }, [name]);

  useEffect(() => {
    if (!name || server === undefined) {
      return;
    }
    if (pendingRestForName(browserStore(), name) !== undefined) {
      return;
    }
    rememberRest(browserStore(), name, server);
    setLocal(server);
  }, [name, server]);

  const restSeconds = local !== undefined ? local : server !== undefined ? server : null;

  async function save(seconds: number | null) {
    if (!name) {
      return;
    }
    const store = browserStore();
    rememberRest(store, name, seconds);
    setLocal(seconds);
    if (offline) {
      queueExerciseRest(name, seconds);
      return;
    }
    try {
      await setRest({ name, restSeconds: seconds });
      clearPendingRest(store, name);
    } catch {
      queueExerciseRest(name, seconds);
    }
  }

  return { restSeconds, save };
}
