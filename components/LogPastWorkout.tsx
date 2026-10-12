"use client";

import { Button } from "@/components/Button";
import { useOfflineLog } from "@/components/OfflineSync";
import { CloseIcon, PlusIcon } from "@/components/icons";
import { PageHeader } from "@/components/PageHeader";
import { useWeightUnit } from "@/components/WeightUnit";
import { KindSwitch, SetExtraFields, SetMeasureFields } from "@/components/workout/SetFields";
import { formatExerciseName } from "@/convex/lib/exerciseName";
import type { SetType } from "@/convex/lib/setType";
import type { SetKind } from "@/convex/lib/measures";
import { parseSetInput } from "@/convex/lib/setInput";
import { formatPersonalRecords } from "@/lib/format";
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
        const parsed = parseSetInput({ ...set, kind: exercise.kind }, unit, { blankWeightIsZero: true });
        if (!parsed.ok) {
          setError(parsed.message);
          return;
        }
        const { reps, weightLb, durationSec, distanceM, calories, rpe, setType } = parsed.set;
        sets.push({
          weightLb,
          setType,
          ...(reps !== null ? { reps } : {}),
          ...(durationSec !== null ? { durationSec } : {}),
          ...(distanceM !== null ? { distanceM } : {}),
          ...(calories ? { calories } : {}),
          ...(rpe ? { rpe } : {}),
        });
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
            <KindSwitch
              kind={exercise.kind}
              label="How this exercise is measured"
              className="mt-3"
              onChange={(kind) => updateExercise(exercise.key, { kind })}
            />
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
                  <div className="mt-1 flex flex-col gap-3">
                    <SetMeasureFields
                      kind={exercise.kind}
                      values={set}
                      unit={unit}
                      labelPrefix={`Set ${setIndex + 1}`}
                      onChange={(patch) => updateSet(exercise.key, set.key, patch)}
                    />
                    <SetExtraFields
                      values={set}
                      labelPrefix={`Set ${setIndex + 1}`}
                      onChange={(patch) => updateSet(exercise.key, set.key, patch)}
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
