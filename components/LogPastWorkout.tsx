"use client";

import { Button } from "@/components/Button";
import { useOfflineLog } from "@/components/OfflineSync";
import { CloseIcon, PlusIcon } from "@/components/icons";
import { PageHeader } from "@/components/PageHeader";
import { useWeightUnit } from "@/components/WeightUnit";
import { SetTypePicker } from "@/components/SetTypePicker";
import { formatExerciseName } from "@/convex/lib/exerciseName";
import type { SetType } from "@/convex/lib/setType";
import { parseCaloriesInput, parseClock, parseDistanceInput, type SetKind } from "@/convex/lib/measures";
import { maxDisplayWeight, parseDisplayWeight, toPounds } from "@/convex/lib/units";
import { formatPersonalRecords } from "@/lib/format";
import { parseReps } from "@/lib/numbers";
import { calendarDayKey } from "@/lib/historyDays";
import { defaultPastWorkoutTime, fromDatetimeLocalValue, toDatetimeLocalValue } from "@/lib/pastWorkout";
import { QUEUED_SAVE_MESSAGE } from "@/lib/offline/messages";
import { stashToast } from "@/lib/pendingToast";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

type DraftSet = {
  key: string;
  reps: string;
  weight: string;
  duration: string;
  distance: string;
  calories: string;
  rpe: string;
  setType: SetType;
};
type DraftExercise = { key: string; name: string; kind: SetKind; sets: DraftSet[] };

const fieldClass =
  "h-12 w-full min-w-0 rounded-xl border border-input bg-background px-3 text-base text-foreground outline-none focus:border-foreground";
const setFieldClass =
  "h-12 min-w-0 rounded-xl border border-input bg-surface text-center font-mono text-lg font-medium outline-none focus:border-foreground";

function nextKey(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function blankSet(): DraftSet {
  return {
    key: nextKey(),
    reps: "",
    weight: "",
    duration: "",
    distance: "",
    calories: "",
    rpe: "",
    setType: "working",
  };
}

function blankExercise(): DraftExercise {
  return { key: nextKey(), name: "", kind: "strength", sets: [blankSet()] };
}

export function LogPastWorkout() {
  const router = useRouter();
  const unit = useWeightUnit();
  const log = useOfflineLog();
  const [when, setWhen] = useState("");
  const [note, setNote] = useState("");
  const [exercises, setExercises] = useState<DraftExercise[]>([blankExercise()]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setWhen(toDatetimeLocalValue(defaultPastWorkoutTime(Date.now())));
  }, []);

  function updateExercise(key: string, patch: Partial<DraftExercise>) {
    setExercises((current) =>
      current.map((exercise) => (exercise.key === key ? { ...exercise, ...patch } : exercise)),
    );
  }

  function updateSet(exerciseKey: string, setKey: string, patch: Partial<DraftSet>) {
    setExercises((current) =>
      current.map((exercise) => {
        if (exercise.key !== exerciseKey) {
          return exercise;
        }
        return {
          ...exercise,
          sets: exercise.sets.map((set) => (set.key === setKey ? { ...set, ...patch } : set)),
        };
      }),
    );
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const startedAt = fromDatetimeLocalValue(when);
    if (startedAt === null) {
      setError("Pick a date and time.");
      return;
    }
    if (startedAt > Date.now() + 60_000) {
      setError("Pick a time that has already happened.");
      return;
    }

    const payload: Array<{
      name: string;
      sets: Array<{
        weightLb: number;
        reps?: number;
        durationSec?: number;
        distanceM?: number;
        calories?: number;
        rpe?: number;
        setType: SetType;
      }>;
    }> = [];
    for (const exercise of exercises) {
      const formatted = formatExerciseName(exercise.name);
      if (!formatted) {
        setError("Enter an exercise name up to 80 characters.");
        return;
      }
      const sets: (typeof payload)[number]["sets"] = [];
      for (const set of exercise.sets) {
        const weightText = set.weight.trim();
        const display = weightText.length === 0 ? 0 : parseDisplayWeight(weightText, unit);
        if (display === null) {
          setError(
            `Weight must be 0 to ${maxDisplayWeight(unit)} ${unit}, with up to two decimal places.`,
          );
          return;
        }
        const weightLb = toPounds(display, unit);
        const rpeText = set.rpe.trim();
        const rpe = rpeText.length === 0 ? undefined : Number(rpeText);
        if (rpe !== undefined && (!Number.isInteger(rpe) || rpe < 1 || rpe > 10)) {
          setError("RPE must be a whole number from 1 to 10, or blank.");
          return;
        }
        const caloriesText = set.calories.trim();
        const calories = caloriesText.length === 0 ? undefined : parseCaloriesInput(caloriesText);
        if (caloriesText.length > 0 && calories === null) {
          setError("Calories must be a whole number from 1 to 20000.");
          return;
        }
        const calorieFields = calories ? { calories } : {};
        if (exercise.kind === "timed") {
          const durationSec = parseClock(set.duration);
          if (durationSec === null) {
            setError("Time must be from 1 second to 24 hours, like 90 or 1:30.");
            return;
          }
          sets.push({ weightLb, durationSec, setType: set.setType, ...calorieFields, ...(rpe ? { rpe } : {}) });
          continue;
        }
        if (exercise.kind === "distance") {
          const distanceM = parseDistanceInput(set.distance);
          if (distanceM === null) {
            setError("Distance must be from 1 meter to 200 kilometers, like 400, 2 km, or 3 mi.");
            return;
          }
          const durationSec = set.duration.trim().length === 0 ? undefined : parseClock(set.duration);
          if (set.duration.trim().length > 0 && durationSec === null) {
            setError("Time must be from 1 second to 24 hours, like 90 or 7:30.");
            return;
          }
          sets.push({
            weightLb,
            distanceM,
            ...(durationSec ? { durationSec } : {}),
            setType: set.setType,
            ...calorieFields,
            ...(rpe ? { rpe } : {}),
          });
          continue;
        }
        const reps = parseReps(set.reps);
        if (reps === null) {
          setError("Reps must be a whole number from 1 to 999.");
          return;
        }
        sets.push({ weightLb, reps, setType: set.setType, ...calorieFields, ...(rpe ? { rpe } : {}) });
      }
      payload.push({ name: formatted.name, sets });
    }

    setPending(true);
    setError(null);
    let loggedAt = startedAt;
    const saved = await log.saveSets({
      placement: "completed",
      sessionId: null,
      sessionStartedAt: startedAt,
      note: note.trim() || null,
      sets: payload.flatMap((exercise) =>
        exercise.sets.map((set) => {
          const at = loggedAt;
          loggedAt += 1;
          return {
            exerciseName: exercise.name,
            weightLb: set.weightLb,
            reps: set.reps ?? null,
            durationSec: set.durationSec ?? null,
            distanceM: set.distanceM ?? null,
            calories: set.calories ?? null,
            rpe: set.rpe ?? null,
            setType: set.setType,
            loggedAt: at,
          };
        }),
      ),
    });
    if (saved.status === "rejected") {
      setError(saved.error ?? "That workout could not be saved");
      setPending(false);
      return;
    }
    const record = formatPersonalRecords(saved.personalRecords, unit);
    if (saved.status === "queued") {
      stashToast(QUEUED_SAVE_MESSAGE);
      router.push("/history");
      return;
    }
    if (record) {
      stashToast(record);
    }
    if (saved.sessionId) {
      router.push(`/history/day/${calendarDayKey(startedAt)}`);
      return;
    }
    stashToast(QUEUED_SAVE_MESSAGE);
    router.push("/history");
  }

  return (
    <form
      onSubmit={(event) => void onSubmit(event)}
      className="px-5 pt-3 pb-[calc(32px+env(safe-area-inset-bottom))]"
    >
      <PageHeader backHref="/history" backLabel="Back to history" title="Log a past workout">
        <p className="mt-1.5 text-base leading-normal text-muted">
          It is saved as finished, so it won&apos;t replace the workout you have open.
        </p>
      </PageHeader>

      <label htmlFor="past-when" className="mt-6 block text-xs font-medium tracking-[0.06em] text-subtle uppercase">
        When
      </label>
      <input
        id="past-when"
        type="datetime-local"
        value={when}
        onChange={(event) => {
          setWhen(event.target.value);
          setError(null);
        }}
        required
        className={`mt-2 ${fieldClass}`}
      />

      <ul className="mt-6 flex flex-col gap-4">
        {exercises.map((exercise, exerciseIndex) => (
          <li key={exercise.key} className="rounded-2xl border border-line bg-surface p-4">
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor={`past-exercise-${exercise.key}`}
                className="text-xs font-medium tracking-[0.06em] text-subtle uppercase"
              >
                Exercise {exerciseIndex + 1}
              </label>
              {exercises.length > 1 ? (
                <button
                  type="button"
                  onClick={() =>
                    setExercises((current) => current.filter((item) => item.key !== exercise.key))
                  }
                  className="min-h-11 rounded-full px-2 text-sm font-medium text-danger hover:bg-fill-2"
                >
                  Remove
                </button>
              ) : null}
            </div>
            <input
              id={`past-exercise-${exercise.key}`}
              value={exercise.name}
              onChange={(event) => updateExercise(exercise.key, { name: event.target.value })}
              placeholder="Bench press"
              autoComplete="off"
              maxLength={80}
              className={`mt-2 ${fieldClass}`}
            />
            <div role="group" aria-label="How this exercise is measured" className="mt-3 flex rounded-full border border-line p-0.5">
              {(
                [
                  ["strength", "Reps"],
                  ["timed", "Time"],
                  ["distance", "Distance"],
                ] as const
              ).map(([kind, label]) => (
                <button
                  key={kind}
                  type="button"
                  aria-pressed={exercise.kind === kind}
                  onClick={() => updateExercise(exercise.key, { kind })}
                  className={`min-h-11 flex-1 rounded-full px-1 text-sm font-medium whitespace-nowrap ${
                    exercise.kind === kind ? "bg-inverse text-inverse-ink" : "text-muted"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="mt-3 flex flex-col gap-2">
              {exercise.sets.map((set, setIndex) => (
                <div key={set.key} className="rounded-xl border border-line bg-background p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-base text-muted">Set {setIndex + 1}</span>
                    <button
                      type="button"
                      onClick={() =>
                        updateExercise(exercise.key, {
                          sets:
                            exercise.sets.length === 1
                              ? exercise.sets
                              : exercise.sets.filter((item) => item.key !== set.key),
                        })
                      }
                      disabled={exercise.sets.length === 1}
                      aria-label={`Remove set ${setIndex + 1}`}
                      className="flex size-11 shrink-0 items-center justify-center rounded-full text-subtle hover:bg-fill-2 disabled:opacity-30"
                    >
                      <CloseIcon className="size-5" strokeWidth={1.8} />
                    </button>
                  </div>
                  <div
                    className={`mt-1 grid gap-2 ${exercise.kind === "distance" ? "grid-cols-2" : "grid-cols-3"}`}
                  >
                    {exercise.kind === "strength" ? (
                      <input
                        value={set.reps}
                        onChange={(event) => updateSet(exercise.key, set.key, { reps: event.target.value })}
                        inputMode="numeric"
                        placeholder="Reps"
                        aria-label={`Set ${setIndex + 1} reps`}
                        className={setFieldClass}
                      />
                    ) : null}
                    {exercise.kind === "timed" || exercise.kind === "distance" ? (
                      <input
                        value={exercise.kind === "timed" ? set.duration : set.distance}
                        onChange={(event) =>
                          updateSet(
                            exercise.key,
                            set.key,
                            exercise.kind === "timed"
                              ? { duration: event.target.value }
                              : { distance: event.target.value },
                          )
                        }
                        placeholder={exercise.kind === "timed" ? "1:30" : "2 km"}
                        aria-label={
                          exercise.kind === "timed"
                            ? `Set ${setIndex + 1} time`
                            : `Set ${setIndex + 1} distance`
                        }
                        className={setFieldClass}
                      />
                    ) : null}
                    {exercise.kind === "distance" ? (
                      <input
                        value={set.duration}
                        onChange={(event) =>
                          updateSet(exercise.key, set.key, { duration: event.target.value })
                        }
                        placeholder="Time"
                        aria-label={`Set ${setIndex + 1} time`}
                        className={setFieldClass}
                      />
                    ) : null}
                    <input
                      value={set.weight}
                      onChange={(event) => updateSet(exercise.key, set.key, { weight: event.target.value })}
                      inputMode="decimal"
                      placeholder={unit}
                      aria-label={`Set ${setIndex + 1} weight in ${unit}`}
                      className={setFieldClass}
                    />
                    <input
                      value={set.rpe}
                      onChange={(event) => updateSet(exercise.key, set.key, { rpe: event.target.value })}
                      inputMode="numeric"
                      placeholder="RPE"
                      aria-label={`Set ${setIndex + 1} RPE`}
                      className={setFieldClass}
                    />
                  </div>
                  {exercise.kind === "timed" || exercise.kind === "distance" ? (
                    <input
                      value={set.calories}
                      onChange={(event) =>
                        updateSet(exercise.key, set.key, { calories: event.target.value })
                      }
                      inputMode="numeric"
                      placeholder="Calories"
                      aria-label={`Set ${setIndex + 1} calories`}
                      className={`${setFieldClass} mt-2 w-full`}
                    />
                  ) : null}
                  <div className="mt-2">
                    <SetTypePicker
                      value={set.setType}
                      onChange={(setType) => updateSet(exercise.key, set.key, { setType })}
                    />
                  </div>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() =>
                updateExercise(exercise.key, {
                  sets: [...exercise.sets, blankSet()],
                })
              }
              className="mt-2 flex min-h-11 items-center gap-2 text-base font-medium"
            >
              <PlusIcon className="size-5" strokeWidth={1.8} />
              Add a set
            </button>
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={() => setExercises((current) => [...current, blankExercise()])}
        className="mt-3 flex min-h-11 items-center gap-2 text-base font-medium"
      >
        <PlusIcon className="size-5" strokeWidth={1.8} />
        Add an exercise
      </button>

      <label htmlFor="past-note" className="mt-6 block text-xs font-medium tracking-[0.06em] text-subtle uppercase">
        Note
      </label>
      <textarea
        id="past-note"
        value={note}
        onChange={(event) => setNote(event.target.value)}
        maxLength={500}
        rows={3}
        placeholder="Optional"
        className="mt-2 w-full resize-none rounded-xl border border-input bg-background px-3 py-2 text-base outline-none focus:border-foreground"
      />

      {error ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      ) : (
        <p className="mt-3 text-sm text-subtle">
          Weights use {unit}. Leave weight blank for bodyweight. The length isn&apos;t recorded.
        </p>
      )}

      <Button type="submit" size="lg" className="mt-5 w-full" disabled={pending}>
        {pending ? "Saving…" : "Save workout"}
      </Button>
    </form>
  );
}
