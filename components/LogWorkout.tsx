"use client";

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
  draftToProposal,
  proposalToDraft,
  proposalToSave,
  reduceVoiceLog,
  type VoiceDraft,
} from "@/lib/voice/confirm";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";

type Toasted = ToastMessage & { id: number };

/**
 * The Log tab. With no open workout it shows the start screen; the first set
 * confirmed by voice, by typing, or by hand opens one.
 */
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
  const startSession = useMutation(api.sessions.start);
  const completeSession = useMutation(api.sessions.complete);
  const keepGoingSession = useMutation(api.sessions.keepGoing);
  const discardSession = useMutation(api.sessions.discard);
  const logSet = useMutation(api.sets.log);
  const logWorkout = useMutation(api.sets.logWorkout);
  const updateSet = useMutation(api.sets.update);
  const removeSet = useMutation(api.sets.remove);
  const removeSets = useMutation(api.sets.removeMany);

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
        setId: Id<"sets">;
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

  const sessionSets = useMemo(() => sets ?? [], [sets]);
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

  function showAdded(
    ids: Array<Id<"sets">>,
    exerciseName: string,
    personalRecord: Parameters<typeof formatPersonalRecord>[0] | null,
  ) {
    if (ids.length === 0) {
      return;
    }
    const added = `Added ${pluralize(ids.length, "set")} · ${exerciseName}`;
    showToast({
      tone: "info",
      message: personalRecord ? `${formatPersonalRecord(personalRecord, unit)}. ${added}` : added,
      action: { label: "Undo", onClick: () => void undo(ids) },
    });
  }

  async function undo(ids: Array<Id<"sets">>) {
    setToast(null);
    try {
      await removeSets({ setIds: ids });
    } catch (error) {
      showToast({ tone: "error", message: readableError(error) });
    }
  }

  async function ensureSessionId(): Promise<Id<"sessions">> {
    return openSession?._id ?? (await startSession({}));
  }

  // Voice and typed parsing.

  const voiceBusy =
    voice.status === "recording" || voice.status === "parsing" || voice.status === "saving";

  async function startVoice() {
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
    try {
      const sessionId = await ensureSessionId();
      const saved = await logWorkout({
        sessionId,
        ...(toSave.note ? { note: toSave.note } : {}),
        exercises: toSave.exercises.map((exercise) => ({
          exerciseName: exercise.exerciseName,
          sets: exercise.sets.map((set) => ({
            weightLb: set.weightLb,
            ...(set.reps !== null ? { reps: set.reps } : {}),
            ...(set.durationSec !== null ? { durationSec: set.durationSec } : {}),
            ...(set.distanceM !== null ? { distanceM: set.distanceM } : {}),
            ...(set.rpe !== null ? { rpe: set.rpe } : {}),
          })),
        })),
      });
      dispatch({ type: "saved" });
      setDraft(null);
      const names = toSave.exercises.map((exercise) => exercise.exerciseName).join(", ");
      const record = formatPersonalRecords(saved.personalRecords, unit);
      const added = `Added ${pluralize(saved.setIds.length, "set")} · ${names}`;
      showToast({
        tone: "info",
        message: record ? `${record}. ${added}` : added,
        action: { label: "Undo", onClick: () => void undo(saved.setIds) },
      });
    } catch (error) {
      setDraft(proposalToDraft(toSave, unit));
      dispatch({ type: "save-failed", proposal: toSave });
      setSheetNotice(readableError(error));
    }
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
        setId: set._id as Id<"sets">,
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
      if (manual?.mode === "edit") {
        const personalRecord = await updateSet({
          setId: manual.setId,
          weightLb: set.weightLb,
          ...(set.reps !== undefined ? { reps: set.reps } : {}),
          ...(set.durationSec !== undefined ? { durationSec: set.durationSec } : {}),
          ...(set.distanceM !== undefined ? { distanceM: set.distanceM } : {}),
          ...(set.rpe !== undefined ? { rpe: set.rpe } : {}),
        });
        setManual(null);
        if (personalRecord) {
          showToast({ tone: "info", message: formatPersonalRecord(personalRecord, unit) });
        }
        return null;
      }
      const sessionId = await ensureSessionId();
      const saved = await logSet({ sessionId, ...set });
      setManual(null);
      showAdded([saved.setId], set.exerciseName, saved.personalRecord);
      return null;
    } catch (error) {
      return readableError(error);
    } finally {
      setManualPending(false);
    }
  }

  async function repeatSet(group: { exerciseId: string; name: string; sets: SetLine[] }) {
    const last = group.sets[group.sets.length - 1];
    if (!openSession || !last) {
      return;
    }
    setRepeatingId(group.exerciseId);
    try {
      const saved = await logSet({
        sessionId: openSession._id,
        exerciseName: group.name,
        weightLb: last.weightLb,
        ...(last.reps !== null ? { reps: last.reps } : {}),
        ...(last.durationSec !== null ? { durationSec: last.durationSec } : {}),
        ...(last.distanceM !== null ? { distanceM: last.distanceM } : {}),
        ...(last.rpe !== null ? { rpe: last.rpe } : {}),
      });
      showAdded([saved.setId], group.name, saved.personalRecord);
    } catch (error) {
      showToast({ tone: "error", message: readableError(error) });
    } finally {
      setRepeatingId(null);
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

  async function keepWorkoutGoing() {
    if (!openSession) {
      return;
    }
    setKeeping(true);
    setFinishError(null);
    try {
      await keepGoingSession({ sessionId: openSession._id });
      setFinishOpen(false);
    } catch (error) {
      setFinishError(readableError(error));
    } finally {
      setKeeping(false);
    }
  }

  async function finishWorkout() {
    if (!openSession) {
      return;
    }
    setEnding(true);
    setFinishError(null);
    try {
      await completeSession({
        sessionId: openSession._id,
        ...(finishOpen ? { note: finishNote } : {}),
      });
      setFinishOpen(false);
      showToast({ tone: "info", message: "Workout saved to History." });
    } catch (error) {
      setFinishError(readableError(error));
    } finally {
      setEnding(false);
    }
  }

  async function discardWorkout() {
    if (!openSession) {
      return;
    }
    setEnding(true);
    try {
      await discardSession({ sessionId: openSession._id });
    } catch (error) {
      showToast({ tone: "error", message: readableError(error) });
    } finally {
      setEnding(false);
    }
  }

  if (openSession === undefined || exercises === undefined) {
    return (
      <div className="flex min-h-[70dvh] items-center justify-center">
        <p className="text-[15px] text-muted">Loading your workout…</p>
      </div>
    );
  }

  const clockNow = now > 0 ? now : null;
  const stale =
    openSession !== null &&
    clockNow !== null &&
    workoutLooksStale(
      clockNow,
      openSession.startedAt,
      openSession.lastSetAt,
      openSession.resumedAt,
    );
  const voiceOrManualOpen =
    voice.status === "recording" ||
    voice.status === "parsing" ||
    voice.status === "preview" ||
    voice.status === "saving" ||
    manual !== null;
  const showStale = stale && !voiceOrManualOpen;
  const savedEnd =
    openSession?.lastSetAt != null
      ? plannedCompletedAt({
          now: clockNow ?? Date.now(),
          startedAt: openSession.startedAt,
          lastSetAt: openSession.lastSetAt,
        })
      : (clockNow ?? Date.now());
  const idleTrimmed =
    openSession?.lastSetAt != null && (clockNow ?? Date.now()) - savedEnd >= 60_000;

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
      {openSession ? (
        <ActiveWorkout
          startedAt={openSession.startedAt}
          groups={groups}
          setCount={sessionSets.length}
          newestSetId={newestSetId}
          loadingSets={sets === undefined}
          repeatingId={repeatingId}
          removingId={removingId}
          ending={ending}
          note={openSession.note}
          idleNote={
            stale && clockNow !== null && openSession.lastSetAt !== null
              ? `last set ${formatDuration(clockNow - openSession.lastSetAt)} ago`
              : undefined
          }
          onRepeat={(group) => void repeatSet(group)}
          onEditSet={openEdit}
          onRemoveSet={(setId) => void deleteSet(setId)}
          onFinish={() => {
            setFinishError(null);
            if (!stale) {
              setFinishNote(openSession.note ?? "");
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
          }}
        />
      ) : (
        <HomeView
          lastWorkout={history === undefined ? undefined : (history.page[0] ?? null)}
          weekSummary={weekSummary}
          voiceBusy={voiceBusy}
          onVoice={() => void startVoice()}
          onManual={openManual}
        />
      )}

      <Toast
        key={activeToast ? `${activeToast.id}-${activeToast.message}` : "none"}
        toast={activeToast}
        raised={Boolean(openSession)}
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
        excludeSessionId={openSession?._id}
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
          truncatedLibrary={exercises.truncated}
          sessionSets={sessionSets}
          excludeSessionId={openSession?._id}
          pending={manualPending}
          onClose={() => setManual(null)}
          onAdd={addManual}
        />
      ) : null}

      <FinishSheet
        open={finishOpen && !showStale}
        summary={`${pluralize(groups.length, "exercise")} · ${pluralize(sessionSets.length, "set")} · ${formatDuration(savedEnd - (openSession?.startedAt ?? savedEnd))}`}
        note={idleTrimmed ? "Idle time after your last set isn't counted." : null}
        pending={ending}
        error={finishError}
        workoutNote={finishNote}
        onWorkoutNoteChange={setFinishNote}
        onCancel={() => setFinishOpen(false)}
        onFinish={() => void finishWorkout()}
      />

      {openSession?.lastSetAt != null ? (
        <StaleWorkoutSheet
          open={showStale}
          idleMs={Math.max(0, (clockNow ?? openSession.lastSetAt) - openSession.lastSetAt)}
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
