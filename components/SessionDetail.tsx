"use client";

import { Button } from "@/components/Button";
import { useOfflineLog } from "@/components/OfflineSync";
import { PageHeader } from "@/components/PageHeader";
import { Toast, type ToastMessage } from "@/components/Toast";
import { DeleteWorkoutSheet } from "@/components/workout/DeleteWorkoutSheet";
import { ExerciseRow } from "@/components/workout/ExerciseRow";
import { ManualEntrySheet } from "@/components/workout/ManualEntrySheet";
import { api } from "@/convex/_generated/api";
import { formatExerciseName } from "@/convex/lib/exerciseName";
import { readableError } from "@/lib/errors";
import { EXAMPLE_EXERCISES } from "@/lib/examples";
import { useWeightUnit } from "@/components/WeightUnit";
import {
  formatLongDate,
  formatPersonalRecord,
  formatTimeOfDay,
  formatWorkoutLength,
  pluralize,
} from "@/lib/format";
import { groupSets, type SetLine } from "@/lib/groupSets";
import { QUEUED_SAVE_MESSAGE } from "@/lib/offline/messages";
import { mergeVisibleSets } from "@/lib/offline/outbox";
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
  const log = useOfflineLog();
  const deleteWorkout = useMutation(api.sessions.remove);
  const setNote = useMutation(api.sessions.setNote);
  const unit = useWeightUnit();

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [manualPending, setManualPending] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState<Toasted | null>(null);
  const [noteDraft, setNoteDraft] = useState<string | null>(null);
  const [savingNote, setSavingNote] = useState(false);
  const [manual, setManual] = useState<
    | { key: number; mode: "add"; exerciseName: string }
    | {
        key: number;
        mode: "edit";
        setId: string;
        exerciseName: string;
        reps: number | null;
        weightLb: number;
        durationSec: number | null;
        distanceM: number | null;
        rpe: number | null;
      }
    | null
  >(null);

  const visibleSets = useMemo(
    () =>
      session
        ? mergeVisibleSets(session.sets, log.outbox, { kind: "session", sessionId: session._id })
        : [],
    [log.outbox, session],
  );
  const groups = useMemo(() => groupSets(visibleSets), [visibleSets]);

  useEffect(() => {
    if (session?.sets) {
      log.reconcile(session.sets);
    }
  }, [log, session]);

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

  async function undo(ids: string[]) {
    setToast(null);
    const removed = await log.removeMany(ids);
    if (removed.status === "rejected" && removed.error) {
      showToast({ tone: "error", message: removed.error });
    }
  }

  async function addManual(set: {
    exerciseName: string;
    reps?: number;
    weightLb: number;
    durationSec?: number;
    distanceM?: number;
    rpe?: number;
  }) {
    if (!session) {
      return "Workout not found";
    }
    setManualPending(true);
    try {
      const measures = {
        weightLb: set.weightLb,
        reps: set.reps ?? null,
        durationSec: set.durationSec ?? null,
        distanceM: set.distanceM ?? null,
        rpe: set.rpe ?? null,
      };
      if (manual?.mode === "edit") {
        const saved = await log.editSet({
          setId: manual.setId,
          clientId: visibleSets.find((item) => item._id === manual.setId)?.clientId,
          ...measures,
        });
        if (saved.status === "rejected") {
          return saved.error ?? "That set could not be saved";
        }
        setManual(null);
        if (saved.status === "queued") {
          showToast({ tone: "info", message: QUEUED_SAVE_MESSAGE });
        } else if (saved.personalRecords[0]) {
          showToast({ tone: "info", message: formatPersonalRecord(saved.personalRecords[0], unit) });
        }
        return null;
      }
      const saved = await log.saveSets({
        placement: "completed",
        sessionId: session._id,
        sessionStartedAt: session.startedAt,
        note: null,
        sets: [{ exerciseName: set.exerciseName, ...measures }],
      });
      if (saved.status === "rejected") {
        return saved.error ?? "That set could not be saved";
      }
      setManual(null);
      if (saved.status === "queued") {
        showToast({ tone: "info", message: QUEUED_SAVE_MESSAGE });
        return null;
      }
      const added = `Added 1 set · ${set.exerciseName}`;
      const record = saved.personalRecords[0]
        ? formatPersonalRecord(saved.personalRecords[0], unit)
        : null;
      showToast({
        tone: "info",
        message: record ? `${record}. ${added}` : added,
        action: {
          label: "Undo",
          onClick: () => void undo(saved.setIds.length > 0 ? saved.setIds : saved.clientIds),
        },
      });
      return null;
    } finally {
      setManualPending(false);
    }
  }

  async function saveNote() {
    if (!session) {
      return;
    }
    setSavingNote(true);
    try {
      await setNote({ sessionId: session._id, note: noteDraft ?? session.note ?? "" });
      setNoteDraft(null);
    } catch (error) {
      showToast({ tone: "error", message: readableError(error) });
    } finally {
      setSavingNote(false);
    }
  }

  async function deleteSet(setId: string) {
    setRemovingId(setId);
    const removed = await log.removeMany([setId]);
    setRemovingId(null);
    if (removed.status === "rejected" && removed.error) {
      showToast({ tone: "error", message: removed.error });
    } else if (removed.status === "queued") {
      showToast({ tone: "info", message: QUEUED_SAVE_MESSAGE });
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
        <p className="mt-8 text-[15px] text-muted">
          {log.offline
            ? "You're offline. This workout will load when you reconnect."
            : "Loading workout…"}
        </p>
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
    pluralize(visibleSets.length, "set"),
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
        {finished ? (
          <label className="mt-4 block">
            <span className="text-[11px] font-medium tracking-[0.1em] text-subtle uppercase">
              Note
            </span>
            <textarea
              value={noteDraft ?? session.note ?? ""}
              onChange={(event) => setNoteDraft(event.target.value)}
              maxLength={500}
              rows={3}
              placeholder="Optional. How the workout felt."
              className="mt-2 w-full resize-none rounded-xl border border-line bg-background px-3 py-2 text-[15px] outline-none focus:border-foreground"
            />
            {noteDraft !== null ? (
              <Button
                variant="secondary"
                className="mt-2"
                disabled={savingNote}
                onClick={() => void saveNote()}
              >
                {savingNote ? "Saving…" : "Save note"}
              </Button>
            ) : null}
          </label>
        ) : session.note ? (
          <p className="mt-3 text-[15px] leading-normal text-muted">{session.note}</p>
        ) : null}
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
              exerciseHref={
                group.exerciseId.startsWith("local:") ? undefined : `/exercises/${group.exerciseId}`
              }
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
                        setId: set._id,
                        exerciseName: set.exerciseName,
                        reps: set.reps,
                        weightLb: set.weightLb,
                        durationSec: set.durationSec,
                        distanceM: set.distanceM,
                        rpe: set.rpe,
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
          initialSet={
            manual.mode === "edit"
              ? {
                  reps: manual.reps,
                  weightLb: manual.weightLb,
                  durationSec: manual.durationSec,
                  distanceM: manual.distanceM,
                  rpe: manual.rpe,
                }
              : undefined
          }
          library={library}
          truncatedLibrary={libraryQuery?.truncated}
          sessionSets={visibleSets}
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
