"use client";

import { Button } from "@/components/Button";
import { BrandMark } from "@/components/icons";
import { InstallOffer } from "@/components/InstallOffer";
import { readableError } from "@/lib/errors";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth } from "convex/react";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

export function SignInScreen() {
  const { signIn } = useAuthActions();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isAuthenticated) {
      router.replace("/");
    }
  }, [isAuthenticated, router]);

  async function onGoogle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await signIn("google", { redirectTo: "/" });
    } catch (caught) {
      setError(readableError(caught));
      setPending(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col px-5 pt-3 pb-[calc(24px+env(safe-area-inset-bottom))]">
      <div className="flex min-h-11 items-center gap-2.5">
        <BrandMark />
        <span className="text-lg font-semibold tracking-[-0.01em]">Workout</span>
      </div>
      <div className="flex flex-1 flex-col justify-center py-10">
        <h1 className="text-4xl leading-[1.1] font-semibold tracking-[-0.03em] text-balance">
          Say the set. Keep the history.
        </h1>
        <p className="mt-4 max-w-sm text-base leading-normal text-pretty text-muted">
          Log sets, reps, and weight by voice or by hand, and come back to every
          workout you finished.
        </p>
        <form onSubmit={(event) => void onGoogle(event)} className="mt-9">
          <Button
            type="submit"
            variant="secondary"
            size="lg"
            className="w-full"
            disabled={pending || isLoading}
          >
            <GoogleMark />
            {pending ? "Redirecting to Google…" : "Sign in with Google"}
          </Button>
        </form>
        {error ? (
          <p role="alert" className="mt-4 text-sm text-danger">
            {error}
          </p>
        ) : null}
      </div>
      <InstallOffer className="text-center" />
    </main>
  );
}

function GoogleMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5">
      <path
        fill="#4285F4"
        d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5c-.3 1.5-1.1 2.8-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.7z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.2 0 5.9-1.1 7.9-2.9l-3.9-3c-1.1.7-2.4 1.2-4 1.2-3.1 0-5.7-2.1-6.6-4.9H1.4v3.1C3.4 21.3 7.4 24 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.4 14.4c-.2-.7-.4-1.4-.4-2.4s.1-1.7.4-2.4V6.5H1.4C.5 8.3 0 10.1 0 12s.5 3.7 1.4 5.5l4-3.1z"
      />
      <path
        fill="#EA4335"
        d="M12 4.8c1.7 0 3.3.6 4.5 1.8l3.4-3.4C17.9 1.1 15.2 0 12 0 7.4 0 3.4 2.7 1.4 6.5l4 3.1C6.3 6.8 8.9 4.8 12 4.8z"
      />
    </svg>
  );
}
