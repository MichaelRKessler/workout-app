"use client";

import { InstallOffer } from "@/components/InstallOffer";
import { PageHeader, SectionLabel } from "@/components/PageHeader";
import { useTheme } from "@/components/useTheme";
import { api } from "@/convex/_generated/api";
import { useAuthActions } from "@convex-dev/auth/react";
import { useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function SettingsScreen() {
  const viewer = useQuery(api.users.viewer);
  const { signOut } = useAuthActions();
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [signingOut, setSigningOut] = useState(false);

  const name = viewer?.name || viewer?.email || "Signed in";
  const initial = (viewer?.name || viewer?.email || "").trim().charAt(0).toUpperCase();
  const dark = theme === "dark";

  async function onSignOut() {
    setSigningOut(true);
    try {
      await signOut();
      router.replace("/signin");
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <div className="px-5 pt-3 pb-[calc(32px+env(safe-area-inset-bottom))]">
      <PageHeader backHref="/" title="Settings" />

      <section aria-labelledby="settings-appearance" className="mt-7">
        <SectionLabel id="settings-appearance">Appearance</SectionLabel>
        <div className="overflow-hidden rounded-[18px] border border-line bg-surface">
          <div className="flex min-h-14 items-center justify-between gap-4 px-4">
            <span id="dark-mode-label" className="text-[15px] font-medium">
              Dark mode
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={dark}
              aria-labelledby="dark-mode-label"
              onClick={() => setTheme(dark ? "light" : "dark")}
              className="-mr-1 flex h-11 items-center px-1"
            >
              <span
                aria-hidden="true"
                className={`relative h-[31px] w-[51px] rounded-full transition-colors ${
                  dark ? "bg-foreground" : "bg-line"
                }`}
              >
                <span
                  className={`absolute top-[2px] left-[2px] size-[27px] rounded-full bg-surface shadow-[0_1px_3px_rgb(0_0_0/0.2)] transition-transform ${
                    dark ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </span>
            </button>
          </div>
        </div>
      </section>

      <InstallOffer variant="settings" />

      <section aria-labelledby="settings-account" className="mt-7">
        <SectionLabel id="settings-account">Account</SectionLabel>
        <div className="overflow-hidden rounded-[18px] border border-line bg-surface">
          <div className="flex items-center gap-3.5 border-b border-line px-4 py-3.5">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-line text-[15px] font-semibold">
              {initial}
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-[15px] font-medium">{name}</span>
              {viewer?.name && viewer.email ? (
                <span className="truncate text-[13px] text-muted">{viewer.email}</span>
              ) : null}
            </span>
          </div>
          <button
            type="button"
            onClick={() => void onSignOut()}
            disabled={signingOut}
            className="flex min-h-14 w-full items-center px-4 text-left text-[15px] font-medium text-danger hover:bg-fill-2 disabled:opacity-60"
          >
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        </div>
      </section>
    </div>
  );
}
