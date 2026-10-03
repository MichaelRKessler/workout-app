"use client";

import { Button } from "@/components/Button";
import { LocalTime } from "@/components/LocalTime";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { formatExerciseName } from "@/convex/lib/exerciseName";
import { EXAMPLE_EXERCISES } from "@/lib/examples";
import { readableError } from "@/lib/errors";
import { formatWeightLb } from "@/lib/format";
import { groupSets } from "@/lib/groupSets";
import { parseReps, parseWeightLb } from "@/lib/numbers";
import { useMutation, useQuery } from "convex/react";
import { FormEvent, useMemo, useState } from "react";

export function LogWorkout() {
  const openSession = useQuery(api.sessions.getOpen);
  const exercises = useQuery(api.exercises.list);
  const sets = useQuery(
    api.sets.listForSession,
    openSession ? { sessionId: openSession._id } : "skip",
  );
  const startSession = useMutation(api.sessions.start);
  const completeSession = useMutation(api.sessions.complete);
  const logSet = useMutation(api.sets.log);
  const removeSet = useMutation(api.sets.remove);

  const [exerciseName, setExerciseName] = useState("");
  const [exerciseFocused, setExerciseFocused] = useState(false);
  const [reps, setReps] = useState("10");
  const [weight, setWeight] = useState("0");
  const [error, setError] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [confirmingFinish, setConfirmingFinish] = useState(false);
  const [removingId, setRemovingId] = useState<Id<"sets"> | null>(null);

  const library = exercises?.exercises ?? [];
  const formatted = formatExerciseName(exerciseName);
  const query = formatted?.normalizedName ?? "";
  const matches = library.filter((exercise) => {
    if (query.length === 0) {
      return true;
    }
    const normalized = formatExerciseName(exercise.name)?.normalizedName ?? "";
    return normalized.includes(query);
  });
  const hasExactMatch = library.some((exercise) => {
    return formatExerciseName(exercise.name)?.normalizedName === query && query.length > 0;
  });
  const examples = EXAMPLE_EXERCISES.filter((name) => {
    const normalized = formatExerciseName(name)?.normalizedName;
    return !library.some(
      (exercise) => formatExerciseName(exercise.name)?.normalizedName === normalized,
    );
  });
  const showPicker = exerciseFocused || exerciseName.trim().length > 0;
  const groups = useMemo(() => groupSets(sets ?? []), [sets]);

  async function onStart() {
    setPending(true);
    setError(null);
    setSavedNote(null);
    try {
      await startSession({});
    } catch (caught) {
      setError(readableError(caught));
    } finally {
      setPending(false);
    }
  }

  async function onAddSet(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!openSession) {
      return;
    }
    if (!formatted) {
      setError("Enter an exercise name up to 80 characters.");
      return;
    }
    const repsValue = parseReps(reps);
    if (repsValue === null) {
      setError("Reps must be a whole number from 1 to 999.");
      return;
    }
    const weightValue = parseWeightLb(weight);
    if (weightValue === null) {
      setError("Weight must be 0 to 2000 lb, with up to two decimal places.");
      return;
    }

    setPending(true);
    setError(null);
    try {
      await logSet({
        sessionId: openSession._id,
        exerciseName: formatted.name,
        reps: repsValue,
        weightLb: weightValue,
      });
      setConfirmingFinish(false);
    } catch (caught) {
      setError(readableError(caught));
    } finally {
      setPending(false);
    }
  }

  async function onRemove(setId: Id<"sets">) {
    setRemovingId(setId);
    setError(null);
    try {
      await removeSet({ setId });
    } catch (caught) {
      setError(readableError(caught));
    } finally {
      setRemovingId(null);
    }
  }

  async function onFinish() {
    if (!openSession) {
      return;
    }
    setPending(true);
    setError(null);
    try {
      await completeSession({ sessionId: openSession._id });
      setSavedNote("Workout saved. It is in History.");
      setConfirmingFinish(false);
      setExerciseName("");
    } catch (caught) {
      setError(readableError(caught));
    } finally {
      setPending(false);
    }
  }

  if (openSession === undefined || exercises === undefined) {
    return <p className="text-muted">Loading your workout…</p>;
  }

  if (openSession === null) {
    return (
      <section className="flex flex-col gap-6 pt-6">
        <div>
          <h1 className="text-4xl font-semibold tracking-tight">Log a workout</h1>
          <p className="mt-3 text-base leading-7 text-muted">
            Start a session, then add any exercise. Push-ups and bench press
            are examples, not the whole list.
          </p>
        </div>
        {savedNote ? (
          <p role="status" className="rounded-xl bg-panel px-4 py-3 text-sm text-accent">
            {savedNote}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        <Button className="w-full" onClick={() => void onStart()} disabled={pending}>
          {pending ? "Starting…" : "Start workout"}
        </Button>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">In progress</h1>
          <p className="mt-1 text-sm text-muted">
            Started <LocalTime timestamp={openSession.startedAt} />
          </p>
        </div>
        <p className="text-sm text-muted">{sets?.length ?? 0} sets</p>
      </div>

      <form onSubmit={(event) => void onAddSet(event)} className="flex flex-col gap-3">
        <div className="relative">
          <label htmlFor="exercise" className="mb-2 block text-sm font-medium">
            Exercise
          </label>
          <input
            id="exercise"
            value={exerciseName}
            onChange={(event) => setExerciseName(event.target.value)}
            onFocus={() => setExerciseFocused(true)}
            onBlur={() => setExerciseFocused(false)}
            placeholder="Type or pick an exercise"
            autoComplete="off"
            className="min-h-12 w-full rounded-xl border border-line bg-panel px-3 text-base outline-none"
          />
          {showPicker ? (
            <div className="mt-2 max-h-52 overflow-y-auto rounded-xl border border-line bg-panel-2">
              {query.length === 0
                ? examples.map((name) => (
                    <PickerButton key={name} onChoose={() => setExerciseName(name)}>
                      {name}
                      <span className="ml-2 text-xs font-normal text-muted">Example</span>
                    </PickerButton>
                  ))
                : null}
              {matches.map((exercise) => (
                <PickerButton
                  key={exercise._id}
                  onChoose={() => setExerciseName(exercise.name)}
                >
                  {exercise.name}
                </PickerButton>
              ))}
              {formatted && !hasExactMatch ? (
                <PickerButton onChoose={() => setExerciseName(formatted.name)}>
                  Add “{formatted.name}”
                </PickerButton>
              ) : null}
              {exercises.truncated ? (
                <p className="px-3 py-2 text-xs text-muted">
                  Showing the first 200 exercises. Type a new name to add one.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm font-medium">
            Reps
            <input
              value={reps}
              onChange={(event) => setReps(event.target.value)}
              inputMode="numeric"
              autoComplete="off"
              className="mt-2 min-h-12 w-full rounded-xl border border-line bg-panel px-3 text-base outline-none"
            />
          </label>
          <label className="block text-sm font-medium">
            Weight (lb)
            <input
              value={weight}
              onChange={(event) => setWeight(event.target.value)}
              inputMode="decimal"
              autoComplete="off"
              className="mt-2 min-h-12 w-full rounded-xl border border-line bg-panel px-3 text-base outline-none"
            />
          </label>
        </div>
        <p className="text-sm text-muted">Use 0 for a bodyweight exercise.</p>
        <Button type="submit" className="w-full" disabled={pending || sets === undefined}>
          {pending ? "Saving…" : "Add set"}
        </Button>
      </form>

      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}

      {sets === undefined ? (
        <p className="text-muted">Loading sets…</p>
      ) : groups.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line px-4 py-6 text-sm text-muted">
          No sets yet. Add the first one above.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {groups.map((group) => (
            <article key={group.exerciseId} className="rounded-2xl bg-panel p-4">
              <h2 className="text-lg font-semibold">{group.name}</h2>
              <ol className="mt-3 flex flex-col gap-2">
                {group.sets.map((set, index) => (
                  <li
                    key={set._id}
                    className="flex items-center justify-between gap-3 text-sm"
                  >
                    <span>
                      Set {index + 1} · {set.reps} reps · {formatWeightLb(set.weightLb)}
                    </span>
                    <Button
                      variant="danger"
                      className="min-h-10 px-2 text-sm"
                      disabled={removingId === set._id}
                      onClick={() => void onRemove(set._id as Id<"sets">)}
                    >
                      {removingId === set._id ? "Removing…" : "Remove"}
                    </Button>
                  </li>
                ))}
              </ol>
            </article>
          ))}
        </div>
      )}

      {confirmingFinish ? (
        <div className="rounded-2xl border border-line p-4">
          <p className="text-sm leading-6">
            Save this workout to history? You can still read it later.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Button variant="secondary" onClick={() => setConfirmingFinish(false)}>
              Keep logging
            </Button>
            <Button onClick={() => void onFinish()} disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      ) : (
        <Button
          variant="secondary"
          className="w-full"
          disabled={!sets || sets.length === 0 || pending}
          onClick={() => setConfirmingFinish(true)}
        >
          Finish workout
        </Button>
      )}
    </section>
  );
}

function PickerButton({
  children,
  onChoose,
}: {
  children: React.ReactNode;
  onChoose: () => void;
}) {
  return (
    <button
      type="button"
      onPointerDown={(event) => event.preventDefault()}
      onClick={onChoose}
      className="flex min-h-11 w-full items-center px-3 text-left text-sm hover:bg-panel"
    >
      {children}
    </button>
  );
}
