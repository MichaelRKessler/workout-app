"use client";

import { useOfflineLog } from "@/components/OfflineSync";
import { api } from "@/convex/_generated/api";
import {
  clearPendingRest,
  pendingRestForName,
  readRememberedRest,
  rememberRest,
} from "@/lib/exerciseRest";
import { browserStore, OfflineStorageError } from "@/lib/offline/storage";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";

/** Account rest for one exercise, with the on-device value used while offline. */
export function useExerciseRest(name: string | null) {
  const server = useQuery(api.exercises.restForName, name ? { name } : "skip");
  const setRest = useMutation(api.exercises.setRest);
  const { offline, queueExerciseRest, accountEmail } = useOfflineLog();
  const [local, setLocal] = useState<number | null | undefined>(undefined);

  useEffect(() => {
    if (!name) {
      setLocal(undefined);
      return;
    }
    const store = browserStore();
    try {
      const pending = pendingRestForName(store, accountEmail, name);
      if (pending !== undefined) {
        setLocal(pending);
        return;
      }
      setLocal(readRememberedRest(store, accountEmail, name));
    } catch (error) {
      if (!(error instanceof OfflineStorageError)) {
        throw error;
      }
      setLocal(undefined);
    }
  }, [accountEmail, name]);

  useEffect(() => {
    if (!name || server === undefined) {
      return;
    }
    try {
      if (pendingRestForName(browserStore(), accountEmail, name) !== undefined) {
        return;
      }
      rememberRest(browserStore(), accountEmail, name, server);
    } catch (error) {
      if (!(error instanceof OfflineStorageError)) {
        throw error;
      }
    }
    setLocal(server);
  }, [accountEmail, name, server]);

  const restSeconds = local !== undefined ? local : server !== undefined ? server : null;

  async function save(seconds: number | null) {
    if (!name) {
      return;
    }
    const store = browserStore();
    let stored = true;
    try {
      rememberRest(store, accountEmail, name, seconds);
    } catch (error) {
      stored = false;
      if (!(error instanceof OfflineStorageError)) {
        throw error;
      }
    }
    setLocal(seconds);
    if (offline) {
      queueExerciseRest(name, seconds);
      return;
    }
    try {
      await setRest({ name, restSeconds: seconds });
      if (stored) {
        clearPendingRest(store, accountEmail, name);
      }
    } catch {
      queueExerciseRest(name, seconds);
    }
  }

  return { restSeconds, save };
}
