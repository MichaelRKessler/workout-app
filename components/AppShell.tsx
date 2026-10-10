"use client";

import { Button } from "@/components/Button";
import { InstallOffer } from "@/components/InstallOffer";
import { api } from "@/convex/_generated/api";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth, useQuery } from "convex/react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ReactNode, useState } from "react";

export function AppShell({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useConvexAuth();

  if (isLoading) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-lg items-center px-5">
        <p className="text-muted">Loading your workouts…</p>
      </main>
    );
  }

  if (!isAuthenticated) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col justify-center gap-4 px-5">
        <h1 className="text-3xl font-semibold tracking-tight">Sign in to log a workout.</h1>
        <InstallOffer />
        <Link
          href="/signin"
          className="inline-flex min-h-12 items-center justify-center rounded-xl bg-accent px-4 font-semibold text-accent-ink"
        >
          Sign in with Google
        </Link>
      </main>
    );
  }

  return (
    <div className="mx-auto min-h-dvh w-full max-w-lg">
      <AccountHeader />
      <main className="px-4 pt-4 pb-28">{children}</main>
      <BottomNav />
    </div>
  );
}

function AccountHeader() {
  const viewer = useQuery(api.users.viewer);
  const { signOut } = useAuthActions();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const label = viewer?.name || viewer?.email || "Signed in";

  async function onSignOut() {
    setPending(true);
    try {
      await signOut();
      router.replace("/signin");
    } finally {
      setPending(false);
    }
  }

  return (
    <header className="border-b border-line px-4 py-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold tracking-[0.16em] text-accent uppercase">
            Workout
          </p>
          <p className="truncate text-sm text-muted">{label}</p>
        </div>
        <Button variant="ghost" onClick={() => void onSignOut()} disabled={pending}>
          {pending ? "Signing out…" : "Sign out"}
        </Button>
      </div>
      <InstallOffer className="mt-3" />
    </header>
  );
}

function BottomNav() {
  const pathname = usePathname();
  const logActive = pathname === "/";
  const historyActive = pathname.startsWith("/history");

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 border-t border-line bg-background/95 pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] backdrop-blur"
    >
      <div className="mx-auto flex max-w-lg pb-[env(safe-area-inset-bottom)]">
        <NavLink href="/" active={logActive}>
          Log
        </NavLink>
        <NavLink href="/history" active={historyActive}>
          History
        </NavLink>
      </div>
    </nav>
  );
}

function NavLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`flex min-h-14 flex-1 items-center justify-center text-base font-semibold ${
        active ? "text-accent" : "text-muted"
      }`}
    >
      {children}
    </Link>
  );
}
