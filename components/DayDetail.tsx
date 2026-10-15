"use client";

import { Button } from "@/components/Button";
import { WorkoutSummaryCard } from "@/components/WorkoutSummaryCard";
import { useOfflineLog } from "@/components/OfflineSync";
import { PageHeader } from "@/components/PageHeader";
import { OpenWorkoutSheet } from "@/components/routines/OpenWorkoutSheet";
import { SaveRoutineSheet } from "@/components/routines/SaveRoutineSheet";
import { useBeginWorkout } from "@/components/routines/useBeginWorkout";
import { Toast, type ToastMessage } from "@/components/Toast";
import { useBrowserTimeZone } from "@/components/useBrowserTimeZone";
import { useWeightUnit } from "@/components/WeightUnit";
import { DeleteWorkoutSheet } from "@/components/workout/DeleteWorkoutSheet";
import { ExerciseEditSheet } from "@/components/workout/ExerciseEditSheet";
import { ExerciseRow } from "@/components/workout/ExerciseRow";
import { ManualEntrySheet } from "@/components/workout/ManualEntrySheet";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { formatExerciseName } from "@/convex/lib/exerciseName";
import { packSupersetOrder, supersetBlocks } from "@/convex/lib/superset";
import { exerciseLink } from "@/lib/exerciseLink";
import { readableError } from "@/lib/errors";
import { EXAMPLE_EXERCISES } from "@/lib/examples";
import {
  formatDayTitle,
  formatPersonalRecord,
  formatTimeOfDay,
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
import { summarizeSessions } from "@/lib/workoutSummary";
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
      calories: number | null;
      rpe: number | null;
      setType?: SetLine["setType"];
      sessionId: Id<"sessions">;
    };

type ExerciseTarget = {
  key: number;
  sessionId: Id<"sessions">;
  exerciseId: string;
  name: string;
};

type DeleteTarget =
  | { kind: "day" }
  | {
      kind: "session";
      sessionId: Id<"sessions">;
      label: string;
      setCount: number;
    };

/**
 * Every finished workout performed on one local calendar day.
 * Session documents stay separate: edits, new sets, and notes still target
 * one workout. A day with several workouts can delete one of them.
 * Delete day still removes every workout on that date.
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
  const deleteSession = useMutation(api.sessions.remove);
  const setNote = useMutation(api.sessions.setNote);
  const changeExercise = useMutation(api.sets.changeExercise);
  const createFromSessions = useMutation(api.routines.createFromSessions);
  const begin = useBeginWorkout();
  const unit = useWeightUnit();

  const [removingId, setRemovingId] = useState<string | null>(null);
  const [manualPending, setManualPending] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState<Toasted | null>(null);
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [savingNoteId, setSavingNoteId] = useState<string | null>(null);
  const [manual, setManual] = useState<ManualState | null>(null);
  const [exerciseTarget, setExerciseTarget] = useState<ExerciseTarget | null>(null);
  const [exercisePending, setExercisePending] = useState(false);
  const [exerciseError, setExerciseError] = useState<string | null>(null);
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
  const groups = useMemo(() => {
    const performed = groupPerformedSets(visibleSets);
    const supersetByExercise = new Map<string, string | null>();
    for (const session of orderedSessions) {
      for (const exercise of session.exercises) {
        if (!supersetByExercise.has(exercise.exerciseId)) {
          supersetByExercise.set(exercise.exerciseId, exercise.supersetId ?? null);
        }
      }
    }
    return packSupersetOrder(
      performed.map((group) => ({
        ...group,
        supersetId: supersetByExercise.get(group.exerciseId) ?? null,
      })),
    );
  }, [orderedSessions, visibleSets]);

  const groupsBySession = useMemo(() => {
    const bySession = new Map<string, typeof groups>();
    for (const session of orderedSessions) {
      const sets = canonicalExerciseIds(
        mergeVisibleSets(session.sets, log.outbox, { kind: "session", sessionId: session._id }),
      );
      const supersetByExercise = new Map<string, string | null>(
        session.exercises.map((exercise) => [exercise.exerciseId, exercise.supersetId ?? null]),
      );
      bySession.set(
        session._id,
        packSupersetOrder(
          groupPerformedSets(sets).map((group) => ({
            ...group,
            supersetId: supersetByExercise.get(group.exerciseId) ?? null,
          })),
        ),
      );
    }
    return bySession;
  }, [log.outbox, orderedSessions]);

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
    calories?: number;
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
        calories: set.calories ?? null,
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

  function sessionForSet(setId: string) {
    return orderedSessions.find((session) =>
      mergeVisibleSets(session.sets, log.outbox, {
        kind: "session",
        sessionId: session._id,
      }).some((set) => set._id === setId),
    );
  }

  async function restoreRemovedSets(sets: SetLine[], sessionId: string, sessionStartedAt: number) {
    setToast(null);
    const saved = await log.saveSets({
      placement: "completed",
      sessionId,
      sessionStartedAt,
      note: null,
      sets: sets.map((set) => ({
        exerciseName: set.exerciseName,
        weightLb: set.weightLb,
        reps: set.reps,
        durationSec: set.durationSec,
        distanceM: set.distanceM,
        calories: set.calories ?? null,
        rpe: set.rpe,
        ...(set.setType !== undefined ? { setType: set.setType } : {}),
        loggedAt: set.loggedAt,
      })),
    });
    if (saved.status === "rejected") {
      showToast({
        tone: "error",
        message: saved.error ?? (sets.length > 1 ? "Those sets could not be put back" : "That set could not be put back"),
      });
    }
  }

  async function deleteSet(setId: string) {
    if (removingId) {
      return;
    }
    const snapshot = visibleSets.find((set) => set._id === setId);
    const owner = sessionForSet(setId);
    setRemovingId(setId);
    const removed = await log.removeMany([setId]);
    setRemovingId(null);
    if (removed.status === "rejected" && removed.error) {
      showToast({ tone: "error", message: removed.error });
      return;
    }
    if (!snapshot || !owner) {
      if (removed.status === "queued") {
        showToast({ tone: "info", message: QUEUED_SAVE_MESSAGE });
      }
      return;
    }
    showToast({
      tone: "info",
      message:
        removed.status === "queued"
          ? `Removed ${snapshot.exerciseName}. ${QUEUED_SAVE_MESSAGE}`
          : `Removed ${snapshot.exerciseName}`,
      action: {
        label: "Undo",
        onClick: () => void restoreRemovedSets([snapshot], owner._id, owner.startedAt),
      },
    });
  }

  function editingGroup(target: ExerciseTarget | null) {
    if (!target) {
      return null;
    }
    return (
      groupsBySession.get(target.sessionId)?.find((group) => group.exerciseId === target.exerciseId) ??
      null
    );
  }

  function openExercise(sessionId: Id<"sessions">, group: { exerciseId: string; name: string }) {
    setExerciseError(null);
    setExerciseTarget({ key: Date.now(), sessionId, exerciseId: group.exerciseId, name: group.name });
  }

  function editSetFrom(sessionId: Id<"sessions">, set: SetLine) {
    setManual({
      key: Date.now(),
      mode: "edit",
      setId: set._id,
      sessionId,
      exerciseName: set.exerciseName,
      reps: set.reps,
      weightLb: set.weightLb,
      durationSec: set.durationSec,
      distanceM: set.distanceM,
      calories: set.calories ?? null,
      rpe: set.rpe,
      setType: set.setType,
    });
  }

  async function renameExercise(target: ExerciseTarget, sets: SetLine[], name: string) {
    const setIds = sets.map((set) => set._id as Id<"sets">);
    setExercisePending(true);
    setExerciseError(null);
    try {
      const renamed = await changeExercise({ setIds, exerciseName: name });
      setExerciseTarget(null);
      const previous = target.name;
      showToast({
        tone: "info",
        message: `Changed ${previous} to ${renamed.exerciseName}`,
        action: {
          label: "Undo",
          onClick: () => {
            setToast(null);
            changeExercise({ setIds, exerciseName: previous }).catch((caught: unknown) =>
              showToast({ tone: "error", message: readableError(caught) }),
            );
          },
        },
      });
    } catch (caught) {
      setExerciseError(readableError(caught));
    } finally {
      setExercisePending(false);
    }
  }

  async function deleteExercise(target: ExerciseTarget, sets: SetLine[]) {
    const owner = orderedSessions.find((session) => session._id === target.sessionId);
    setExercisePending(true);
    setExerciseError(null);
    const removed = await log.removeMany(sets.map((set) => set._id));
    setExercisePending(false);
    if (removed.status === "rejected") {
      setExerciseError(removed.error ?? "That exercise could not be removed");
      return;
    }
    setExerciseTarget(null);
    const message = `Removed ${target.name}, ${pluralize(sets.length, "set")}`;
    showToast({
      tone: "info",
      message: removed.status === "queued" ? `${message}. ${QUEUED_SAVE_MESSAGE}` : message,
      ...(owner
        ? {
            action: {
              label: "Undo",
              onClick: () => void restoreRemovedSets(sets, owner._id, owner.startedAt),
            },
          }
        : {}),
    });
  }

  async function confirmDelete() {
    if (!deleteTarget) {
      return;
    }
    setDeleting(true);
    setDeleteError(null);
    try {
      if (deleteTarget.kind === "session") {
        await deleteSession({ sessionId: deleteTarget.sessionId });
        setDeleteTarget(null);
        setDeleting(false);
        return;
      }
      if (!bounds) {
        setDeleting(false);
        return;
      }
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
  const summary = summarizeSessions(
    orderedSessions.map((session) => ({
      startedAt: session.startedAt,
      completedAt: session.completedAt,
      sets: mergeVisibleSets(session.sets, log.outbox, { kind: "session", sessionId: session._id }),
    })),
  );
  const dateLabel = formatDayTitle(anchor.startedAt);
  const editingExercise = editingGroup(exerciseTarget);
  const serverSetCount = orderedSessions.reduce((sum, session) => sum + session.sets.length, 0);

  return (
    <div className="px-5 pt-3 pb-[calc(32px+var(--page-inset))]">
      <PageHeader
        backHref="/history"
        backLabel="Back to history"
        title={<span suppressHydrationWarning>{dateLabel}</span>}
      >
        <div className="mt-4">
          <WorkoutSummaryCard summary={summary} records={day.personalRecords} unit={unit} />
        </div>
        {orderedSessions.length > 1 ? (
          <p className="mt-1 text-sm text-pretty text-muted" suppressHydrationWarning>
            {orderedSessions.map((session) => formatTimeOfDay(session.startedAt)).join(" · ")}
          </p>
        ) : null}
      </PageHeader>

      {orderedSessions.length > 1 ? (
        <div className="mt-6 flex flex-col gap-8">
          {orderedSessions.map((session) => {
            const sessionGroups = groupsBySession.get(session._id) ?? [];
            const when = formatTimeOfDay(session.startedAt);
            return (
              <section key={session._id} aria-label={`Workout at ${when}`}>
                <h2 className="text-lg font-semibold tracking-[-0.02em]" suppressHydrationWarning>
                  {when}
                </h2>
                <div className="mt-3">
                  <SessionNote
                    note={session.note}
                    draft={noteDrafts[session._id]}
                    saving={savingNoteId === session._id}
                    onDraft={(value) =>
                      setNoteDrafts((current) => ({ ...current, [session._id]: value }))
                    }
                    onSave={() => void saveNote(session._id, session.note ?? "")}
                  />
                </div>
                <DayExerciseList
                  groups={sessionGroups}
                  from={`/history/day/${dayKey}`}
                  onEdit={(set) => editSetFrom(session._id, set)}
                  onEditExercise={(group) => openExercise(session._id, group)}
                />
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    onClick={() =>
                      setManual({
                        key: Date.now(),
                        mode: "add",
                        exerciseName: sessionGroups[sessionGroups.length - 1]?.name ?? "",
                        sessionId: session._id,
                        sessionStartedAt: session.startedAt,
                      })
                    }
                  >
                    Add a set
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={begin.pending}
                    onClick={() => void begin.repeatWorkouts([session._id])}
                  >
                    Repeat
                  </Button>
                  <Button
                    variant="danger"
                    onClick={() => {
                      setDeleteError(null);
                      setDeleteTarget({
                        kind: "session",
                        sessionId: session._id,
                        label: when,
                        setCount: session.sets.length,
                      });
                    }}
                  >
                    Delete workout
                  </Button>
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <DayExerciseList
          groups={groups}
          from={`/history/day/${dayKey}`}
          onEdit={(set) => editSetFrom(anchor._id, set)}
          onEditExercise={(group) => openExercise(anchor._id, group)}
        />
      )}

      {orderedSessions.length === 1 ? (
        <div className="mt-6">
          <SessionNote
            note={anchor.note}
            draft={noteDrafts[anchor._id]}
            saving={savingNoteId === anchor._id}
            onDraft={(value) =>
              setNoteDrafts((current) => ({ ...current, [anchor._id]: value }))
            }
            onSave={() => void saveNote(anchor._id, anchor.note ?? "")}
          />
        </div>
      ) : null}

      <div className="mt-6 flex flex-wrap gap-2">
        {orderedSessions.length === 1 ? (
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
        ) : null}
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
      </div>
      {begin.error ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          {begin.error}
        </p>
      ) : null}


      {/* Delete sits apart from the everyday actions so it is never a mis-tap away. */}
      <div className="mt-10 border-t border-line pt-4">
        {day.truncated ? (
          <p className="text-sm text-pretty text-muted">
            This day has more workouts than can be deleted from here.
          </p>
        ) : (
          <Button
            variant="danger"
            onClick={() => {
              setDeleteError(null);
              setDeleteTarget({ kind: "day" });
            }}
          >
            Delete day
          </Button>
        )}
      </div>

      {exerciseTarget && editingExercise ? (
        <ExerciseEditSheet
          key={exerciseTarget.key}
          open
          name={editingExercise.name}
          sets={editingExercise.sets}
          offline={log.offline}
          pending={exercisePending}
          error={exerciseError}
          onClose={() => setExerciseTarget(null)}
          onEditSet={(set) => {
            setExerciseTarget(null);
            editSetFrom(exerciseTarget.sessionId, set);
          }}
          onRemoveSet={(setId) => void deleteSet(setId)}
          onAddSet={() => {
            const owner = orderedSessions.find((session) => session._id === exerciseTarget.sessionId);
            setExerciseTarget(null);
            if (owner) {
              setManual({
                key: Date.now(),
                mode: "add",
                exerciseName: editingExercise.name,
                sessionId: owner._id,
                sessionStartedAt: owner.startedAt,
              });
            }
          }}
          onRename={(name) => void renameExercise(exerciseTarget, editingExercise.sets, name)}
          onDelete={() => void deleteExercise(exerciseTarget, editingExercise.sets)}
        />
      ) : null}

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
                  calories: manual.calories,
                  rpe: manual.rpe,
                  setType: manual.setType,
                }
              : undefined
          }
          library={library}
          truncatedLibrary={libraryQuery?.truncated}
          sessionSets={visibleSets}
          excludeSessionId={manual.sessionId}
          pending={manualPending}
          onClose={() => setManual(null)}
          onAdd={addManual}
          onDelete={
            manual.mode === "edit"
              ? () => {
                  const setId = manual.setId;
                  setManual(null);
                  void deleteSet(setId);
                }
              : undefined
          }
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
        open={deleteTarget !== null}
        summary={deleteTarget?.kind === "session" ? deleteTarget.label : dateLabel}
        title={deleteTarget?.kind === "session" ? "Delete this workout?" : "Delete this day?"}
        body={
          deleteTarget?.kind === "session"
            ? `This permanently deletes this workout and ${pluralize(deleteTarget.setCount, "set")}. The other workouts on ${dateLabel} stay. This can't be undone.`
            : `This permanently deletes ${pluralize(orderedSessions.length, "workout")} and ${pluralize(serverSetCount, "set")} from ${dateLabel}. This can't be undone.`
        }
        confirmLabel={deleteTarget?.kind === "session" ? "Delete workout" : "Delete day"}
        cancelLabel={deleteTarget?.kind === "session" ? "Keep workout" : "Keep day"}
        pending={deleting}
        error={deleteError}
        offline={log.offline}
        onCancel={() => setDeleteTarget(null)}
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

function SessionNote({
  note,
  draft,
  saving,
  onDraft,
  onSave,
}: {
  note: string | null;
  draft: string | undefined;
  saving: boolean;
  onDraft: (value: string) => void;
  onSave: () => void;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium tracking-[0.06em] text-subtle uppercase">Note</span>
      <textarea
        value={draft ?? note ?? ""}
        onChange={(event) => onDraft(event.target.value)}
        maxLength={500}
        rows={2}
        placeholder="Optional. How the workout felt."
        className="mt-1.5 w-full resize-none rounded-xl border border-input bg-background px-3 py-2 text-base outline-none focus:border-foreground"
      />
      {draft !== undefined ? (
        <Button variant="secondary" className="mt-2" disabled={saving} onClick={onSave}>
          {saving ? "Saving…" : "Save note"}
        </Button>
      ) : null}
    </label>
  );
}

function DayExerciseList({
  groups,
  from,
  onEdit,
  onEditExercise,
}: {
  groups: Array<{
    exerciseId: string;
    name: string;
    sets: SetLine[];
    supersetId?: string | null;
  }>;
  from: string;
  onEdit: (set: SetLine) => void;
  onEditExercise: (group: { exerciseId: string; name: string }) => void;
}) {
  if (groups.length === 0) {
    return <p className="mt-4 text-base text-muted">No sets were logged.</p>;
  }
  return (
    <ul aria-label="Exercises" className="mt-4 flex flex-col border-t border-line">
      {supersetBlocks(groups).map((block) => (
        <li
          key={block.items.map((item) => item.exerciseId).join(":")}
          className={block.supersetId ? "border-l-2 border-foreground pl-3" : undefined}
        >
          {block.supersetId ? (
            <p className="pt-3 text-xs font-medium tracking-[0.06em] text-subtle uppercase">
              Superset
            </p>
          ) : null}
          <ul>
            {block.items.map((group) => (
              <ExerciseRow
                key={group.exerciseId}
                name={group.name}
                sets={group.sets}
                exerciseHref={exerciseLink(group.exerciseId, from) ?? undefined}
                onEditSet={onEdit}
                onEditExercise={() => onEditExercise(group)}
              />
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}
