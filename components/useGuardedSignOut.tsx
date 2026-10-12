"use client";

import { Button } from "@/components/Button";
import { useOfflineLog } from "@/components/OfflineSync";
import { Sheet } from "@/components/Sheet";
import { readableError } from "@/lib/errors";
import { pluralize } from "@/lib/format";
import { resolveSignOut, type SignOutDecision } from "@/lib/offline/signOut";
import {
  browserStore,
  clearOfflineStorage,
  resumeOfflineWrites,
  suspendOfflineWrites,
} from "@/lib/offline/storage";
import { clearShellCache } from "@/lib/pwa/clearShellCache";
import { useAuthActions } from "@convex-dev/auth/react";
import { useRouter } from "next/navigation";
import { ReactNode, useRef, useState } from "react";

type Phase = "idle" | "syncing" | "warning" | "leaving";

type Blocked = Extract<SignOutDecision, { action: "confirm-discard" }>;

/**
 * Sign out only after the on-device queue is empty, or the person confirms
 * those changes should be discarded. Dismissing the warning stays signed in.
 */
export function useGuardedSignOut(): {
  busy: boolean;
  buttonLabel: string;
  error: string | null;
  onSignOut: () => void;
  dialog: ReactNode;
} {
  const { signOut } = useAuthActions();
  const router = useRouter();
  const { offline, readPending, syncPending } = useOfflineLog();
  const [phase, setPhase] = useState<Phase>("idle");
  const [blocked, setBlocked] = useState<Blocked | null>(null);
  const [error, setError] = useState<string | null>(null);
  const deciding = useRef(false);
  const leaving = useRef(false);

  async function leave() {
    if (leaving.current) {
      return;
    }
    leaving.current = true;
    setPhase("leaving");
    setError(null);
    suspendOfflineWrites();
    try {
      await signOut();
    } catch (caught) {
      resumeOfflineWrites();
      setError(readableError(caught));
      setPhase(blocked ? "warning" : "idle");
      leaving.current = false;
      return;
    }
    clearOfflineStorage(browserStore());
    try {
      await clearShellCache();
    } catch {
      // The session is already signed out. Sign-in is still the right page.
    }
    router.replace("/signin");
    leaving.current = false;
  }

  async function onSignOut() {
    if (deciding.current || leaving.current || phase === "syncing" || phase === "leaving" || phase === "warning") {
      return;
    }
    deciding.current = true;
    setError(null);
    try {
      const pendingCount = readPending();
      if (pendingCount > 0 && !offline) {
        setPhase("syncing");
      } else if (pendingCount === 0) {
        setPhase("leaving");
      }
      const decision = await resolveSignOut({
        pendingCount,
        offline,
        sync: syncPending,
      });
      if (decision.action === "sign-out") {
        await leave();
        return;
      }
      setBlocked(decision);
      setPhase("warning");
    } finally {
      deciding.current = false;
    }
  }

  function stay() {
    if (phase === "leaving") {
      return;
    }
    setBlocked(null);
    setPhase("idle");
  }

  const pendingCount = blocked?.pendingCount ?? 0;
  const changes = pluralize(pendingCount, "change");
  const confirming = blocked !== null && (phase === "warning" || phase === "leaving");
  const dialog = (
    <Sheet
      open={confirming}
      onClose={stay}
      labelledBy="sign-out-title"
      dismissible={phase !== "leaving"}
    >
      <h2 id="sign-out-title" className="mt-2 text-xl font-semibold tracking-[-0.02em]">
        Unsynced changes
      </h2>
      <p className="mt-1.5 text-base leading-normal text-muted">
        {blocked?.offline
          ? `${changes} ${pendingCount === 1 ? "is" : "are"} still on this phone. You're offline, so they can't sync. Stay signed in to keep them.`
          : `${changes} still ${pendingCount === 1 ? "hasn't" : "haven't"} synced. Stay signed in to keep them, or they'll be discarded.`}
      </p>
      {error ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      ) : null}
      <div className="mt-6 flex flex-col gap-2.5">
        <Button size="lg" className="w-full" onClick={stay} disabled={phase === "leaving"}>
          Stay signed in
        </Button>
        <Button
          variant="danger"
          size="lg"
          className="w-full border border-danger"
          onClick={() => void leave()}
          disabled={phase === "leaving"}
        >
          {phase === "leaving" ? "Signing out…" : `Sign out and discard ${changes}`}
        </Button>
      </div>
    </Sheet>
  );

  return {
    busy: phase === "syncing" || phase === "leaving",
    buttonLabel:
      phase === "syncing" ? "Saving changes…" : phase === "leaving" ? "Signing out…" : "Sign out",
    error,
    onSignOut: () => void onSignOut(),
    dialog,
  };
}
