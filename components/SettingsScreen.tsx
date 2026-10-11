"use client";

import { AccessSettings } from "@/components/AccessSettings";
import { InstallOffer } from "@/components/InstallOffer";
import { PageHeader, SectionLabel } from "@/components/PageHeader";
import { useTheme } from "@/components/useTheme";
import { useOfflineLog } from "@/components/OfflineSync";
import { useWeightUnit } from "@/components/WeightUnit";
import { api } from "@/convex/_generated/api";
import type { WeightUnit } from "@/convex/lib/units";
import { browserStore, clearOfflineStorage } from "@/lib/offline/storage";
import { useAuthActions } from "@convex-dev/auth/react";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function SettingsScreen() {
  const viewer = useQuery(api.users.viewer);
  const { signOut } = useAuthActions();
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const unit = useWeightUnit();
  const { offline } = useOfflineLog();
  const setWeightUnit = useMutation(api.users.setWeightUnit);
  const [signingOut, setSigningOut] = useState(false);
  const [savingUnit, setSavingUnit] = useState(false);

  const name = viewer?.name || viewer?.email || "Signed in";
  const initial = (viewer?.name || viewer?.email || "").trim().charAt(0).toUpperCase();
  const dark = theme === "dark";

  async function chooseUnit(next: WeightUnit) {
    if (next === unit || savingUnit || offline) {
      return;
    }
    setSavingUnit(true);
    try {
      await setWeightUnit({ weightUnit: next });
    } finally {
      setSavingUnit(false);
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
    <div className="px-5 pt-3 pb-[calc(32px+env(safe-area-inset-bottom))]">
      <PageHeader backHref="/" title="Settings" />

      <AccessSettings />

      <section aria-labelledby="settings-units" className="mt-7">
        <SectionLabel id="settings-units">Weight</SectionLabel>
        <div className="overflow-hidden rounded-[1.25rem] border border-line bg-surface">
          <div className="flex min-h-14 items-center justify-between gap-4 px-4 py-3">
            <span className="text-base font-medium">Unit</span>
            <div role="group" aria-label="Weight unit" className="flex rounded-full border border-line p-0.5">
              {(["lb", "kg"] as const).map((choice) => (
                <button
                  key={choice}
                  type="button"
                  aria-pressed={unit === choice}
                  disabled={savingUnit || offline}
                  onClick={() => void chooseUnit(choice)}
                  className={`min-h-11 min-w-14 rounded-full px-4 text-sm font-medium ${
                    unit === choice ? "bg-inverse text-inverse-ink" : "text-muted"
                  }`}
                >
                  {choice}
                </button>
              ))}
            </div>
          </div>
          <p className="border-t border-line px-4 py-3 text-sm leading-normal text-muted">
            Shown in this unit. Saved weights stay in pounds, so a workout logged in pounds still
            means pounds if you switch to kilograms.
            {offline ? " Changing the unit needs a connection." : ""}
          </p>
        </div>
      </section>

      <section aria-labelledby="settings-exercises" className="mt-7">
        <SectionLabel id="settings-exercises">Library</SectionLabel>
        <Link
          href="/exercises"
          className="flex min-h-14 items-center justify-between rounded-[1.25rem] border border-line bg-surface px-4 text-base font-medium hover:bg-fill-2"
        >
          Exercises
          <span className="text-sm font-normal text-muted">Rename or combine</span>
        </Link>
      </section>

      <section aria-labelledby="settings-appearance" className="mt-7">
        <SectionLabel id="settings-appearance">Appearance</SectionLabel>
        <div className="overflow-hidden rounded-[1.25rem] border border-line bg-surface">
          <div className="flex min-h-14 items-center justify-between gap-4 px-4">
            <span id="dark-mode-label" className="text-base font-medium">
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
                className={`relative h-8 w-13 rounded-full transition-colors ${
                  dark ? "bg-foreground" : "bg-line"
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 size-7 rounded-full bg-surface shadow-[0_1px_3px_rgb(0_0_0/0.2)] transition-transform ${
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
        <div className="overflow-hidden rounded-[1.25rem] border border-line bg-surface">
          <div className="flex items-center gap-3.5 border-b border-line px-4 py-3.5">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-line text-base font-semibold">
              {initial}
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-base font-medium">{name}</span>
              {viewer?.name && viewer.email ? (
                <span className="truncate text-sm text-muted">{viewer.email}</span>
              ) : null}
            </span>
          </div>
          <button
            type="button"
            onClick={() => void onSignOut()}
            disabled={signingOut}
            className="flex min-h-14 w-full items-center px-4 text-left text-base font-medium text-danger hover:bg-fill-2 disabled:opacity-60"
          >
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        </div>
      </section>
    </div>
  );
}
