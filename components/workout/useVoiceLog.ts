"use client";

import type { SyncOutcome } from "@/components/OfflineSync";
import { blobToBase64, requestProposal } from "@/components/workout/requestProposal";
import { useRecorder } from "@/components/workout/useRecorder";
import type { WeightUnit } from "@/convex/lib/units";
import { readableError } from "@/lib/errors";
import { OFFLINE_TYPED_MESSAGE, OFFLINE_VOICE_MESSAGE } from "@/lib/offline/messages";
import {
  draftToProposal,
  proposalToDraft,
  proposalToSave,
  reduceVoiceLog,
  type VoiceDraft,
} from "@/lib/voice/confirm";
import type { VoiceProposal } from "@/lib/voice/proposal";
import { useEffect, useReducer, useRef, useState } from "react";

/**
 * Voice and typed logging: record or send text, parse it into a draft, let
 * the person edit it in the confirm sheet, then save it. Nothing is written
 * until they confirm.
 */
export function useVoiceLog({
  offline,
  unit,
  text,
  setText,
  clearToast,
  save,
  onSaved,
}: {
  offline: boolean;
  unit: WeightUnit;
  text: string;
  setText: (value: string) => void;
  clearToast: () => void;
  save: (proposal: VoiceProposal) => Promise<SyncOutcome>;
  onSaved: (saved: SyncOutcome, exerciseNames: string) => void;
}) {
  const [voice, dispatch] = useReducer(reduceVoiceLog, { status: "idle" });
  const [source, setSource] = useState<"voice" | "text">("voice");
  const [draft, setDraft] = useState<VoiceDraft | null>(null);
  const [sheetNotice, setSheetNotice] = useState<string | null>(null);
  const parseAbortRef = useRef<AbortController | null>(null);

  const recorder = useRecorder({
    onAudio: (blob) => void parseAudio(blob),
    onError: (message) => dispatch({ type: "failed", message }),
  });

  useEffect(() => {
    return () => {
      parseAbortRef.current?.abort();
    };
  }, []);

  const busy =
    voice.status === "recording" || voice.status === "parsing" || voice.status === "saving";

  async function startVoice() {
    if (offline) {
      dispatch({ type: "failed", message: OFFLINE_VOICE_MESSAGE });
      return;
    }
    if (busy) {
      return;
    }
    clearToast();
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
    if (value.length === 0 || busy) {
      return;
    }
    clearToast();
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
    const saved = await save(toSave);
    if (saved.status === "rejected") {
      setDraft(proposalToDraft(toSave, unit));
      dispatch({ type: "save-failed", proposal: toSave });
      setSheetNotice(saved.error ?? "That set could not be saved");
      return;
    }
    dispatch({ type: "saved" });
    setDraft(null);
    onSaved(saved, toSave.exercises.map((exercise) => exercise.exerciseName).join(", "));
  }

  function discardDraft() {
    setDraft(null);
    setSheetNotice(null);
    dispatch({ type: "discard" });
  }

  function dismissError() {
    if (voice.status === "error") {
      dispatch({ type: "dismiss" });
    }
  }

  return {
    voice,
    source,
    draft,
    setDraft,
    sheetNotice,
    busy,
    analyser: recorder.analyser,
    startVoice,
    stopVoice,
    cancelVoice,
    submitText,
    confirmDraft,
    discardDraft,
    dismissError,
  };
}
