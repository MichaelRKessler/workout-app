"use client";

import { OpenWorkoutSheet } from "@/components/routines/OpenWorkoutSheet";
import { useBeginWorkout } from "@/components/routines/useBeginWorkout";
import { useOfflineLog } from "@/components/OfflineSync";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { readableError } from "@/lib/errors";
import { stashToast } from "@/lib/pendingToast";
import { useMutation, useQuery } from "convex/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * Home-screen shortcuts land here. The installed manifest can only list fixed
 * links, so a named routine uses /start?routine=<id> instead of its own shortcut.
 */
export function StartShortcut() {
  const params = useSearchParams();
  const router = useRouter();
  const openSession = useQuery(api.sessions.getOpen);
  const latest = useQuery(api.sessions.latestCompleted);
  const start = useMutation(api.sessions.start);
  const repeat = useMutation(api.sessions.repeat);
  const begin = useBeginWorkout();
  const { offline, snapshot } = useOfflineLog();
  const ran = useRef(false);

  const action = params.get("action");
  const routineId = params.get("routine");

  useEffect(() => {
    if (ran.current || begin.promptOpen) {
      return;
    }
    if (routineId) {
      if (!offline && openSession === undefined) {
        return;
      }
      ran.current = true;
      void begin.startRoutine(routineId);
      return;
    }
    if (action === "repeat") {
      if (!offline && (openSession === undefined || latest === undefined)) {
        return;
      }
      ran.current = true;
      void repeatLast();
      return;
    }
    if (!offline && openSession === undefined) {
      return;
    }
    ran.current = true;
    void startNew();

    async function startNew() {
      if (offline) {
        stashToast(
          snapshot?.session
            ? "Continuing your open workout."
            : "Starting from the icon needs a connection. You can still add a set by hand.",
        );
        router.replace("/");
        return;
      }
      if (openSession) {
        stashToast("Continuing your open workout.");
        router.replace("/");
        return;
      }
      try {
        await start({});
      } catch (caught) {
        stashToast(readableError(caught));
      }
      router.replace("/");
    }

    async function repeatLast() {
      if (offline) {
        stashToast("Repeat last workout needs a connection.");
        router.replace("/");
        return;
      }
      if (openSession) {
        stashToast("You already have a workout open.");
        router.replace("/");
        return;
      }
      if (!latest) {
        stashToast("No finished workout to repeat yet.");
        router.replace("/");
        return;
      }
      try {
        const result = await repeat({ sessionIds: [latest._id as Id<"sessions">] });
        if (result.status === "alreadyOpen") {
          stashToast("You already have a workout open.");
        }
      } catch (caught) {
        stashToast(readableError(caught));
      }
      router.replace("/");
    }
  }, [
    action,
    begin,
    latest,
    offline,
    openSession,
    repeat,
    routineId,
    router,
    snapshot?.session,
    start,
  ]);

  return (
    <div className="px-5 pt-8">
      <p className="text-base text-muted">Opening your workout…</p>
      {begin.error ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          {begin.error}
        </p>
      ) : null}
      <OpenWorkoutSheet
        open={begin.promptOpen}
        onClose={() => {
          begin.closePrompt();
          router.replace("/");
        }}
        onContinue={begin.continueOpen}
      />
    </div>
  );
}
