"use client";

import { Button } from "@/components/Button";
import { MuscleGroupField, SecondaryMusclePicker } from "@/components/MuscleGroupField";
import { useOfflineLog } from "@/components/OfflineSync";
import { PageHeader } from "@/components/PageHeader";
import { Sheet } from "@/components/Sheet";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { exerciseLink, muscleFilterHref } from "@/lib/exerciseLink";
import { readableError } from "@/lib/errors";
import { formatSetShort, formatShortDate, formatVolumeLb, pluralize } from "@/lib/format";
import { MetaLine } from "@/components/MetaLine";
import { useWeightUnit } from "@/components/WeightUnit";
import { ChevronRightIcon } from "@/components/icons";
import type { WeightUnit } from "@/convex/lib/units";
import {
  cleanSecondaryMuscles,
  isMuscleGroup,
  MUSCLE_GROUPS,
  MUSCLE_LABELS,
  suggestMuscleGroup,
  suggestSecondaryMuscles,
  type MuscleGroup,
} from "@/convex/lib/muscleGroup";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useState } from "react";

type LibraryItem = {
  _id: Id<"exercises">;
  name: string;
  setCount: number;
  setCountCapped: boolean;
  muscleGroup: MuscleGroup;
  muscleSource: "saved" | "suggested";
  secondaryMuscles: MuscleGroup[];
  secondarySource: "saved" | "suggested";
  mergingInto: string | null;
  lastLoggedAt?: number | null;
  best?: {
    reps: number | null;
    weightLb: number;
    durationSec: number | null;
    distanceM: number | null;
    epleyLb: number | null;
  } | null;
};

/** "Tue, Oct 13 · Best 8×185 · est. 1RM 228 lb" */
function progressLine(exercise: LibraryItem, unit: WeightUnit): string {
  const parts: string[] = [];
  if (exercise.lastLoggedAt) {
    parts.push(formatShortDate(exercise.lastLoggedAt));
  }
  if (exercise.best) {
    parts.push(`Best ${formatSetShort(exercise.best, unit)}`);
    if (exercise.best.epleyLb !== null && exercise.best.weightLb > 0 && (exercise.best.reps ?? 0) > 1) {
      parts.push(`est. 1RM ${formatVolumeLb(exercise.best.epleyLb, unit)}`);
    }
  }
  if (parts.length === 0) {
    parts.push(exercise.setCountCapped ? `${exercise.setCount}+ sets` : pluralize(exercise.setCount, "set"));
  }
  return parts.join(" · ");
}

type Conflict = {
  fromId: Id<"exercises">;
  intoId: Id<"exercises">;
  intoName: string;
  fromName: string;
  setCount: number;
  setCountCapped: boolean;
};

export function ExerciseLibrary() {
  const params = useSearchParams();
  const muscleParam = params.get("muscle");
  const muscle = isMuscleGroup(muscleParam) ? muscleParam : null;
  const fromHome = params.get("from") === "home";
  const { results: allResults, status: pageStatus, loadMore } = usePaginatedQuery(
    api.exercises.browse,
    muscle ? "skip" : {},
    { initialNumItems: 40 },
  );
  const filtered = useQuery(api.exercises.byMuscle, muscle ? { muscleGroup: muscle } : "skip");
  const results: LibraryItem[] = muscle ? (filtered?.exercises ?? []) : allResults;
  const status = muscle ? (filtered === undefined ? "LoadingFirstPage" : "Exhausted") : pageStatus;
  const renameExercise = useMutation(api.exercises.rename);
  const mergeExercises = useMutation(api.exercises.merge);
  const createExercise = useMutation(api.exercises.create);
  const router = useRouter();
  const { offline } = useOfflineLog();
  const [editing, setEditing] = useState<{ id: Id<"exercises">; name: string } | null>(null);
  const [draftName, setDraftName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [mergeNotice, setMergeNotice] = useState<string | null>(null);
  // Rename and muscle groups sit behind Edit, so the tab reads as a list of your lifts.
  const [managing, setManaging] = useState(false);
  const unit = useWeightUnit();
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newMuscle, setNewMuscle] = useState<MuscleGroup | "auto">("auto");
  // Null follows the name, like "auto" for the main group.
  const [newAlso, setNewAlso] = useState<MuscleGroup[] | null>(null);
  const newPrimary = newMuscle === "auto" ? suggestMuscleGroup(newName) : newMuscle;
  const newAlsoShown =
    newAlso === null
      ? suggestSecondaryMuscles(newName, newPrimary)
      : cleanSecondaryMuscles(newAlso, newPrimary);
  const [existing, setExisting] = useState<{ id: Id<"exercises">; name: string } | null>(null);
  const [addedNotice, setAddedNotice] = useState<{ id: Id<"exercises">; name: string } | null>(null);
  const backHere = muscleFilterHref(muscle, fromHome);

  function openAdd() {
    setNewName("");
    // A muscle filter is the likely group for a new exercise.
    setNewMuscle(muscle ?? "auto");
    setNewAlso(null);
    setExisting(null);
    setError(null);
    setAdding(true);
  }

  async function onAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (offline) {
      return;
    }
    setPending(true);
    setError(null);
    setExisting(null);
    try {
      const result = await createExercise({
        name: newName,
        muscleGroup: newMuscle === "auto" ? null : newMuscle,
        secondaryMuscles: newAlso === null ? null : newAlsoShown,
      });
      if (result.status === "exists") {
        setExisting({ id: result.exerciseId, name: result.name });
        return;
      }
      setAdding(false);
      setAddedNotice({ id: result.exerciseId, name: result.name });
    } catch (caught) {
      setError(readableError(caught));
    } finally {
      setPending(false);
    }
  }

  function openRename(id: Id<"exercises">, name: string) {
    setEditing({ id, name });
    setDraftName(name);
    setError(null);
    setConflict(null);
  }

  async function onRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) {
      return;
    }
    setPending(true);
    setError(null);
    try {
      const result = await renameExercise({ exerciseId: editing.id, name: draftName });
      if (result.status === "conflict") {
        setConflict({ fromId: editing.id, ...result });
        return;
      }
      setEditing(null);
    } catch (caught) {
      setError(readableError(caught));
    } finally {
      setPending(false);
    }
  }

  async function confirmMerge() {
    if (!conflict) {
      return;
    }
    setPending(true);
    setError(null);
    try {
      const result = await mergeExercises({ fromId: conflict.fromId, intoId: conflict.intoId });
      setConflict(null);
      setEditing(null);
      setMergeNotice(
        result.continuing
          ? `Moving the rest of the sets onto ${result.name}. This list updates when they finish.`
          : null,
      );
    } catch (caught) {
      setError(readableError(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="px-5 pt-3 pb-[calc(32px+var(--page-inset))]">
      <PageHeader
        backHref={fromHome ? "/" : undefined}
        backLabel="Back to home"
        title="Exercises"
        action={
          <span className="flex items-center gap-1">
            {managing ? null : (
              <button
                type="button"
                onClick={openAdd}
                disabled={offline}
                className="min-h-11 rounded-full px-3 text-base font-semibold hover:bg-fill-2 disabled:opacity-50"
              >
                Add
              </button>
            )}
            <button
              type="button"
              aria-pressed={managing}
              onClick={() => setManaging((current) => !current)}
              className="min-h-11 rounded-full px-3 text-base font-semibold hover:bg-fill-2"
            >
              {managing ? "Done" : "Edit"}
            </button>
          </span>
        }
      >
        {managing ? (
          <p className="mt-1.5 text-base leading-normal text-muted">
            Rename a duplicate to the name you keep and its sets merge in. Muscle groups are
            suggestions until you pick one.
          </p>
        ) : null}
      </PageHeader>

      {addedNotice ? (
        <p role="status" className="mt-4 text-base leading-normal text-muted">
          Added{" "}
          <Link
            href={exerciseLink(addedNotice.id, backHere) ?? `/exercises/${addedNotice.id}`}
            className="font-medium text-foreground underline decoration-line underline-offset-4"
          >
            {addedNotice.name}
          </Link>
          .
        </p>
      ) : null}

      {mergeNotice ? (
        <p role="status" className="mt-4 text-base leading-normal text-muted">
          {mergeNotice}
        </p>
      ) : null}

      <nav aria-label="Filter by muscle" className="-mx-5 mt-5 flex gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none]">
        {[null, ...MUSCLE_GROUPS].map((group) => {
          const active = group === muscle;
          return (
            <Link
              key={group ?? "all"}
              href={muscleFilterHref(group, fromHome)}
              replace
              aria-current={active ? "page" : undefined}
              className={`inline-flex min-h-11 shrink-0 items-center rounded-full border px-4 text-base font-medium ${
                active ? "border-inverse bg-inverse text-inverse-ink" : "border-line bg-surface hover:bg-fill-2"
              }`}
            >
              {group ? MUSCLE_LABELS[group] : "All"}
            </Link>
          );
        })}
      </nav>

      {status === "LoadingFirstPage" ? (
        <p className="mt-8 text-base text-muted">Loading exercises…</p>
      ) : results.length === 0 ? (
        <p className="mt-8 text-base text-muted">
          {muscle
            ? `No ${MUSCLE_LABELS[muscle].toLowerCase()} exercises yet. Log one, or change an exercise's muscle group under All.`
            : "Exercises appear after you log a set, or tap Add to save one now."}
        </p>
      ) : (
        <>
        {offline && managing ? (
          <p className="mt-4 text-sm text-muted">Changing a muscle group needs a connection.</p>
        ) : null}
        <ul className="mt-5 flex flex-col border-t border-line">
          {results.map((exercise) => {
            const href =
              exerciseLink(exercise._id, muscleFilterHref(muscle, fromHome)) ?? `/exercises/${exercise._id}`;
            if (!managing) {
              return (
                <li key={exercise._id} className="border-b border-line">
                  <Link href={href} className="flex min-h-16 items-center gap-3 py-3 hover:opacity-80">
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-base font-medium">{exercise.name}</span>
                      <MetaLine
                        className="text-sm text-muted"
                        text={
                          exercise.mergingInto
                            ? `Moving sets onto ${exercise.mergingInto}…`
                            : muscle && exercise.muscleGroup !== muscle
                              ? `Also works ${MUSCLE_LABELS[muscle].toLowerCase()} · ${progressLine(exercise, unit)}`
                              : progressLine(exercise, unit)
                        }
                      />
                    </span>
                    <ChevronRightIcon className="size-5 shrink-0 text-subtle" />
                  </Link>
                </li>
              );
            }
            return (
            <li key={exercise._id} className="flex flex-col gap-2 border-b border-line py-3">
              <span className="flex min-h-11 items-center justify-between gap-3">
                <span className="min-w-0">
                  <Link
                    href={href}
                    className="block truncate text-base font-medium underline decoration-line underline-offset-4 hover:decoration-current"
                  >
                    {exercise.name}
                  </Link>
                  <span className="text-sm text-muted">
                    {exercise.mergingInto
                      ? `Moving sets onto ${exercise.mergingInto}…`
                      : exercise.setCountCapped
                        ? `${exercise.setCount}+ sets`
                        : pluralize(exercise.setCount, "set")}
                  </span>
                </span>
                <button
                  type="button"
                  disabled={exercise.mergingInto !== null}
                  onClick={() => openRename(exercise._id, exercise.name)}
                  className="min-h-11 shrink-0 rounded-full px-3 text-sm font-medium hover:bg-fill-2 disabled:opacity-50"
                >
                  Rename
                </button>
              </span>
              <MuscleGroupField
                compact
                exerciseId={exercise._id}
                exerciseName={exercise.name}
                muscleGroup={exercise.muscleGroup}
                muscleSource={exercise.muscleSource}
                secondaryMuscles={exercise.secondaryMuscles}
                secondarySource={exercise.secondarySource}
                offline={offline}
              />
            </li>
            );
          })}
        </ul>
        </>
      )}
      {muscle && filtered?.truncated ? (
        <p className="mt-4 text-sm text-muted">Only your first 200 exercises are checked for this filter.</p>
      ) : null}

      {status === "CanLoadMore" ? (
        <Button variant="secondary" className="mt-6 w-full" onClick={() => loadMore(40)}>
          Load more
        </Button>
      ) : null}
      {status === "LoadingMore" ? (
        <p className="mt-6 text-center text-sm text-muted">Loading more…</p>
      ) : null}

      <Sheet
        open={editing !== null && conflict === null}
        onClose={() => {
          if (!pending) {
            setEditing(null);
          }
        }}
        labelledBy="rename-title"
        dismissible={!pending}
      >
        <form onSubmit={(event) => void onRename(event)}>
          <h2 id="rename-title" className="mt-2 text-xl font-semibold tracking-[-0.02em]">
            Rename {editing?.name}
          </h2>
          <p className="mt-1.5 text-base leading-normal text-muted">
            A new spelling is saved immediately. If that name is already an exercise, you will be
            asked before anything is merged.
          </p>
          <label htmlFor="rename-name" className="mt-4 block text-xs font-medium tracking-[0.06em] text-subtle uppercase">
            Name
          </label>
          <input
            id="rename-name"
            value={draftName}
            onChange={(event) => setDraftName(event.target.value)}
            maxLength={80}
            autoComplete="off"
            className="mt-2 h-12 w-full rounded-xl border border-input bg-background px-3 text-base outline-none focus:border-foreground"
          />
          {error ? (
            <p role="alert" className="mt-3 text-sm text-danger">
              {error}
            </p>
          ) : null}
          <div className="mt-6 flex gap-2.5">
            <Button
              type="button"
              variant="secondary"
              size="lg"
              className="flex-1"
              disabled={pending}
              onClick={() => setEditing(null)}
            >
              Cancel
            </Button>
            <Button type="submit" size="lg" className="flex-1" disabled={pending}>
              {pending ? "Saving…" : "Rename"}
            </Button>
          </div>
        </form>
      </Sheet>

      <Sheet
        open={adding}
        onClose={() => {
          if (!pending) {
            setAdding(false);
          }
        }}
        labelledBy="add-title"
        dismissible={!pending}
      >
        <form onSubmit={(event) => void onAdd(event)}>
          <h2 id="add-title" className="mt-2 text-xl font-semibold tracking-[-0.02em]">
            Add an exercise
          </h2>
          <label htmlFor="add-name" className="mt-4 block text-xs font-medium tracking-[0.06em] text-subtle uppercase">
            Name
          </label>
          <input
            id="add-name"
            value={newName}
            onChange={(event) => {
              setNewName(event.target.value);
              setExisting(null);
            }}
            maxLength={80}
            autoComplete="off"
            placeholder="Lat pulldown"
            className="mt-2 h-12 w-full rounded-xl border border-input bg-background px-3 text-base outline-none placeholder:text-subtle focus:border-foreground"
          />
          <label htmlFor="add-muscle" className="mt-4 block text-xs font-medium tracking-[0.06em] text-subtle uppercase">
            Muscle group
          </label>
          <select
            id="add-muscle"
            value={newMuscle}
            onChange={(event) => setNewMuscle(event.target.value as MuscleGroup | "auto")}
            className="mt-2 h-12 w-full rounded-xl border border-input bg-background px-3 text-base outline-none focus:border-foreground"
          >
            <option value="auto">
              {newName.trim() ? `Auto · ${MUSCLE_LABELS[suggestMuscleGroup(newName)]}` : "Auto"}
            </option>
            {MUSCLE_GROUPS.map((group) => (
              <option key={group} value={group}>
                {MUSCLE_LABELS[group]}
              </option>
            ))}
          </select>
          <p className="mt-4 text-xs font-medium tracking-[0.06em] text-subtle uppercase">Also works</p>
          <SecondaryMusclePicker
            primary={newPrimary}
            selected={newAlsoShown}
            source={newAlso === null ? "suggested" : "saved"}
            disabled={pending}
            onChange={setNewAlso}
          />
          {offline ? (
            <p className="mt-3 text-sm text-muted">Adding an exercise needs a connection.</p>
          ) : null}
          {existing ? (
            <p role="alert" className="mt-3 text-base leading-normal">
              You already have {existing.name}.{" "}
              <button
                type="button"
                onClick={() => {
                  setAdding(false);
                  router.push(exerciseLink(existing.id, backHere) ?? `/exercises/${existing.id}`);
                }}
                className="font-medium underline decoration-line underline-offset-4"
              >
                Open it
              </button>
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="mt-3 text-sm text-danger">
              {error}
            </p>
          ) : null}
          <div className="mt-6 flex gap-2.5">
            <Button
              type="button"
              variant="secondary"
              size="lg"
              className="flex-1"
              disabled={pending}
              onClick={() => setAdding(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="lg"
              className="flex-1"
              disabled={pending || offline || newName.trim() === ""}
            >
              {pending ? "Adding…" : "Add"}
            </Button>
          </div>
        </form>
      </Sheet>

      <Sheet
        open={conflict !== null}
        onClose={() => {
          if (!pending) {
            setConflict(null);
          }
        }}
        labelledBy="merge-title"
        dismissible={!pending}
      >
        <h2 id="merge-title" className="mt-2 text-xl font-semibold tracking-[-0.02em]">
          Merge into {conflict?.intoName}?
        </h2>
        <p className="mt-1.5 text-base leading-normal text-muted">
          {conflict
            ? `${conflict.fromName} has ${
                conflict.setCountCapped ? `${conflict.setCount}+` : conflict.setCount
              } sets. Merging moves every set onto ${conflict.intoName} and removes ${conflict.fromName}. This cannot be undone.`
            : ""}
        </p>
        {error ? (
          <p role="alert" className="mt-3 text-sm text-danger">
            {error}
          </p>
        ) : null}
        <div className="mt-6 flex gap-2.5">
          <Button
            variant="secondary"
            size="lg"
            className="flex-1"
            disabled={pending}
            onClick={() => setConflict(null)}
          >
            Cancel
          </Button>
          <Button size="lg" className="flex-1" disabled={pending} onClick={() => void confirmMerge()}>
            {pending ? "Merging…" : "Merge"}
          </Button>
        </div>
      </Sheet>
    </div>
  );
}
