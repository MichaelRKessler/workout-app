"use client";

import { Toast, type ToastMessage } from "@/components/Toast";
import { ActiveWorkout } from "@/components/workout/ActiveWorkout";
import { ConfirmSheet } from "@/components/workout/ConfirmSheet";
import { FinishSheet } from "@/components/workout/FinishSheet";
import { HomeView } from "@/components/workout/HomeView";
import { ListeningOverlay } from "@/components/workout/ListeningOverlay";
import { ManualEntrySheet } from "@/components/workout/ManualEntrySheet";
import { blobToBase64, requestProposal } from "@/components/workout/requestProposal";
import { useRecorder } from "@/components/workout/useRecorder";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { formatExerciseName } from "@/convex/lib/exerciseName";
import { readableError } from "@/lib/errors";
import { EXAMPLE_EXERCISES } from "@/lib/examples";
import { formatDuration, pluralize } from "@/lib/format";
import { groupSets, type SetLine } from "@/lib/groupSets";
import {
  commitProposal,
  draftToProposal,
  proposalToDraft,
  proposalToSave,
  reduceVoiceLog,
  VoiceSaveError,
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
  const discardSession = useMutation(api.sessions.discard);
  const logSet = useMutation(api.sets.log);
  const removeSet = useMutation(api.sets.remove);

  const [voice, dispatch] = useReducer(reduceVoiceLog, { status: "idle" });
  const [source, setSource] = useState<"voice" | "text">("voice");
  const [draft, setDraft] = useState<VoiceDraft | null>(null);
  const [sheetNotice, setSheetNotice] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [manual, setManual] = useState<{ key: number; exerciseName: string } | null>(null);
  const [manualPending, setManualPending] = useState(false);
  const [finishOpen, setFinishOpen] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);
  const [ending, setEnding] = useState(false);
  const [toast, setToast] = useState<Toasted | null>(null);
  const [repeatingId, setRepeatingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const parseAbortRef = useRef<AbortController | null>(null);

  const recorder = useRecorder({
    onAudio: (blob) => void parseAudio(blob),
    onError: (message) => dispatch({ type: "failed", message }),
  });

  useEffect(() => {
    return () => parseAbortRef.current?.abort();
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

  function showAdded(ids: Array<Id<"sets">>, exerciseName: string) {
    if (ids.length === 0) {
      return;
    }
    showToast({
      tone: "info",
      message: `Added ${pluralize(ids.length, "set")} · ${exerciseName}`,
      action: { label: "Undo", onClick: () => void undo(ids) },
    });
  }

  async function undo(ids: Array<Id<"sets">>) {
    setToast(null);
    try {
      for (const setId of ids) {
        await removeSet({ setId });
      }
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
      setDraft(proposalToDraft(proposal));
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
    const edited = draftToProposal(draft);
    if (!edited) {
      setSheetNotice("Check the exercise, reps, and weight. Nothing was saved.");
      return;
    }
    const toSave = proposalToSave(voice, { type: "confirm", proposal: edited });
    if (!toSave) {
      return;
    }
    dispatch({ type: "confirm", proposal: toSave });
    setSheetNotice(null);
    const savedIds: Array<Id<"sets">> = [];
    try {
      const sessionId = await ensureSessionId();
      await commitProposal(toSave, async (set) => {
        savedIds.push(await logSet({ sessionId, ...set }));
      });
      dispatch({ type: "saved" });
      setDraft(null);
      showAdded(savedIds, toSave.exerciseName);
    } catch (error) {
      if (error instanceof VoiceSaveError && error.savedCount > 0) {
        const remaining = {
          exerciseName: toSave.exerciseName,
          sets: toSave.sets.slice(error.savedCount),
        };
        setDraft(proposalToDraft(remaining));
        dispatch({ type: "save-failed", proposal: remaining });
        setSheetNotice(error.message);
        return;
      }
      setDraft(proposalToDraft(toSave));
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
    setManual({ key: Date.now(), exerciseName: groups[groups.length - 1]?.name ?? "" });
  }

  async function addManual(set: { exerciseName: string; reps: number; weightLb: number }) {
    setManualPending(true);
    try {
      const sessionId = await ensureSessionId();
      const id = await logSet({ sessionId, ...set });
      setManual(null);
      showAdded([id], set.exerciseName);
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
      const id = await logSet({
        sessionId: openSession._id,
        exerciseName: group.name,
        reps: last.reps,
        weightLb: last.weightLb,
      });
      showAdded([id], group.name);
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

  async function finishWorkout() {
    if (!openSession) {
      return;
    }
    setEnding(true);
    setFinishError(null);
    try {
      await completeSession({ sessionId: openSession._id });
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
          onRepeat={(group) => void repeatSet(group)}
          onRemoveSet={(setId) => void deleteSet(setId)}
          onFinish={() => {
            setFinishError(null);
            setFinishOpen(true);
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
        onChange={setDraft}
        onDiscard={discardDraft}
        onConfirm={() => void confirmDraft()}
        onRecordAgain={() => void startVoice()}
      />

      {manual ? (
        <ManualEntrySheet
          key={manual.key}
          open
          initialExercise={manual.exerciseName}
          library={library}
          sessionSets={sessionSets}
          pending={manualPending}
          onClose={() => setManual(null)}
          onAdd={addManual}
        />
      ) : null}

      <FinishSheet
        open={finishOpen}
        summary={`${pluralize(groups.length, "exercise")} · ${pluralize(sessionSets.length, "set")} · ${formatDuration(Date.now() - (openSession?.startedAt ?? Date.now()))}`}
        pending={ending}
        error={finishError}
        onCancel={() => setFinishOpen(false)}
        onFinish={() => void finishWorkout()}
      />
    </>
  );
}
