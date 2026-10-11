"use client";

import { Button } from "@/components/Button";
import { useOfflineLog } from "@/components/OfflineSync";
import { PageHeader } from "@/components/PageHeader";
import { OpenWorkoutSheet } from "@/components/routines/OpenWorkoutSheet";
import { SaveRoutineSheet } from "@/components/routines/SaveRoutineSheet";
import { useBeginWorkout } from "@/components/routines/useBeginWorkout";
import { Toast, type ToastMessage } from "@/components/Toast";
import { useBrowserTimeZone } from "@/components/useBrowserTimeZone";
import { useWeightUnit } from "@/components/WeightUnit";
import { DeleteWorkoutSheet } from "@/components/workout/DeleteWorkoutSheet";
import { ExerciseRow } from "@/components/workout/ExerciseRow";
import { ManualEntrySheet } from "@/components/workout/ManualEntrySheet";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { formatExerciseName } from "@/convex/lib/exerciseName";
import { volumeLb } from "@/convex/lib/records";
import { readableError } from "@/lib/errors";
import { EXAMPLE_EXERCISES } from "@/lib/examples";
import {
  formatDuration,
  formatLongDate,
  formatPersonalRecord,
  formatTimeOfDay,
  formatVolumeLb,
  pluralize,
  suggestRoutineName,
} from "@/lib/format";
import { type SetLine } from "@/lib/groupSets";
import {
  calendarDayBounds,
  canonicalExerciseIds,
  groupPerformedSets,
  parseDayKey,
} from "@/lib/historyDays";
import { QUEUED_SAVE_MESSAGE } from "@/lib/offline/messages";
import { mergeVisibleSets } from "@/lib/offline/outbox";
import { takeToast } from "@/lib/pendingToast";
import { useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

type Toasted = ToastMessage & { id: number };

type ManualState =
  | {
      key: number;
      mode: "add";
      exerciseName: string;
      sessionId: Id<"sessions">;
      sessionStartedAt: number;
    }
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
      setType?: SetLine["setType"];
    };

/**
 * Every finished workout performed on one local calendar day.
 * Session documents stay separate: edits, new sets, and notes still target
 * one workout. Delete removes the whole day.
 */
export function DayDetail({ dayKey }: { dayKey: string }) {
  const router = useRouter();
  const timeZone = useBrowserTimeZone();
  const bounds = timeZone && parseDayKey(dayKey) ? calendarDayBounds(dayKey, timeZone) : null;
  const day = useQuery(
    api.sessions.listDay,
    bounds ? { startedFrom: bounds.start, startedUntil: bounds.end } : "skip",
  );
  const libraryQuery = useQuery(api.exercises.list);
  const log = useOfflineLog();
  const deleteDay = useMutation(api.sessions.removeDay);
  const setNote = useMutation(api.sessions.setNote);
  const createFromSessions = useMutation(api.routines.createFromSessions);
  const begin = useBeginWorkout();
  const unit = useWeightUnit();

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [manualPending, setManualPending] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState<Toasted | null>(null);
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [savingNoteId, setSavingNoteId] = useState<string | null>(null);
  const [manual, setManual] = useState<ManualState | null>(null);
  const [saveRoutineOpen, setSaveRoutineOpen] = useState(false);
  const [saveRoutineError, setSaveRoutineError] = useState<string | null>(null);
  const [saveRoutinePending, setSaveRoutinePending] = useState(false);

  const orderedSessions = useMemo(() => {
    const sessions = day?.sessions ?? [];
    return [...sessions].sort((left, right) => left.startedAt - right.startedAt || left._id.localeCompare(right._id));
  }, [day]);

  const visibleSets = useMemo(() => {
    const merged = orderedSessions.flatMap((session) =>
      mergeVisibleSets(session.sets, log.outbox, { kind: "session", sessionId: session._id }),
    );
    return canonicalExerciseIds(merged);
  }, [log.outbox, orderedSessions]);
  const groups = useMemo(() => groupPerformedSets(visibleSets), [visibleSets]);

  useEffect(() => {
    if (day?.sessions) {
      log.reconcile(day.sessions.flatMap((session) => session.sets));
    }
  }, [day, log]);

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

  const latest = orderedSessions[orderedSessions.length - 1] ?? null;

  async function saveAsRoutine(name: string) {
    setSaveRoutinePending(true);
    setSaveRoutineError(null);
    try {
      const routineId = await createFromSessions({
        name,
        sessionIds: orderedSessions.map((session) => session._id),
      });
      router.push(`/routines/${routineId}`);
    } catch (caught) {
      setSaveRoutineError(readableError(caught));
      setSaveRoutinePending(false);
    }
  }

  async function addManual(set: {
    exerciseName: string;
    reps?: number;
    weightLb: number;
    durationSec?: number;
    distanceM?: number;
    rpe?: number;
    setType?: SetLine["setType"];
  }) {
    const target =
      manual?.mode === "add"
        ? orderedSessions.find((session) => session._id === manual.sessionId)
        : latest;
    if (!target) {
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
        ...(set.setType !== undefined ? { setType: set.setType } : { setType: "working" as const }),
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
        sessionId: target._id,
        sessionStartedAt: target.startedAt,
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

  async function saveNote(sessionId: Id<"sessions">, current: string) {
    setSavingNoteId(sessionId);
    try {
      await setNote({ sessionId, note: noteDrafts[sessionId] ?? current });
      setNoteDrafts((drafts) => {
        const next = { ...drafts };
        delete next[sessionId];
        return next;
      });
    } catch (error) {
      showToast({ tone: "error", message: readableError(error) });
    } finally {
      setSavingNoteId(null);
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
    if (!bounds) {
      return;
    }
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteDay({ startedFrom: bounds.start, startedUntil: bounds.end });
      router.push("/history");
    } catch (error) {
      setDeleteError(readableError(error));
      setDeleting(false);
    }
  }

  if (!parseDayKey(dayKey) || (timeZone && !bounds)) {
    return (
      <div className="px-5 pt-3">
        <PageHeader backHref="/history" backLabel="Back to history" title="Day not found" />
        <p className="mt-3 text-base leading-normal text-muted">That day is not a calendar date.</p>
      </div>
    );
  }

  if (!timeZone || day === undefined) {
    return (
      <div className="px-5 pt-3">
        <PageHeader backHref="/history" backLabel="Back to history" title="Workout" />
        <p className="mt-8 text-base text-muted">
          {log.offline
            ? "You're offline. This day will load when you reconnect."
            : "Loading workout…"}
        </p>
      </div>
    );
  }

  if (orderedSessions.length === 0) {
    return (
      <div className="px-5 pt-3">
        <PageHeader backHref="/history" backLabel="Back to history" title="No workouts" />
        <p className="mt-3 text-base leading-normal text-muted">
          No finished workouts on this day.
        </p>
      </div>
    );
  }

  const anchor = orderedSessions[0];
  if (!anchor || !latest) {
    return null;
  }
  const durationMs = orderedSessions.reduce((sum, session) => {
    if (session.completedAt !== null && session.completedAt > session.startedAt) {
      return sum + (session.completedAt - session.startedAt);
    }
    return sum;
  }, 0);
  const serverSetCount = orderedSessions.reduce((sum, session) => sum + session.sets.length, 0);
  const meta = [
    orderedSessions.length === 1
      ? formatTimeOfDay(anchor.startedAt)
      : pluralize(orderedSessions.length, "workout"),
    durationMs > 0 ? formatDuration(durationMs) : null,
    pluralize(groups.length, "exercise"),
    pluralize(visibleSets.length, "set"),
    formatVolumeLb(volumeLb(visibleSets), unit),
  ]
    .filter((part) => part !== null)
    .join(" · ");
  const dateLabel = formatLongDate(anchor.startedAt);

  return (
    <div className="px-5 pt-3 pb-[calc(32px+env(safe-area-inset-bottom))]">
      <PageHeader
        backHref="/history"
        backLabel="Back to history"
        title={<span suppressHydrationWarning>{dateLabel}</span>}
      >
        <p className="mt-1.5 text-base text-pretty text-muted" suppressHydrationWarning>
          {meta}
        </p>
        {orderedSessions.length > 1 ? (
          <p className="mt-1 text-sm text-pretty text-muted" suppressHydrationWarning>
            {orderedSessions.map((session) => formatTimeOfDay(session.startedAt)).join(" · ")}
          </p>
        ) : null}
        <div className="mt-4 flex flex-col gap-4">
          {orderedSessions.map((session) => {
            const draft = noteDrafts[session._id];
            const label =
              orderedSessions.length > 1
                ? `Note · ${formatTimeOfDay(session.startedAt)}`
                : "Note";
            return (
              <label key={session._id} className="block">
                <span
                  className="text-xs font-medium tracking-[0.06em] text-subtle uppercase"
                  suppressHydrationWarning
                >
                  {label}
                </span>
                <textarea
                  value={draft ?? session.note ?? ""}
                  onChange={(event) =>
                    setNoteDrafts((current) => ({
                      ...current,
                      [session._id]: event.target.value,
                    }))
                  }
                  maxLength={500}
                  rows={3}
                  placeholder="Optional. How the workout felt."
                  className="mt-2 w-full resize-none rounded-xl border border-line bg-background px-3 py-2 text-base outline-none focus:border-foreground"
                />
                {draft !== undefined ? (
                  <Button
                    variant="secondary"
                    className="mt-2"
                    disabled={savingNoteId === session._id}
                    onClick={() => void saveNote(session._id, session.note ?? "")}
                  >
                    {savingNoteId === session._id ? "Saving…" : "Save note"}
                  </Button>
                ) : null}
              </label>
            );
          })}
        </div>
      </PageHeader>

      <div className="mt-5 flex flex-wrap gap-2">
        <Button
          variant="secondary"
          onClick={() =>
            setManual({
              key: Date.now(),
              mode: "add",
              exerciseName: groups[groups.length - 1]?.name ?? "",
              sessionId: latest._id,
              sessionStartedAt: latest.startedAt,
            })
          }
        >
          Add a set
        </Button>
        <Button
          variant="secondary"
          disabled={begin.pending}
          onClick={() => void begin.repeatWorkouts(orderedSessions.map((session) => session._id))}
        >
          {orderedSessions.length > 1 ? "Repeat this day" : "Repeat this workout"}
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            setSaveRoutineError(null);
            setSaveRoutineOpen(true);
          }}
        >
          Save as routine
        </Button>
        {day.truncated ? (
          <p className="text-sm text-pretty text-muted">
            This day has more workouts than can be deleted from here.
          </p>
        ) : (
          <Button
            variant="danger"
            onClick={() => {
              setDeleteError(null);
              setDeleteOpen(true);
            }}
          >
            Delete day
          </Button>
        )}
      </div>
      {begin.error ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          {begin.error}
        </p>
      ) : null}

      {groups.length === 0 ? (
        <p className="mt-8 text-base text-muted">No sets were logged.</p>
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
              expanded={expandedId === group.exerciseId}
              onToggle={() =>
                setExpandedId((current) => (current === group.exerciseId ? null : group.exerciseId))
              }
              onEditSet={(set: SetLine) =>
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
                  setType: set.setType,
                })
              }
              onRemoveSet={(setId) => void deleteSet(setId)}
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
                  setType: manual.setType,
                }
              : undefined
          }
          library={library}
          truncatedLibrary={libraryQuery?.truncated}
          sessionSets={visibleSets}
          excludeSessionId={manual.mode === "add" ? manual.sessionId : latest._id}
          pending={manualPending}
          onClose={() => setManual(null)}
          onAdd={addManual}
        />
      ) : null}

      <SaveRoutineSheet
        key={saveRoutineOpen ? orderedSessions.map((session) => session._id).join("-") : "closed"}
        open={saveRoutineOpen}
        defaultName={suggestRoutineName(anchor.startedAt)}
        summary={
          groups.length > 0
            ? groups.map((group) => group.name).join(", ")
            : pluralize(orderedSessions.length, "workout")
        }
        pending={saveRoutinePending}
        error={saveRoutineError}
        onCancel={() => setSaveRoutineOpen(false)}
        onSave={(name) => void saveAsRoutine(name)}
      />
      <OpenWorkoutSheet
        open={begin.promptOpen}
        onClose={begin.closePrompt}
        onContinue={begin.continueOpen}
      />

      <DeleteWorkoutSheet
        open={deleteOpen}
        summary={dateLabel}
        title="Delete this day?"
        body={`This permanently deletes ${pluralize(orderedSessions.length, "workout")} and ${pluralize(serverSetCount, "set")} from ${dateLabel}. This can't be undone.`}
        confirmLabel="Delete day"
        cancelLabel="Keep day"
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
