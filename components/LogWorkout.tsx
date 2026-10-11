"use client";

import { useOfflineLog, type SyncOutcome } from "@/components/OfflineSync";
import { Toast, type ToastMessage } from "@/components/Toast";
import { ActiveWorkout } from "@/components/workout/ActiveWorkout";
import { ConfirmSheet } from "@/components/workout/ConfirmSheet";
import { FinishSheet } from "@/components/workout/FinishSheet";
import { HomeView } from "@/components/workout/HomeView";
import { ListeningOverlay } from "@/components/workout/ListeningOverlay";
import { ManualEntrySheet } from "@/components/workout/ManualEntrySheet";
import { StaleWorkoutSheet } from "@/components/workout/StaleWorkoutSheet";
import { blobToBase64, requestProposal } from "@/components/workout/requestProposal";
import { useRecorder } from "@/components/workout/useRecorder";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { formatExerciseName } from "@/convex/lib/exerciseName";
import { plannedCompletedAt, workoutLooksStale } from "@/convex/lib/sessionTiming";
import { readableError } from "@/lib/errors";
import { EXAMPLE_EXERCISES } from "@/lib/examples";
import { useWeightUnit } from "@/components/WeightUnit";
import { formatDuration, formatPersonalRecord, formatPersonalRecords, pluralize } from "@/lib/format";
import { localWeekFirstDay, weekRange } from "@/convex/lib/week";
import { groupSets, type SetLine } from "@/lib/groupSets";
import {
  OFFLINE_TYPED_MESSAGE,
  OFFLINE_VOICE_MESSAGE,
  QUEUED_FINISH_MESSAGE,
  QUEUED_SAVE_MESSAGE,
} from "@/lib/offline/messages";
import {
  hasPendingFinish,
  mergeVisibleSets,
  pendingNote,
  pendingResumedAt,
} from "@/lib/offline/outbox";
import {
  draftToProposal,
  proposalToDraft,
  proposalToSave,
  reduceVoiceLog,
  type VoiceDraft,
} from "@/lib/voice/confirm";
import { useBrowserTimeZone } from "@/components/useBrowserTimeZone";
import { calendarDayBounds, calendarDayKey, groupHistoryDays } from "@/lib/historyDays";
import { useQuery } from "convex/react";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";

type Toasted = ToastMessage & { id: number };

/**
 * The Log tab. With no open workout it shows the start screen; the first set
 * confirmed by voice, by typing, or by hand opens one.
 */
function combinedNote(existing: string | null | undefined, extra: string | null): string | null {
  if (!extra) {
    return existing ?? null;
  }
  if (!existing) {
    return extra;
  }
  if (existing.includes(extra)) {
    return existing;
  }
  return `${existing}\n${extra}`;
}

export function LogWorkout() {
  const openSession = useQuery(api.sessions.getOpen);
  const exercises = useQuery(api.exercises.list);
  const sets = useQuery(
    api.sets.listForSession,
    openSession ? { sessionId: openSession._id } : "skip",
  );
  const history = useQuery(
    api.sessions.listHistory,
    openSession === null ? { paginationOpts: { numItems: 1, cursor: null } } : "skip",
  );
  const timeZone = useBrowserTimeZone();
  const latestStartedAt = history?.page[0]?.startedAt;
  const latestDay = useMemo(() => {
    if (!timeZone || latestStartedAt === undefined) {
      return null;
    }
    return calendarDayBounds(calendarDayKey(latestStartedAt, timeZone), timeZone);
  }, [latestStartedAt, timeZone]);
  const latestDaySessions = useQuery(
    api.sessions.listDay,
    openSession === null && latestDay
      ? { startedFrom: latestDay.start, startedUntil: latestDay.end }
      : "skip",
  );
  const log = useOfflineLog();
  const { offline, outbox, snapshot } = log;
  const lastWorkout = useMemo(() => {
    if (history === undefined || !timeZone) {
      return undefined;
    }
    const latest = history.page[0];
    if (!latest) {
      return null;
    }
    if (!offline && latestDay && latestDaySessions === undefined) {
      return undefined;
    }
    const rows =
      latestDaySessions && latestDaySessions.sessions.length > 0
        ? latestDaySessions.sessions.map((session) => ({
            id: session._id,
            startedAt: session.startedAt,
            completedAt: session.completedAt ?? session.startedAt,
            status: "completed" as const,
            volumeLb: session.volumeLb,
            exercises: session.exercises.map((exercise) => ({
              exerciseId: exercise.exerciseId,
              name: exercise.name,
              setCount: exercise.setCount,
            })),
          }))
        : [
            {
              id: latest._id,
              startedAt: latest.startedAt,
              completedAt: latest.completedAt,
              status: "completed" as const,
              volumeLb: latest.volumeLb ?? 0,
              exercises: latest.exercises.map((exercise) => ({
                exerciseId: exercise.exerciseId,
                name: exercise.name,
                setCount: exercise.setCount,
              })),
            },
          ];
    return groupHistoryDays(rows, timeZone)[0] ?? null;
  }, [history, latestDay, latestDaySessions, offline, timeZone]);

  const unit = useWeightUnit();
  const [voice, dispatch] = useReducer(reduceVoiceLog, { status: "idle" });
  const [source, setSource] = useState<"voice" | "text">("voice");
  const [draft, setDraft] = useState<VoiceDraft | null>(null);
  const [sheetNotice, setSheetNotice] = useState<string | null>(null);
  const [text, setText] = useState("");
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
  const [finishNote, setFinishNote] = useState("");
  const [manualPending, setManualPending] = useState(false);
  const [finishOpen, setFinishOpen] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);
  const [ending, setEnding] = useState(false);
  const [keeping, setKeeping] = useState(false);
  const [now, setNow] = useState(0);
  const week = useMemo(
    () => (now > 0 ? weekRange(now, localWeekFirstDay(navigator.language)) : null),
    [now],
  );
  const weekSummary = useQuery(
    api.sessions.weeklySummary,
    openSession === null && week
      ? { weekStarts: week.weekStarts, weekEndsAt: week.weekEndsAt }
      : "skip",
  );
  const [toast, setToast] = useState<Toasted | null>(null);
  const [repeatingId, setRepeatingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const parseAbortRef = useRef<AbortController | null>(null);

  const recorder = useRecorder({
    onAudio: (blob) => void parseAudio(blob),
    onError: (message) => dispatch({ type: "failed", message }),
  });

  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      window.clearInterval(timer);
      parseAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (sets) {
      log.reconcile(sets);
    }
  }, [log, sets]);

  useEffect(() => {
    if (openSession === undefined) {
      return;
    }
    if (openSession && sets === undefined) {
      return;
    }
    log.rememberWorkout({
      session: openSession,
      sets: sets ?? [],
    });
  }, [log, openSession, sets]);

  const knownSession = openSession !== undefined ? openSession : (snapshot?.session ?? null);
  const sessionSets = useMemo(() => {
    const serverSets =
      sets ?? (openSession === null ? [] : openSession === undefined ? (snapshot?.sets ?? []) : []);
    return mergeVisibleSets(serverSets, outbox, {
      kind: "open",
      sessionId: knownSession?._id ?? null,
    });
  }, [knownSession?._id, openSession, outbox, sets, snapshot?.sets]);
  const groups = useMemo(() => groupSets(sessionSets), [sessionSets]);
  const newestSetId = useMemo(() => {
    let newest: (typeof sessionSets)[number] | undefined;
    for (const set of sessionSets) {
      if (!newest || set.loggedAt >= newest.loggedAt) {
        newest = set;
      }
    }
    return newest?._id;
  }, [sessionSets]);

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
    [...groups].reverse().forEach((group) => add(group.name));
    exercises?.exercises.forEach((exercise) => add(exercise.name));
    EXAMPLE_EXERCISES.forEach(add);
    return names;
  }, [groups, exercises]);

  function showToast(message: ToastMessage) {
    setToast({ ...message, id: Date.now() });
  }

  function showSaved(saved: SyncOutcome, exerciseName: string) {
    if (saved.status === "queued") {
      showToast({ tone: "info", message: QUEUED_SAVE_MESSAGE });
      return;
    }
    const count = saved.setIds.length || saved.clientIds.length;
    if (count === 0) {
      return;
    }
    const added = `Added ${pluralize(count, "set")} · ${exerciseName}`;
    const record = formatPersonalRecords(saved.personalRecords, unit);
    const undoIds = saved.setIds.length > 0 ? saved.setIds : saved.clientIds;
    showToast({
      tone: "info",
      message: record ? `${record}. ${added}` : added,
      action: { label: "Undo", onClick: () => void undo(undoIds) },
    });
  }

  async function undo(ids: string[]) {
    setToast(null);
    const removed = await log.removeMany(ids);
    if (removed.status === "rejected" && removed.error) {
      showToast({ tone: "error", message: removed.error });
    }
  }

  function openTarget() {
    const session = knownSession;
    return {
      sessionId: session?._id ?? null,
      sessionStartedAt: session?.startedAt ?? Date.now(),
    };
  }

  // Voice and typed parsing.

  const voiceBusy =
    voice.status === "recording" || voice.status === "parsing" || voice.status === "saving";

  async function startVoice() {
    if (offline) {
      dispatch({ type: "failed", message: OFFLINE_VOICE_MESSAGE });
      return;
    }
    if (voiceBusy) {
      return;
    }
    setToast(null);
    parseAbortRef.current?.abort();
    const started = await recorder.start();
    if (started) {
      setSource("voice");
      setDraft(null);
      setSheetNotice(null);
      dispatch({ type: "start-recording" });
    }
  }

  function stopVoice() {
    dispatch({ type: "submit-audio" });
    recorder.stop();
  }

  function cancelVoice() {
    recorder.cancel();
    parseAbortRef.current?.abort();
    dispatch({ type: "cancel" });
  }

  async function parseAudio(blob: Blob) {
    try {
      const audioBase64 = await blobToBase64(blob);
      await parse({ audioBase64, mimeType: blob.type });
    } catch (error) {
      dispatch({ type: "failed", message: readableError(error) });
    }
  }

  async function submitText() {
    const value = text.trim();
    if (offline) {
      dispatch({ type: "failed", message: OFFLINE_TYPED_MESSAGE });
      return;
    }
    if (value.length === 0 || voiceBusy) {
      return;
    }
    setToast(null);
    setSource("text");
    dispatch({ type: "submit-text" });
    if (await parse({ text: value })) {
      setText("");
    }
  }

  async function parse(body: Parameters<typeof requestProposal>[0]): Promise<boolean> {
    parseAbortRef.current?.abort();
    const controller = new AbortController();
    parseAbortRef.current = controller;
    try {
      const proposal = await requestProposal(body, controller.signal);
      if (controller.signal.aborted) {
        return false;
      }
      setDraft(proposalToDraft(proposal, unit));
      setSheetNotice(null);
      dispatch({ type: "parsed", proposal });
      return true;
    } catch (error) {
      if (!controller.signal.aborted) {
        dispatch({ type: "failed", message: readableError(error) });
      }
      return false;
    }
  }

  async function confirmDraft() {
    if (voice.status !== "preview" || !draft) {
      return;
    }
    const edited = draftToProposal(draft, unit);
    if (!edited) {
      setSheetNotice("Check each exercise and its sets. Nothing was saved.");
      return;
    }
    const toSave = proposalToSave(voice, { type: "confirm", proposal: edited });
    if (!toSave) {
      return;
    }
    dispatch({ type: "confirm", proposal: toSave });
    setSheetNotice(null);
    const target = openTarget();
    const saved = await log.saveSets({
      placement: "open",
      sessionId: target.sessionId,
      sessionStartedAt: target.sessionStartedAt,
      note: toSave.note,
      sets: toSave.exercises.flatMap((exercise) =>
        exercise.sets.map((set) => ({
          exerciseName: exercise.exerciseName,
          weightLb: set.weightLb,
          reps: set.reps,
          durationSec: set.durationSec,
          distanceM: set.distanceM,
          rpe: set.rpe,
        })),
      ),
    });
    if (saved.status === "rejected") {
      setDraft(proposalToDraft(toSave, unit));
      dispatch({ type: "save-failed", proposal: toSave });
      setSheetNotice(saved.error ?? "That set could not be saved");
      return;
    }
    dispatch({ type: "saved" });
    setDraft(null);
    showSaved(
      saved,
      toSave.exercises.map((exercise) => exercise.exerciseName).join(", "),
    );
  }

  function discardDraft() {
    setDraft(null);
    setSheetNotice(null);
    dispatch({ type: "discard" });
  }

  // Manual sets, repeats, removals, and finishing.

  function openManual() {
    if (voice.status === "error") {
      dispatch({ type: "dismiss" });
    }
    setToast(null);
    setManual({
      key: Date.now(),
      mode: "add",
      exerciseName: groups[groups.length - 1]?.name ?? "",
    });
  }

  function openEdit(set: SetLine) {
    if (voice.status === "error") {
      dispatch({ type: "dismiss" });
    }
    setToast(null);
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
      });
  }

  async function addManual(set: {
    exerciseName: string;
    reps?: number;
    weightLb: number;
    durationSec?: number;
    distanceM?: number;
    rpe?: number;
  }) {
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
          clientId: sessionSets.find((item) => item._id === manual.setId)?.clientId,
          ...measures,
        });
        if (saved.status === "rejected") {
          return saved.error ?? "That set could not be saved";
        }
        setManual(null);
        if (saved.status === "queued") {
          showToast({ tone: "info", message: QUEUED_SAVE_MESSAGE });
        } else if (saved.personalRecords[0]) {
          showToast({
            tone: "info",
            message: formatPersonalRecord(saved.personalRecords[0], unit),
          });
        }
        return null;
      }
      const target = openTarget();
      const saved = await log.saveSets({
        placement: "open",
        sessionId: target.sessionId,
        sessionStartedAt: target.sessionStartedAt,
        note: null,
        sets: [{ exerciseName: set.exerciseName, ...measures }],
      });
      if (saved.status === "rejected") {
        return saved.error ?? "That set could not be saved";
      }
      setManual(null);
      showSaved(saved, set.exerciseName);
      return null;
    } finally {
      setManualPending(false);
    }
  }

  async function repeatSet(group: { exerciseId: string; name: string; sets: SetLine[] }) {
    const last = group.sets[group.sets.length - 1];
    if (!last) {
      return;
    }
    setRepeatingId(group.exerciseId);
    const target = openTarget();
    const saved = await log.saveSets({
      placement: "open",
      sessionId: target.sessionId,
      sessionStartedAt: target.sessionStartedAt,
      note: null,
      sets: [
        {
          exerciseName: group.name,
          weightLb: last.weightLb,
          reps: last.reps,
          durationSec: last.durationSec,
          distanceM: last.distanceM,
          rpe: last.rpe,
        },
      ],
    });
    setRepeatingId(null);
    if (saved.status === "rejected") {
      showToast({ tone: "error", message: saved.error ?? "That set could not be saved" });
      return;
    }
    showSaved(saved, group.name);
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

  async function keepWorkoutGoing() {
    if (!knownSession && sessionSets.length === 0) {
      return;
    }
    setKeeping(true);
    setFinishError(null);
    const saved = await log.keepGoing({
      sessionId: knownSession?._id ?? null,
      requestedAt: Date.now(),
    });
    setKeeping(false);
    if (saved.status === "rejected") {
      setFinishError(saved.error);
      return;
    }
    setFinishOpen(false);
  }

  async function finishWorkout() {
    if (!knownSession && sessionSets.length === 0) {
      return;
    }
    setEnding(true);
    setFinishError(null);
    const saved = await log.finishWorkout({
      sessionId: knownSession?._id ?? null,
      requestedAt: Date.now(),
      ...(finishOpen ? { note: finishNote } : {}),
    });
    setEnding(false);
    if (saved.status === "rejected") {
      setFinishError(saved.error);
      return;
    }
    setFinishOpen(false);
    showToast({
      tone: "info",
      message: saved.status === "queued" ? QUEUED_FINISH_MESSAGE : "Workout saved to History.",
    });
  }

  async function discardWorkout() {
    if (!knownSession && sessionSets.length === 0) {
      return;
    }
    setEnding(true);
    const saved = await log.discardWorkout({
      sessionId: knownSession?._id ?? null,
      requestedAt: Date.now(),
    });
    setEnding(false);
    if (saved.status === "rejected" && saved.error) {
      showToast({ tone: "error", message: saved.error });
    }
  }

  if (!offline && (openSession === undefined || exercises === undefined)) {
    return (
      <div className="flex min-h-[70dvh] items-center justify-center">
        <p className="text-base text-muted">Loading your workout…</p>
      </div>
    );
  }

  const clockNow = now > 0 ? now : null;
  const viewSessionId = knownSession?._id ?? null;
  const discarding = outbox.actions.some((action) => {
    if (action.kind !== "discard" || action.echoed || action.syncError) {
      return false;
    }
    if (viewSessionId) {
      return action.sessionId === viewSessionId || action.sessionClientId === outbox.openSessionClientId;
    }
    return action.sessionClientId === outbox.openSessionClientId;
  });
  const showWorkout = !discarding && (knownSession !== null || sessionSets.length > 0);
  const startedAt =
    knownSession?.startedAt ??
    outbox.sets.find((set) => set.placement === "open" && !set.removed)?.sessionStartedAt ??
    (clockNow ?? Date.now());
  const loggedLast = sessionSets.reduce((max, set) => Math.max(max, set.loggedAt), 0);
  const lastSetAt = Math.max(knownSession?.lastSetAt ?? 0, loggedLast) || null;
  const resumedAt =
    Math.max(knownSession?.resumedAt ?? 0, pendingResumedAt(outbox, viewSessionId) ?? 0) || null;
  const stale =
    showWorkout &&
    !hasPendingFinish(outbox, viewSessionId) &&
    clockNow !== null &&
    workoutLooksStale(clockNow, startedAt, lastSetAt, resumedAt);
  const voiceOrManualOpen =
    voice.status === "recording" ||
    voice.status === "parsing" ||
    voice.status === "preview" ||
    voice.status === "saving" ||
    manual !== null;
  const showStale = stale && !voiceOrManualOpen;
  const savedEnd =
    lastSetAt !== null
      ? plannedCompletedAt({
          now: clockNow ?? Date.now(),
          startedAt,
          lastSetAt,
        })
      : (clockNow ?? Date.now());
  const idleTrimmed = lastSetAt !== null && (clockNow ?? Date.now()) - savedEnd >= 60_000;
  const workoutNote = combinedNote(
    knownSession?.note,
    pendingNote(outbox, { kind: "open", sessionId: viewSessionId }),
  );

  const activeToast: Toasted | null =
    voice.status === "error"
      ? {
          id: -1,
          tone: "error",
          message: voice.message,
          action: { label: "Add by hand", onClick: openManual },
        }
      : toast;

  return (
    <>
      {showWorkout ? (
        <ActiveWorkout
          startedAt={startedAt}
          groups={groups}
          setCount={sessionSets.length}
          newestSetId={newestSetId}
          loadingSets={sets === undefined && !offline && knownSession !== null}
          repeatingId={repeatingId}
          removingId={removingId}
          ending={ending}
          note={workoutNote}
          emptyMessage={
            offline ? "No sets yet. Add one by hand. Voice needs a connection." : undefined
          }
          idleNote={
            stale && clockNow !== null && lastSetAt !== null
              ? `last set ${formatDuration(clockNow - lastSetAt)} ago`
              : undefined
          }
          onRepeat={(group) => void repeatSet(group)}
          onEditSet={openEdit}
          onRemoveSet={(setId) => void deleteSet(setId)}
          onFinish={() => {
            setFinishError(null);
            if (!stale) {
              setFinishNote(workoutNote ?? "");
              setFinishOpen(true);
            }
          }}
          onDiscard={() => void discardWorkout()}
          composer={{
            text,
            onTextChange: setText,
            onSubmitText: () => void submitText(),
            parsingText: voice.status === "parsing" && source === "text",
            onVoice: () => void startVoice(),
            onManual: openManual,
            busy: voiceBusy,
            offline,
          }}
        />
      ) : (
        <HomeView
          lastWorkout={lastWorkout}
          weekSummary={weekSummary}
          voiceBusy={voiceBusy}
          offline={offline}
          onVoice={() => void startVoice()}
          onManual={openManual}
        />
      )}

      <Toast
        key={activeToast ? `${activeToast.id}-${activeToast.message}` : "none"}
        toast={activeToast}
        raised={showWorkout}
        onDismiss={() => {
          if (voice.status === "error") {
            dispatch({ type: "dismiss" });
          } else {
            setToast(null);
          }
        }}
      />

      {voice.status === "recording" || (voice.status === "parsing" && source === "voice") ? (
        <ListeningOverlay
          status={voice.status}
          elapsedMs={recorder.elapsedMs}
          analyser={recorder.analyser}
          onStop={stopVoice}
          onCancel={cancelVoice}
        />
      ) : null}

      <ConfirmSheet
        open={voice.status === "preview" || voice.status === "saving"}
        draft={draft}
        source={source}
        saving={voice.status === "saving"}
        notice={sheetNotice}
        excludeSessionId={knownSession ? (knownSession._id as Id<"sessions">) : undefined}
        onChange={setDraft}
        onDiscard={discardDraft}
        onConfirm={() => void confirmDraft()}
        onRecordAgain={() => void startVoice()}
      />

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
          truncatedLibrary={exercises?.truncated ?? false}
          sessionSets={sessionSets}
          excludeSessionId={knownSession ? (knownSession._id as Id<"sessions">) : undefined}
          pending={manualPending}
          onClose={() => setManual(null)}
          onAdd={addManual}
        />
      ) : null}

      <FinishSheet
        open={finishOpen && !showStale}
        summary={`${pluralize(groups.length, "exercise")} · ${pluralize(sessionSets.length, "set")} · ${formatDuration(savedEnd - startedAt)}`}
        note={idleTrimmed ? "Idle time after your last set isn't counted." : null}
        pending={ending}
        error={finishError}
        workoutNote={finishNote}
        onWorkoutNoteChange={setFinishNote}
        onCancel={() => setFinishOpen(false)}
        onFinish={() => void finishWorkout()}
      />

      {lastSetAt !== null ? (
        <StaleWorkoutSheet
          open={showStale}
          idleMs={Math.max(0, (clockNow ?? lastSetAt) - lastSetAt)}
          finishing={ending}
          keeping={keeping}
          error={finishError}
          onKeepGoing={() => void keepWorkoutGoing()}
          onFinish={() => void finishWorkout()}
        />
      ) : null}
    </>
  );
}
