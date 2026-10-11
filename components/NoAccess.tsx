"use client";

import { Button } from "@/components/Button";
import { BrandMark } from "@/components/icons";
import { InstallOffer } from "@/components/InstallOffer";
import { api } from "@/convex/_generated/api";
import { readableError } from "@/lib/errors";
import { browserStore, clearOfflineStorage } from "@/lib/offline/storage";
import { useAuthActions } from "@convex-dev/auth/react";
import { useMutation } from "convex/react";
import { FunctionReturnType } from "convex/server";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

type AccessStatus = FunctionReturnType<typeof api.access.myStatus>;

export function NoAccess({ status }: { status: AccessStatus }) {
  const requestAccess = useMutation(api.access.requestAccess);
  const { signOut } = useAuthActions();
  const router = useRouter();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const requestSent = status.request?.status === "pending";
  const denied = status.request?.status === "denied";

  async function onRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSending(true);
    setError(null);
    try {
      const trimmed = note.trim();
      await requestAccess(trimmed.length > 0 ? { note: trimmed } : {});
    } catch (caught) {
      setError(readableError(caught));
    } finally {
      setSending(false);
    }
  }

  async function onSignOut() {
    setSigningOut(true);
    clearOfflineStorage(browserStore());
    try {
      await signOut();
      router.replace("/signin");
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col px-5 pt-3 pb-[calc(24px+env(safe-area-inset-bottom))]">
      <div className="flex min-h-11 items-center gap-2.5">
        <BrandMark />
        <span className="text-lg font-semibold tracking-[-0.01em]">Workout</span>
      </div>
      <div className="flex flex-1 flex-col justify-center py-10">
        <h1 className="text-4xl leading-[1.1] font-semibold tracking-[-0.03em] text-balance">
          You don&apos;t have access yet
        </h1>
        <p className="mt-4 max-w-[25.5rem] text-base leading-normal text-pretty text-muted">
          {status.email
            ? `${status.email} can sign in, but this workout log is limited to approved accounts.`
            : "This workout log is limited to approved accounts."}{" "}
          Request access and you can log workouts after it&apos;s approved.
        </p>

        {requestSent ? (
          <p className="mt-8 rounded-[1.25rem] border border-line bg-surface px-4 py-4 text-base leading-normal" role="status">
            Request sent. You&apos;ll be able to use the app after it&apos;s approved.
          </p>
        ) : (
          <form onSubmit={(event) => void onRequest(event)} className="mt-8">
            {denied ? (
              <p className="mb-3 text-sm text-muted">
                The last request was denied. You can send another.
              </p>
            ) : null}
            <label htmlFor="access-note" className="text-xs font-medium tracking-[0.06em] text-subtle uppercase">
              Note <span className="tracking-normal normal-case">(optional)</span>
            </label>
            <textarea
              id="access-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={280}
              rows={3}
              placeholder="A short note for the admin"
              className="mt-2 w-full resize-none rounded-xl border border-line bg-background px-3 py-3 text-base outline-none focus:border-foreground"
            />
            <Button type="submit" size="lg" className="mt-4 w-full" disabled={sending || !status.email}>
              {sending ? "Sending…" : "Request access"}
            </Button>
            {error ? (
              <p role="alert" className="mt-4 text-sm text-danger">
                {error}
              </p>
            ) : null}
          </form>
        )}

        <Button
          variant="outline"
          size="lg"
          className="mt-3 w-full"
          onClick={() => void onSignOut()}
          disabled={signingOut}
        >
          {signingOut ? "Signing out…" : "Sign out"}
        </Button>
      </div>
      <InstallOffer className="text-center" />
    </div>
  );
}
