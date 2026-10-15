"use client";

import { AccessSettings } from "@/components/AccessSettings";
import { ExerciseRestList } from "@/components/ExerciseRestList";
import { ExportData } from "@/components/ExportData";
import { InstallOffer } from "@/components/InstallOffer";
import { PageHeader, SectionLabel } from "@/components/PageHeader";
import { useOfflineLog } from "@/components/OfflineSync";
import { useGuardedSignOut } from "@/components/useGuardedSignOut";
import { useTheme } from "@/components/useTheme";
import { useProgression } from "@/components/useProgression";
import { useLengthUnit, useWeightUnit } from "@/components/WeightUnit";
import { api } from "@/convex/_generated/api";
import type { LengthUnit } from "@/convex/lib/bodyMeasures";
import { fromPounds, toPounds, WEIGHT_STEP, type WeightUnit } from "@/convex/lib/units";
import { formatElapsed } from "@/lib/format";
import { readRestChime, REST_CHIME_KEY, restChimeStored } from "@/lib/restChime";
import { adjustRestSeconds, readRestSeconds, REST_STEP_SECONDS, REST_STORAGE_KEY } from "@/lib/restTimer";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { readLocal, writeLocal } from "@/lib/localValue";

export function SettingsScreen() {
  const viewer = useQuery(api.users.viewer);
  const { theme, setTheme } = useTheme();
  const unit = useWeightUnit();
  const lengthUnit = useLengthUnit();
  const progression = useProgression();
  const { offline } = useOfflineLog();
  const signOut = useGuardedSignOut();
  const setWeightUnit = useMutation(api.users.setWeightUnit);
  const setLengthUnit = useMutation(api.users.setLengthUnit);
  const setProgression = useMutation(api.users.setProgression);
  const [savingUnit, setSavingUnit] = useState(false);
  const [savingLength, setSavingLength] = useState(false);
  const [savingProgression, setSavingProgression] = useState(false);

  const name = viewer?.name || viewer?.email || "Signed in";
  const initial = (viewer?.name || viewer?.email || "").trim().charAt(0).toUpperCase();

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

  async function chooseLength(next: LengthUnit) {
    if (next === lengthUnit || savingLength || offline) {
      return;
    }
    setSavingLength(true);
    try {
      await setLengthUnit({ lengthUnit: next });
    } finally {
      setSavingLength(false);
    }
  }

  async function saveProgression(next: { enabled?: boolean; incrementLb?: number | null }) {
    if (savingProgression || offline) {
      return;
    }
    setSavingProgression(true);
    try {
      await setProgression({
        suggestNextWeight: next.enabled ?? progression.enabled,
        progressionIncrementLb:
          next.incrementLb !== undefined ? next.incrementLb : progression.storedIncrementLb,
      });
    } finally {
      setSavingProgression(false);
    }
  }

  const step = WEIGHT_STEP[unit];
  const shownIncrement = fromPounds(progression.incrementLb, unit);

  return (
    <div className="px-5 pt-3 pb-[calc(32px+var(--page-inset))]">
      <PageHeader backHref="/" title="Settings" />

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
            Only changes what you see. Saved weights don&apos;t change.
            {offline ? " Changing the unit needs a connection." : ""}
          </p>
        </div>
      </section>

      <section aria-labelledby="settings-length" className="mt-7">
        <SectionLabel id="settings-length">Measurements</SectionLabel>
        <div className="overflow-hidden rounded-[1.25rem] border border-line bg-surface">
          <div className="flex min-h-14 items-center justify-between gap-4 px-4 py-3">
            <span className="text-base font-medium">Length</span>
            <div role="group" aria-label="Length unit" className="flex rounded-full border border-line p-0.5">
              {(["in", "cm"] as const).map((choice) => (
                <button
                  key={choice}
                  type="button"
                  aria-pressed={lengthUnit === choice}
                  disabled={savingLength || offline}
                  onClick={() => void chooseLength(choice)}
                  className={`min-h-11 min-w-14 rounded-full px-4 text-sm font-medium ${
                    lengthUnit === choice ? "bg-inverse text-inverse-ink" : "text-muted"
                  }`}
                >
                  {choice}
                </button>
              ))}
            </div>
          </div>
          <p className="border-t border-line px-4 py-3 text-sm leading-normal text-muted">
            Follows the weight unit until you pick one.
            {offline ? " Changing the unit needs a connection." : ""}
          </p>
        </div>
      </section>

      <RestSettings />

      <section aria-labelledby="settings-suggestions" className="mt-7">
        <SectionLabel id="settings-suggestions">Next weight</SectionLabel>
        <div className="overflow-hidden rounded-[1.25rem] border border-line bg-surface">
          <div className="flex min-h-14 items-center justify-between gap-4 px-4">
            <span id="suggest-weight-label" className="text-base font-medium">
              Suggest next weight
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={progression.enabled}
              aria-labelledby="suggest-weight-label"
              disabled={savingProgression || offline}
              onClick={() => void saveProgression({ enabled: !progression.enabled })}
              className="-mr-1 flex h-11 items-center px-1 disabled:opacity-60"
            >
              <span
                aria-hidden="true"
                className={`relative h-8 w-13 rounded-full transition-colors ${
                  progression.enabled ? "bg-foreground" : "bg-line"
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 size-7 rounded-full bg-surface shadow-[0_1px_3px_rgb(0_0_0/0.2)] transition-transform ${
                    progression.enabled ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </span>
            </button>
          </div>
          {progression.enabled ? (
            <div className="flex min-h-14 items-center justify-between gap-4 border-t border-line px-4 py-3">
              <span className="text-base font-medium">Increment</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  aria-label={`${step} ${unit} smaller increment`}
                  disabled={savingProgression || offline}
                  onClick={() =>
                    void saveProgression({
                      incrementLb: toPounds(Math.max(step, shownIncrement - step), unit),
                    })
                  }
                  className="flex size-11 items-center justify-center rounded-full border border-line disabled:opacity-60"
                >
                  −
                </button>
                <span className="min-w-16 text-center font-mono text-base tabular-nums">
                  {shownIncrement} {unit}
                </span>
                <button
                  type="button"
                  aria-label={`${step} ${unit} larger increment`}
                  disabled={savingProgression || offline}
                  onClick={() =>
                    void saveProgression({ incrementLb: toPounds(shownIncrement + step, unit) })
                  }
                  className="flex size-11 items-center justify-center rounded-full border border-line disabled:opacity-60"
                >
                  +
                </button>
              </div>
            </div>
          ) : null}
          <p className="border-t border-line px-4 py-3 text-sm leading-normal text-muted">
            Offers the next load when every working set hit its reps last time.
            {offline ? " Changing this needs a connection." : ""}
          </p>
        </div>
      </section>

      <section aria-labelledby="settings-export" className="mt-7">
        <SectionLabel id="settings-export">Your data</SectionLabel>
        <div className="overflow-hidden rounded-[1.25rem] border border-line bg-surface">
          <ExportData />
        </div>
      </section>

      <section aria-labelledby="settings-appearance" className="mt-7">
        <SectionLabel id="settings-appearance">Appearance</SectionLabel>
        <div className="overflow-hidden rounded-[1.25rem] border border-line bg-surface">
          <div className="flex min-h-14 flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
            <span className="text-base font-medium">Theme</span>
            <div role="group" aria-label="Theme" className="flex rounded-full border border-line p-0.5">
              {(
                [
                  ["system", "Match phone"],
                  ["light", "Light"],
                  ["dark", "Dark"],
                ] as const
              ).map(([choice, label]) => (
                <button
                  key={choice}
                  type="button"
                  aria-pressed={theme === choice}
                  onClick={() => setTheme(choice)}
                  className={`min-h-11 rounded-full px-3.5 text-sm font-medium ${
                    theme === choice ? "bg-inverse text-inverse-ink" : "text-muted"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
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
            onClick={signOut.onSignOut}
            disabled={signOut.busy}
            className="flex min-h-14 w-full items-center px-4 text-left text-base font-medium text-danger hover:bg-fill-2 disabled:opacity-60"
          >
            {signOut.buttonLabel}
          </button>
          {signOut.error ? (
            <p role="alert" className="border-t border-line px-4 py-3 text-sm text-danger">
              {signOut.error}
            </p>
          ) : null}
        </div>
      </section>

      <AccessSettings />
      {signOut.dialog}
    </div>
  );
}

function RestSettings() {
  const [seconds, setSeconds] = useState(90);
  const [chime, setChime] = useState(true);

  useEffect(() => {
    function sync() {
      setSeconds(readRestSeconds(readLocal(REST_STORAGE_KEY)));
      setChime(readRestChime(readLocal(REST_CHIME_KEY)));
    }
    sync();
    window.addEventListener("workout-rest-default", sync);
    window.addEventListener("workout-rest-chime", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("workout-rest-default", sync);
      window.removeEventListener("workout-rest-chime", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  function change(direction: -1 | 1) {
    const next = adjustRestSeconds(seconds, direction);
    writeLocal(REST_STORAGE_KEY, String(next));
    setSeconds(next);
    window.dispatchEvent(new Event("workout-rest-default"));
  }

  function toggleChime() {
    const next = !chime;
    writeLocal(REST_CHIME_KEY, restChimeStored(next));
    setChime(next);
    window.dispatchEvent(new Event("workout-rest-chime"));
  }

  const buttonClass =
    "flex size-11 items-center justify-center rounded-full border border-input bg-background text-lg font-semibold";

  return (
    <section aria-labelledby="settings-rest" className="mt-7">
      <SectionLabel id="settings-rest">Rest</SectionLabel>
      <div className="overflow-hidden rounded-[1.25rem] border border-line bg-surface">
        <div className="flex min-h-14 items-center justify-between gap-4 px-4 py-3">
          <span className="text-base font-medium">Default rest</span>
          <div className="flex items-center gap-2">
            <button type="button" aria-label={`${REST_STEP_SECONDS} seconds less rest`} onClick={() => change(-1)} className={buttonClass}>
              −
            </button>
            <span className="min-w-14 text-center font-mono text-lg font-medium tabular-nums">
              {formatElapsed(seconds * 1000)}
            </span>
            <button type="button" aria-label={`${REST_STEP_SECONDS} seconds more rest`} onClick={() => change(1)} className={buttonClass}>
              +
            </button>
          </div>
        </div>
        <div className="flex min-h-14 items-center justify-between gap-4 border-t border-line px-4">
          <span id="rest-chime-label" className="text-base font-medium">
            Chime when rest ends
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={chime}
            aria-labelledby="rest-chime-label"
            onClick={toggleChime}
            className="-mr-1 flex h-11 items-center px-1"
          >
            <span
              aria-hidden="true"
              className={`relative h-8 w-13 rounded-full transition-colors ${chime ? "bg-foreground" : "bg-line"}`}
            >
              <span
                className={`absolute top-0.5 left-0.5 size-7 rounded-full bg-surface shadow-[0_1px_3px_rgb(0_0_0/0.2)] transition-transform ${
                  chime ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </span>
          </button>
        </div>
        <p className="border-t border-line px-4 py-3 text-sm leading-normal text-muted">
          Used for any exercise without its own rest.
        </p>
        <ExerciseRestList />
      </div>
    </section>
  );
}

