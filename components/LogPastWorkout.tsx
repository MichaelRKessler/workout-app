"use client";

import { Button } from "@/components/Button";
import { CloseIcon, PlusIcon } from "@/components/icons";
import { PageHeader } from "@/components/PageHeader";
import { useWeightUnit } from "@/components/WeightUnit";
import { api } from "@/convex/_generated/api";
import { formatExerciseName } from "@/convex/lib/exerciseName";
import { parseClock, parseDistanceInput, type SetKind } from "@/convex/lib/measures";
import { maxDisplayWeight, parseDisplayWeight, toPounds } from "@/convex/lib/units";
import { readableError } from "@/lib/errors";
import { formatPersonalRecords } from "@/lib/format";
import { parseReps } from "@/lib/numbers";
import { defaultPastWorkoutTime, fromDatetimeLocalValue, toDatetimeLocalValue } from "@/lib/pastWorkout";
import { stashToast } from "@/lib/pendingToast";
import { useMutation } from "convex/react";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

type DraftSet = {
  key: string;
  reps: string;
  weight: string;
  duration: string;
  distance: string;
  rpe: string;
};
type DraftExercise = { key: string; name: string; kind: SetKind; sets: DraftSet[] };

const fieldClass =
  "h-12 w-full min-w-0 rounded-xl border border-line bg-background px-3 text-base text-foreground outline-none focus:border-foreground";

function nextKey(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function blankSet(): DraftSet {
  return { key: nextKey(), reps: "", weight: "", duration: "", distance: "", rpe: "" };
}

function blankExercise(): DraftExercise {
  return { key: nextKey(), name: "", kind: "strength", sets: [blankSet()] };
}

export function LogPastWorkout() {
  const router = useRouter();
  const unit = useWeightUnit();
  const logPast = useMutation(api.sessions.logPast);
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
        rpe?: number;
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
        if (exercise.kind === "timed") {
          const durationSec = parseClock(set.duration);
          if (durationSec === null) {
            setError("Time must be from 1 second to 24 hours, like 90 or 1:30.");
            return;
          }
          sets.push({ weightLb, durationSec, ...(rpe ? { rpe } : {}) });
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
            ...(rpe ? { rpe } : {}),
          });
          continue;
        }
        const reps = parseReps(set.reps);
        if (reps === null) {
          setError("Reps must be a whole number from 1 to 999.");
          return;
        }
        sets.push({ weightLb, reps, ...(rpe ? { rpe } : {}) });
      }
      payload.push({ name: formatted.name, sets });
    }

    setPending(true);
    setError(null);
    try {
      const saved = await logPast({
        startedAt,
        exercises: payload,
        ...(note.trim() ? { note } : {}),
      });
      const record = formatPersonalRecords(saved.personalRecords, unit);
      if (record) {
        stashToast(record);
      }
      router.push(`/history/${saved.sessionId}`);
    } catch (caught) {
      setError(readableError(caught));
      setPending(false);
    }
  }

  return (
    <form
      onSubmit={(event) => void onSubmit(event)}
      className="px-5 pt-3 pb-[calc(32px+env(safe-area-inset-bottom))]"
    >
      <PageHeader backHref="/history" backLabel="Back to history" title="Log a past workout">
        <p className="mt-1.5 text-[15px] leading-normal text-muted">
          It is saved as finished, so it won&apos;t replace the workout you have open.
        </p>
      </PageHeader>

      <label htmlFor="past-when" className="mt-6 block text-[11px] font-medium tracking-[0.1em] text-subtle uppercase">
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
                className="text-[11px] font-medium tracking-[0.1em] text-subtle uppercase"
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
                  className={`min-h-11 flex-1 rounded-full text-sm font-medium ${
                    exercise.kind === kind ? "bg-inverse text-inverse-ink" : "text-muted"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="mt-3 flex flex-col gap-2">
              {exercise.sets.map((set, setIndex) => (
                <div key={set.key} className="flex items-center gap-2">
                  <span className="w-6 font-mono text-[15px] text-muted">{setIndex + 1}</span>
                  {exercise.kind === "strength" ? (
                    <input
                      value={set.reps}
                      onChange={(event) => updateSet(exercise.key, set.key, { reps: event.target.value })}
                      inputMode="numeric"
                      placeholder="Reps"
                      aria-label={`Set ${setIndex + 1} reps`}
                      className="h-12 min-w-0 flex-1 rounded-xl border border-line bg-background text-center font-mono text-lg font-medium outline-none focus:border-foreground"
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
                      className="h-12 min-w-0 flex-1 rounded-xl border border-line bg-background text-center font-mono text-lg font-medium outline-none focus:border-foreground"
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
                      className="h-12 min-w-0 flex-1 rounded-xl border border-line bg-background text-center font-mono text-lg font-medium outline-none focus:border-foreground"
                    />
                  ) : null}
                  <input
                    value={set.weight}
                    onChange={(event) => updateSet(exercise.key, set.key, { weight: event.target.value })}
                    inputMode="decimal"
                    placeholder={unit}
                    aria-label={`Set ${setIndex + 1} weight in ${unit}`}
                    className="h-12 min-w-0 flex-1 rounded-xl border border-line bg-background text-center font-mono text-lg font-medium outline-none focus:border-foreground"
                  />
                  <input
                    value={set.rpe}
                    onChange={(event) => updateSet(exercise.key, set.key, { rpe: event.target.value })}
                    inputMode="numeric"
                    placeholder="RPE"
                    aria-label={`Set ${setIndex + 1} RPE`}
                    className="h-12 w-16 rounded-xl border border-line bg-background text-center font-mono text-lg font-medium outline-none focus:border-foreground"
                  />
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
                    <CloseIcon className="size-[18px]" strokeWidth={1.8} />
                  </button>
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
              className="mt-2 flex min-h-11 items-center gap-2 text-[15px] font-medium"
            >
              <PlusIcon className="size-[18px]" strokeWidth={1.8} />
              Add a set
            </button>
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={() => setExercises((current) => [...current, blankExercise()])}
        className="mt-3 flex min-h-11 items-center gap-2 text-[15px] font-medium"
      >
        <PlusIcon className="size-[18px]" strokeWidth={1.8} />
        Add an exercise
      </button>

      <label htmlFor="past-note" className="mt-6 block text-[11px] font-medium tracking-[0.1em] text-subtle uppercase">
        Note
      </label>
      <textarea
        id="past-note"
        value={note}
        onChange={(event) => setNote(event.target.value)}
        maxLength={500}
        rows={3}
        placeholder="Optional"
        className="mt-2 w-full resize-none rounded-xl border border-line bg-background px-3 py-2 text-[15px] outline-none focus:border-foreground"
      />

      {error ? (
        <p role="alert" className="mt-3 text-sm leading-5 text-danger">
          {error}
        </p>
      ) : (
        <p className="mt-3 text-[13px] text-subtle">
          Weights use {unit}. Leave weight blank for bodyweight. The length isn&apos;t recorded.
        </p>
      )}

      <Button type="submit" size="lg" className="mt-5 w-full" disabled={pending}>
        {pending ? "Saving…" : "Save workout"}
      </Button>
    </form>
  );
}
