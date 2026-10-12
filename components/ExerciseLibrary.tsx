"use client";

import { Button } from "@/components/Button";
import { MuscleGroupField } from "@/components/MuscleGroupField";
import { useOfflineLog } from "@/components/OfflineSync";
import { PageHeader } from "@/components/PageHeader";
import { Sheet } from "@/components/Sheet";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { exerciseLink, muscleFilterHref } from "@/lib/exerciseLink";
import { readableError } from "@/lib/errors";
import { pluralize } from "@/lib/format";
import { isMuscleGroup, MUSCLE_GROUPS, MUSCLE_LABELS, type MuscleGroup } from "@/convex/lib/muscleGroup";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FormEvent, useState } from "react";

type LibraryItem = {
  _id: Id<"exercises">;
  name: string;
  setCount: number;
  setCountCapped: boolean;
  muscleGroup: MuscleGroup;
  muscleSource: "saved" | "suggested";
};

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
  const { offline } = useOfflineLog();
  const [editing, setEditing] = useState<{ id: Id<"exercises">; name: string } | null>(null);
  const [draftName, setDraftName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [mergeNotice, setMergeNotice] = useState<string | null>(null);

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
    <div className="px-5 pt-3 pb-[calc(32px+env(safe-area-inset-bottom))]">
      <PageHeader
        backHref={fromHome ? "/" : "/settings"}
        backLabel={fromHome ? "Back to home" : "Back to settings"}
        title="Exercises"
      >
        <p className="mt-1.5 text-base leading-normal text-muted">
          Rename a duplicate, or merge it into the exercise you want to keep. Merging moves every
          set. History and personal records follow those sets. The muscle group is a suggestion
          until you change it.
        </p>
      </PageHeader>

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
            : "Exercises appear after you log a set."}
        </p>
      ) : (
        <>
        {offline ? (
          <p className="mt-4 text-sm text-muted">Changing a muscle group needs a connection.</p>
        ) : null}
        <ul className="mt-6 flex flex-col border-t border-line">
          {results.map((exercise) => (
            <li key={exercise._id} className="flex flex-col gap-2 border-b border-line py-3">
              <span className="flex min-h-11 items-center justify-between gap-3">
                <span className="min-w-0">
                  <Link
                    href={exerciseLink(exercise._id, muscleFilterHref(muscle, fromHome)) ?? `/exercises/${exercise._id}`}
                    className="block truncate text-base font-medium hover:underline"
                  >
                    {exercise.name}
                  </Link>
                  <span className="text-sm text-muted">
                    {exercise.setCountCapped
                      ? `${exercise.setCount}+ sets`
                      : pluralize(exercise.setCount, "set")}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => openRename(exercise._id, exercise.name)}
                  className="min-h-11 shrink-0 rounded-full px-3 text-sm font-medium hover:bg-fill-2"
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
                offline={offline}
              />
            </li>
          ))}
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
