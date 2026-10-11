"use client";

import { Button } from "@/components/Button";
import { PageHeader } from "@/components/PageHeader";
import { Toast, type ToastMessage } from "@/components/Toast";
import { DeleteWorkoutSheet } from "@/components/workout/DeleteWorkoutSheet";
import { ExerciseRow } from "@/components/workout/ExerciseRow";
import { ManualEntrySheet } from "@/components/workout/ManualEntrySheet";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { formatExerciseName } from "@/convex/lib/exerciseName";
import { readableError } from "@/lib/errors";
import { EXAMPLE_EXERCISES } from "@/lib/examples";
import {
  formatLongDate,
  formatPersonalRecord,
  formatTimeOfDay,
  formatWorkoutLength,
  pluralize,
} from "@/lib/format";
import { groupSets, type SetLine } from "@/lib/groupSets";
import { takeToast } from "@/lib/pendingToast";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

type Toasted = ToastMessage & { id: number };

export function SessionDetail({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const session = useQuery(api.sessions.get, { sessionId });
  const libraryQuery = useQuery(api.exercises.list);
  const logSet = useMutation(api.sets.log);
  const updateSet = useMutation(api.sets.update);
  const removeSet = useMutation(api.sets.remove);
  const removeSets = useMutation(api.sets.removeMany);
  const deleteWorkout = useMutation(api.sessions.remove);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [manualPending, setManualPending] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState<Toasted | null>(null);
  const [manual, setManual] = useState<
    | { key: number; mode: "add"; exerciseName: string }
    | {
        key: number;
        mode: "edit";
        setId: Id<"sets">;
        exerciseName: string;
        reps: number;
        weightLb: number;
      }
    | null
  >(null);

  const groups = useMemo(() => groupSets(session?.sets ?? []), [session?.sets]);

  useEffect(() => {
    const pending = takeToast();
    if (pending) {
      setToast({ id: Date.now(), tone: "info", message: pending });
    }
  }, []);

  const library = useMemo(() => {
    const names: string[] = [];
    const seen = new Set<string>();
    const add = (name: string) => {
      const key = formatExerciseName(name)?.normalizedName;
      if (key && !seen.has(key)) {
        seen.add(key);
        names.push(name);
      }
    };
    groups.forEach((group) => add(group.name));
    libraryQuery?.exercises.forEach((exercise) => add(exercise.name));
    EXAMPLE_EXERCISES.forEach(add);
    return names;
  }, [groups, libraryQuery]);

  function showToast(message: ToastMessage) {
    setToast({ ...message, id: Date.now() });
  }

  async function undo(ids: Array<Id<"sets">>) {
    setToast(null);
    try {
      await removeSets({ setIds: ids });
    } catch (error) {
      showToast({ tone: "error", message: readableError(error) });
    }
  }

  async function addManual(set: { exerciseName: string; reps: number; weightLb: number }) {
    if (!session) {
      return "Workout not found";
    }
    setManualPending(true);
    try {
      if (manual?.mode === "edit") {
        const personalRecord = await updateSet({
          setId: manual.setId,
          reps: set.reps,
          weightLb: set.weightLb,
        });
        setManual(null);
        if (personalRecord) {
          showToast({ tone: "info", message: formatPersonalRecord(personalRecord) });
        }
        return null;
      }
      const saved = await logSet({
        sessionId: session._id,
        exerciseName: set.exerciseName,
        reps: set.reps,
        weightLb: set.weightLb,
      });
      setManual(null);
      const added = `Added 1 set · ${set.exerciseName}`;
      showToast({
        tone: "info",
        message: saved.personalRecord
          ? `${formatPersonalRecord(saved.personalRecord)}. ${added}`
          : added,
        action: { label: "Undo", onClick: () => void undo([saved.setId]) },
      });
      return null;
    } catch (error) {
      return readableError(error);
    } finally {
      setManualPending(false);
    }
  }

  async function deleteSet(setId: string) {
    setRemovingId(setId);
    try {
      await removeSet({ setId: setId as Id<"sets"> });
    } catch (error) {
      showToast({ tone: "error", message: readableError(error) });
    } finally {
      setRemovingId(null);
    }
  }

  async function confirmDelete() {
    if (!session) {
      return;
    }
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteWorkout({ sessionId: session._id });
      router.push("/history");
    } catch (error) {
      setDeleteError(readableError(error));
      setDeleting(false);
    }
  }

  if (session === undefined) {
    return (
      <div className="px-5 pt-3">
        <PageHeader backHref="/history" backLabel="Back to history" title="Workout" />
        <p className="mt-8 text-[15px] text-muted">Loading workout…</p>
      </div>
    );
  }

  if (session === null) {
    return (
      <div className="px-5 pt-3">
        <PageHeader backHref="/history" backLabel="Back to history" title="Workout not found" />
        <p className="mt-3 text-[15px] leading-normal text-muted">
          That session is not in your history.
        </p>
      </div>
    );
  }

  const length = session.completedAt
    ? formatWorkoutLength(session.startedAt, session.completedAt)
    : null;
  const meta = [
    formatTimeOfDay(session.startedAt),
    session.status === "open" ? "In progress" : length,
    pluralize(groups.length, "exercise"),
    pluralize(session.sets.length, "set"),
  ]
    .filter((part) => part !== null && part !== undefined)
    .join(" · ");
  const finished = session.status === "completed";

  return (
    <div className="px-5 pt-3 pb-[calc(32px+env(safe-area-inset-bottom))]">
      <PageHeader
        backHref="/history"
        backLabel="Back to history"
        title={<span suppressHydrationWarning>{formatLongDate(session.startedAt)}</span>}
      >
        <p className="mt-1.5 text-[15px] text-muted" suppressHydrationWarning>
          {meta}
        </p>
      </PageHeader>

      {session.status === "open" ? (
        <Link
          href="/"
          className="mt-5 inline-flex min-h-11 items-center rounded-full bg-inverse px-5 text-[15px] font-semibold text-inverse-ink"
        >
          Continue workout
        </Link>
      ) : (
        <div className="mt-5 flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={() =>
              setManual({
                key: Date.now(),
                mode: "add",
                exerciseName: groups[groups.length - 1]?.name ?? "",
              })
            }
          >
            Add a set
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              setDeleteError(null);
              setDeleteOpen(true);
            }}
          >
            Delete workout
          </Button>
        </div>
      )}

      {groups.length === 0 ? (
        <p className="mt-8 text-[15px] text-muted">No sets were logged.</p>
      ) : (
        <ul aria-label="Exercises" className="mt-5 flex flex-col border-t border-line">
          {groups.map((group) => (
            <ExerciseRow
              key={group.exerciseId}
              name={group.name}
              sets={group.sets}
              exerciseHref={`/exercises/${group.exerciseId}`}
              expanded={finished && expandedId === group.exerciseId}
              onToggle={
                finished
                  ? () =>
                      setExpandedId((current) =>
                        current === group.exerciseId ? null : group.exerciseId,
                      )
                  : undefined
              }
              onEditSet={
                finished
                  ? (set: SetLine) =>
                      setManual({
                        key: Date.now(),
                        mode: "edit",
                        setId: set._id as Id<"sets">,
                        exerciseName: set.exerciseName,
                        reps: set.reps,
                        weightLb: set.weightLb,
                      })
                  : undefined
              }
              onRemoveSet={finished ? (setId) => void deleteSet(setId) : undefined}
              removingId={removingId}
            />
          ))}
        </ul>
      )}

      {manual ? (
        <ManualEntrySheet
          key={manual.key}
          open
          mode={manual.mode}
          initialExercise={manual.exerciseName}
          initialReps={manual.mode === "edit" ? manual.reps : undefined}
          initialWeight={manual.mode === "edit" ? manual.weightLb : undefined}
          library={library}
          sessionSets={session.sets}
          excludeSessionId={session._id}
          pending={manualPending}
          onClose={() => setManual(null)}
          onAdd={addManual}
        />
      ) : null}

      <DeleteWorkoutSheet
        open={deleteOpen}
        summary={formatLongDate(session.startedAt)}
        pending={deleting}
        error={deleteError}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={() => void confirmDelete()}
      />

      <Toast
        key={toast ? `${toast.id}-${toast.message}` : "none"}
        toast={toast}
        raised={false}
        onDismiss={() => setToast(null)}
      />
    </div>
  );
}
