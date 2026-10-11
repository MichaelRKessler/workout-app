"use client";

import { Button } from "@/components/Button";
import { PageHeader } from "@/components/PageHeader";
import { Sheet } from "@/components/Sheet";
import { useWeightUnit } from "@/components/WeightUnit";
import { api } from "@/convex/_generated/api";
import { formatClock } from "@/convex/lib/measures";
import { readableError } from "@/lib/errors";
import { adjustRestSeconds, DEFAULT_REST_SECONDS } from "@/lib/restTimer";
import { moveItem } from "@/convex/lib/routinePlan";
import {
  blankRoutineExercise,
  routineDraftToPayload,
  savedExerciseToDraft,
  type DraftKind,
  type RoutineDraftExercise,
} from "@/lib/routineDraft";
import { useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

const fieldClass =
  "h-12 w-full min-w-0 rounded-xl border border-line bg-background px-3 text-base outline-none focus:border-foreground";

function nextKey(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function RoutineEditor({ routineId }: { routineId?: string }) {
  const router = useRouter();
  const unit = useWeightUnit();
  const editing = routineId !== undefined;
  const routine = useQuery(api.routines.get, editing ? { routineId } : "skip");
  const library = useQuery(api.exercises.list);
  const create = useMutation(api.routines.create);
  const update = useMutation(api.routines.update);
  const remove = useMutation(api.routines.remove);

  const [name, setName] = useState("");
  const [exercises, setExercises] = useState<RoutineDraftExercise[]>([
    blankRoutineExercise(nextKey()),
  ]);
  const [ready, setReady] = useState(!editing);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!editing || !routine || ready) {
      return;
    }
    setName(routine.name);
    setExercises(
      routine.exercises.length > 0
        ? routine.exercises.map((exercise) => savedExerciseToDraft(exercise, unit, nextKey()))
        : [blankRoutineExercise(nextKey())],
    );
    setReady(true);
  }, [editing, ready, routine, unit]);

  function patch(key: string, next: Partial<RoutineDraftExercise>) {
    setExercises((current) =>
      current.map((exercise) => (exercise.key === key ? { ...exercise, ...next } : exercise)),
    );
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload = routineDraftToPayload(exercises, unit);
    if (!payload.ok) {
      setError(payload.error);
      return;
    }
    setPending(true);
    setError(null);
    try {
      if (editing && routine) {
        await update({
          routineId: routine._id,
          name,
          exercises: payload.exercises,
        });
        router.push("/routines");
      } else {
        await create({ name, exercises: payload.exercises });
        router.push("/routines");
      }
    } catch (caught) {
      setError(readableError(caught));
      setPending(false);
    }
  }

  async function confirmRemove() {
    if (!routine) {
      return;
    }
    setPending(true);
    setError(null);
    try {
      await remove({ routineId: routine._id });
      router.push("/routines");
    } catch (caught) {
      setError(readableError(caught));
      setPending(false);
    }
  }

  if (editing && routine === undefined) {
    return (
      <div className="px-5 pt-3">
        <PageHeader backHref="/routines" backLabel="Back to routines" title="Routine" />
        <p className="mt-8 text-base text-muted">Loading routine…</p>
      </div>
    );
  }

  if (editing && routine === null) {
    return (
      <div className="px-5 pt-3">
        <PageHeader backHref="/routines" backLabel="Back to routines" title="Routine not found" />
        <p className="mt-3 text-base text-muted">That routine is not in your list.</p>
      </div>
    );
  }

  const suggestions = (library?.exercises ?? [])
    .map((exercise) => exercise.name)
    .filter((exerciseName) => {
      const key = exerciseName.toLocaleLowerCase();
      return !exercises.some((exercise) => exercise.name.trim().toLocaleLowerCase() === key);
    })
    .slice(0, 8);

  return (
    <div className="px-5 pt-3 pb-[calc(32px+env(safe-area-inset-bottom))]">
      <PageHeader
        backHref="/routines"
        backLabel="Back to routines"
        title={editing ? "Edit routine" : "New routine"}
      >
        <p className="mt-1.5 text-base leading-normal text-muted">
          A name and the exercises, in order. A target like 3×10 is optional.
        </p>
      </PageHeader>

      <form onSubmit={(event) => void onSubmit(event)} className="mt-5 flex flex-col gap-4">
        <label className="block">
          <span className="text-xs font-medium tracking-[0.06em] text-subtle uppercase">Name</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={40}
            placeholder="Push day"
            autoComplete="off"
            className={`${fieldClass} mt-2`}
          />
        </label>

        <ol className="flex flex-col gap-3">
          {exercises.map((exercise, index) => (
            <li key={exercise.key} className="rounded-[1.25rem] border border-line bg-surface p-3">
              <label className="block">
                <span className="text-xs font-medium tracking-[0.06em] text-subtle uppercase">
                  Exercise {index + 1}
                </span>
                <input
                  value={exercise.name}
                  onChange={(event) => patch(exercise.key, { name: event.target.value })}
                  placeholder="Bench press"
                  maxLength={80}
                  autoComplete="off"
                  className={`${fieldClass} mt-2`}
                />
              </label>
              <RestField
                rest={exercise.rest}
                onChange={(rest) => patch(exercise.key, { rest })}
              />
              <div role="group" aria-label="Target" className="mt-3 flex rounded-full border border-line p-0.5">
                {(
                  [
                    ["none", "None"],
                    ["strength", "Reps"],
                    ["timed", "Time"],
                    ["distance", "Distance"],
                  ] as const
                ).map(([kind, label]) => (
                  <button
                    key={kind}
                    type="button"
                    aria-pressed={exercise.kind === kind}
                    onClick={() => patch(exercise.key, { kind: kind satisfies DraftKind })}
                    className={`min-h-11 flex-1 whitespace-nowrap rounded-full px-0.5 text-xs font-medium ${
                      exercise.kind === kind ? "bg-inverse text-inverse-ink" : "text-muted"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {exercise.kind !== "none" || exercise.sets ? (
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="text-xs font-medium tracking-[0.06em] text-subtle uppercase">
                      Sets
                    </span>
                    <input
                      value={exercise.sets}
                      onChange={(event) => patch(exercise.key, { sets: event.target.value })}
                      inputMode="numeric"
                      placeholder="3"
                      className={`${fieldClass} mt-1.5 text-center font-mono`}
                    />
                  </label>
                  {exercise.kind === "strength" ? (
                    <label className="block">
                      <span className="text-xs font-medium tracking-[0.06em] text-subtle uppercase">
                        Reps
                      </span>
                      <input
                        value={exercise.reps}
                        onChange={(event) => patch(exercise.key, { reps: event.target.value })}
                        inputMode="numeric"
                        placeholder="10"
                        className={`${fieldClass} mt-1.5 text-center font-mono`}
                      />
                    </label>
                  ) : null}
                  {exercise.kind === "timed" || exercise.kind === "distance" ? (
                    <label className="block">
                      <span className="text-xs font-medium tracking-[0.06em] text-subtle uppercase">
                        {exercise.kind === "timed" ? "Time" : "Time, optional"}
                      </span>
                      <input
                        value={exercise.duration}
                        onChange={(event) => patch(exercise.key, { duration: event.target.value })}
                        placeholder="1:30"
                        className={`${fieldClass} mt-1.5 text-center font-mono`}
                      />
                    </label>
                  ) : null}
                  {exercise.kind === "distance" ? (
                    <label className="col-span-2 block">
                      <span className="text-xs font-medium tracking-[0.06em] text-subtle uppercase">
                        Distance
                      </span>
                      <input
                        value={exercise.distance}
                        onChange={(event) => patch(exercise.key, { distance: event.target.value })}
                        placeholder="5 km"
                        className={`${fieldClass} mt-1.5 text-center font-mono`}
                      />
                    </label>
                  ) : null}
                  {exercise.kind === "strength" || exercise.kind === "timed" ? (
                    <label className="col-span-2 block">
                      <span className="text-xs font-medium tracking-[0.06em] text-subtle uppercase">
                        Weight · {unit}, optional
                      </span>
                      <input
                        value={exercise.weight}
                        onChange={(event) => patch(exercise.key, { weight: event.target.value })}
                        inputMode="decimal"
                        placeholder={unit === "kg" ? "60" : "135"}
                        className={`${fieldClass} mt-1.5 text-center font-mono`}
                      />
                    </label>
                  ) : null}
                </div>
              ) : null}
              <div className="mt-2 flex flex-wrap gap-1">
                <Button
                  variant="ghost"
                  disabled={index === 0}
                  onClick={() => setExercises((current) => moveItem(current, index, -1))}
                >
                  Up
                </Button>
                <Button
                  variant="ghost"
                  disabled={index === exercises.length - 1}
                  onClick={() => setExercises((current) => moveItem(current, index, 1))}
                >
                  Down
                </Button>
                <Button
                  variant="danger"
                  disabled={exercises.length === 1}
                  onClick={() =>
                    setExercises((current) => current.filter((item) => item.key !== exercise.key))
                  }
                >
                  Remove
                </Button>
              </div>
            </li>
          ))}
        </ol>

        {suggestions.length > 0 ? (
          <div className="flex flex-wrap gap-2" aria-label="Exercises you have logged">
            {suggestions.map((exerciseName) => (
              <button
                key={exerciseName}
                type="button"
                onClick={() =>
                  setExercises((current) => [
                    ...current,
                    { ...blankRoutineExercise(nextKey()), name: exerciseName },
                  ])
                }
                className="min-h-11 max-w-full truncate rounded-full border border-line bg-surface px-4 text-sm font-medium"
              >
                {exerciseName}
              </button>
            ))}
          </div>
        ) : null}

        <Button
          variant="secondary"
          onClick={() =>
            setExercises((current) => [...current, blankRoutineExercise(nextKey())])
          }
        >
          Add exercise
        </Button>

        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}

        <Button type="submit" size="lg" disabled={pending || !ready}>
          {pending ? "Saving…" : editing ? "Save routine" : "Create routine"}
        </Button>
        {editing ? (
          <Button
            variant="danger"
            disabled={pending}
            onClick={() => {
              setError(null);
              setConfirmDelete(true);
            }}
          >
            Delete routine
          </Button>
        ) : null}
      </form>

      <Sheet
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        labelledBy="delete-routine-title"
        dismissible={!pending}
      >
        <h2 id="delete-routine-title" className="mt-2 text-xl font-semibold tracking-[-0.02em]">
          Delete this routine?
        </h2>
        <p className="mt-1.5 text-base leading-normal text-muted">
          {name.trim() || "This routine"} will be removed. Workouts you already logged stay as they are.
        </p>
        <div className="mt-6 flex gap-2.5">
          <Button
            variant="secondary"
            size="lg"
            className="flex-1"
            disabled={pending}
            onClick={() => setConfirmDelete(false)}
          >
            Keep routine
          </Button>
          <Button
            variant="danger"
            size="lg"
            className="flex-1 border border-danger"
            disabled={pending}
            onClick={() => void confirmRemove()}
          >
            {pending ? "Deleting…" : "Delete"}
          </Button>
        </div>
      </Sheet>
    </div>
  );
}

function RestField({ rest, onChange }: { rest: string; onChange: (rest: string) => void }) {
  const seconds = rest.trim() === "" ? null : Number(rest);
  const shown = seconds === null || !Number.isFinite(seconds) ? DEFAULT_REST_SECONDS : seconds;
  const label = seconds === null ? `Default · ${formatClock(shown)}` : formatClock(shown);
  const buttonClass =
    "flex size-11 items-center justify-center rounded-full border border-line text-foreground hover:bg-fill-2";
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
      <span className="text-sm">
        <span className="font-medium">Rest</span>
        <span className="ml-2 font-mono text-muted">{label}</span>
      </span>
      <span className="flex items-center gap-1">
        {seconds !== null ? (
          <button
            type="button"
            onClick={() => onChange("")}
            className="min-h-11 px-2 text-sm font-medium text-muted"
          >
            Use default
          </button>
        ) : null}
        <button
          type="button"
          aria-label="15 seconds less rest"
          onClick={() => onChange(String(adjustRestSeconds(shown, -1)))}
          className={buttonClass}
        >
          −
        </button>
        <button
          type="button"
          aria-label="15 seconds more rest"
          onClick={() => onChange(String(adjustRestSeconds(shown, 1)))}
          className={buttonClass}
        >
          +
        </button>
      </span>
    </div>
  );
}
