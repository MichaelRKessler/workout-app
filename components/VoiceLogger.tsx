"use client";

import { Button } from "@/components/Button";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { readableError } from "@/lib/errors";
import {
  MAX_RECORDING_MS,
  microphoneErrorMessage,
  preferredRecorderMimeType,
} from "@/lib/voice/capture";
import {
  commitProposal,
  draftToProposal,
  proposalToDraft,
  proposalToSave,
  readVoiceResponse,
  VoiceSaveError,
  type VoiceDraft,
  type VoiceLogState,
} from "@/lib/voice/confirm";
import { useMutation } from "convex/react";
import { useEffect, useRef, useState } from "react";

export function VoiceLogger({ sessionId }: { sessionId: Id<"sessions"> }) {
  const logSet = useMutation(api.sets.log);
  const [state, setState] = useState<VoiceLogState>({ status: "idle" });
  const [draft, setDraft] = useState<VoiceDraft | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);

  const mountedRef = useRef(true);
  const savingRef = useRef(false);
  const startingRef = useRef(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const stopTimerRef = useRef<number | null>(null);
  const tickRef = useRef<number | null>(null);
  const mimeTypeRef = useRef("");

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      releaseRecorder();
    };
  }, []);

  function releaseRecorder() {
    if (stopTimerRef.current !== null) {
      window.clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
    if (tickRef.current !== null) {
      window.clearInterval(tickRef.current);
      tickRef.current = null;
    }
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.onstop = null;
      recorder.stop();
    }
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  async function startRecording() {
    if (
      startingRef.current ||
      state.status === "recording" ||
      state.status === "parsing" ||
      state.status === "saving"
    ) {
      return;
    }
    startingRef.current = true;
    setNotice(null);
    const secureContext = window.isSecureContext;
    const hasMediaDevices = Boolean(navigator.mediaDevices?.getUserMedia);
    const hasMediaRecorder = typeof MediaRecorder !== "undefined";
    if (!secureContext || !hasMediaDevices || !hasMediaRecorder) {
      startingRef.current = false;
      setState({
        status: "error",
        message: microphoneErrorMessage(null, {
          secureContext,
          hasMediaDevices,
          hasMediaRecorder,
        }),
      });
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const preferred = preferredRecorderMimeType(
        typeof MediaRecorder.isTypeSupported === "function"
          ? (type) => MediaRecorder.isTypeSupported(type)
          : undefined,
      );
      const recorder = preferred
        ? new MediaRecorder(stream, { mimeType: preferred })
        : new MediaRecorder(stream);
      mimeTypeRef.current = recorder.mimeType || preferred || "";
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };
      recorder.onstop = () => {
        const mimeType = recorder.mimeType || mimeTypeRef.current;
        const chunks = chunksRef.current;
        stream.getTracks().forEach((track) => track.stop());
        void finishRecording(chunks, mimeType);
      };
      streamRef.current = stream;
      recorderRef.current = recorder;
      recorder.start();
      setState({ status: "recording" });
      setElapsedMs(0);
      const startedAt = Date.now();
      tickRef.current = window.setInterval(() => {
        if (mountedRef.current) {
          setElapsedMs(Math.min(MAX_RECORDING_MS, Date.now() - startedAt));
        }
      }, 250);
      stopTimerRef.current = window.setTimeout(() => {
        stopRecording();
      }, MAX_RECORDING_MS);
    } catch (error) {
      releaseRecorder();
      if (!mountedRef.current) {
        return;
      }
      setState({
        status: "error",
        message: microphoneErrorMessage(error, {
          secureContext: true,
          hasMediaDevices: true,
          hasMediaRecorder: true,
        }),
      });
    } finally {
      startingRef.current = false;
    }
  }

  function stopRecording() {
    if (stopTimerRef.current !== null) {
      window.clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
    if (tickRef.current !== null) {
      window.clearInterval(tickRef.current);
      tickRef.current = null;
    }
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      setState({ status: "parsing" });
      recorder.stop();
      return;
    }
    setState({
      status: "error",
      message: "The recording stopped before any audio was captured. Log the set by hand.",
    });
  }

  async function finishRecording(chunks: Blob[], mimeType: string) {
    recorderRef.current = null;
    streamRef.current = null;
    if (!mountedRef.current) {
      return;
    }
    if (chunks.length === 0) {
      setState({
        status: "error",
        message: "No audio was captured. Try again, or log the set by hand.",
      });
      return;
    }

    try {
      const blob = new Blob(chunks, { type: mimeType || undefined });
      const audioBase64 = await blobToBase64(blob);
      const response = await fetch("/api/voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audioBase64,
          mimeType: blob.type || mimeType,
        }),
      });
      let payload: unknown = null;
      try {
        payload = (await response.json()) as unknown;
      } catch {
        payload = null;
      }
      if (!response.ok) {
        const errorMessage = errorFromPayload(payload);
        throw new Error(errorMessage);
      }
      const proposal = readVoiceResponse(payload);
      if (!mountedRef.current) {
        return;
      }
      setDraft(proposalToDraft(proposal));
      setState({ status: "preview", proposal });
      setNotice(null);
    } catch (error) {
      if (!mountedRef.current) {
        return;
      }
      setState({ status: "error", message: readableError(error) });
    }
  }

  function updateSet(index: number, patch: Partial<VoiceDraft["sets"][number]>) {
    setDraft((current) => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        sets: current.sets.map((set, setIndex) =>
          setIndex === index ? { ...set, ...patch } : set,
        ),
      };
    });
  }

  async function onConfirm() {
    if (savingRef.current || state.status !== "preview" || !draft) {
      return;
    }
    const edited = draftToProposal(draft);
    if (!edited) {
      setNotice("Check the exercise, reps, and weight. Nothing was saved.");
      return;
    }
    const toSave = proposalToSave(state, { type: "confirm", proposal: edited });
    if (!toSave) {
      return;
    }

    savingRef.current = true;
    setState({ status: "saving", proposal: toSave });
    setNotice(null);
    try {
      await commitProposal(toSave, async (set) => {
        await logSet({
          sessionId,
          exerciseName: set.exerciseName,
          reps: set.reps,
          weightLb: set.weightLb,
        });
      });
      if (!mountedRef.current) {
        return;
      }
      setDraft(null);
      setState({ status: "idle" });
      setNotice("Saved to this workout.");
    } catch (error) {
      if (!mountedRef.current) {
        return;
      }
      if (error instanceof VoiceSaveError && error.savedCount > 0) {
        const remaining = {
          exerciseName: toSave.exerciseName,
          sets: toSave.sets.slice(error.savedCount),
        };
        setDraft(proposalToDraft(remaining));
        setState({ status: "preview", proposal: remaining });
        setNotice(error.message);
        return;
      }
      setDraft(proposalToDraft(toSave));
      setState({ status: "preview", proposal: toSave });
      setNotice(readableError(error));
    } finally {
      savingRef.current = false;
    }
  }

  const seconds = Math.floor(elapsedMs / 1000);

  return (
    <section className="rounded-2xl border border-line bg-panel p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Voice</h2>
          <p className="mt-1 text-sm leading-6 text-muted">
            Say the exercise, sets, reps, and weight. Nothing is saved until you confirm.
          </p>
        </div>
        {state.status === "idle" || state.status === "error" ? (
          <Button
            className="min-h-14 min-w-14 shrink-0 px-3"
            aria-label="Start voice log"
            onClick={() => void startRecording()}
          >
            <MicIcon />
          </Button>
        ) : null}
      </div>

      {state.status === "recording" ? (
        <div className="mt-4 flex flex-col gap-3">
          <p role="status" className="text-sm text-accent">
            Listening · {seconds}s. Tap stop when you are done.
          </p>
          <Button className="w-full" aria-label="Stop and parse" onClick={stopRecording}>
            Stop
          </Button>
        </div>
      ) : null}

      {state.status === "parsing" ? (
        <p role="status" className="mt-4 text-sm text-muted">
          Reading that…
        </p>
      ) : null}

      {state.status === "error" ? (
        <p role="alert" className="mt-4 text-sm leading-6 text-danger">
          {state.message}
        </p>
      ) : null}

      {notice ? (
        <p role="status" className="mt-4 text-sm leading-6 text-accent">
          {notice}
        </p>
      ) : null}

      {state.status === "preview" || state.status === "saving" ? (
        draft ? (
          <div className="mt-4 flex flex-col gap-3">
            <label className="block text-sm font-medium">
              Exercise
              <input
                value={draft.exerciseName}
                onChange={(event) =>
                  setDraft({ ...draft, exerciseName: event.target.value })
                }
                disabled={state.status === "saving"}
                className="mt-2 min-h-12 w-full rounded-xl border border-line bg-panel-2 px-3 text-base outline-none"
              />
            </label>
            <ol className="flex flex-col gap-3">
              {draft.sets.map((set, index) => (
                <li key={index} className="rounded-xl bg-panel-2 p-3">
                  <p className="text-sm font-medium">Set {index + 1}</p>
                  <div className="mt-2 grid grid-cols-2 gap-3">
                    <label className="block text-sm">
                      Reps
                      <input
                        value={set.reps}
                        inputMode="numeric"
                        disabled={state.status === "saving"}
                        onChange={(event) => updateSet(index, { reps: event.target.value })}
                        className="mt-2 min-h-12 w-full rounded-xl border border-line bg-panel px-3 text-base outline-none"
                      />
                    </label>
                    <label className="block text-sm">
                      Weight (lb)
                      <input
                        value={set.weight}
                        inputMode="decimal"
                        disabled={state.status === "saving"}
                        onChange={(event) =>
                          updateSet(index, { weight: event.target.value })
                        }
                        className="mt-2 min-h-12 w-full rounded-xl border border-line bg-panel px-3 text-base outline-none"
                      />
                    </label>
                  </div>
                </li>
              ))}
            </ol>
            <p className="text-sm text-muted">
              Weights are in pounds. 0 is bodyweight. Confirm to add these sets.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Button
                variant="secondary"
                disabled={state.status === "saving"}
                onClick={() => {
                  setDraft(null);
                  setState({ status: "idle" });
                  setNotice(null);
                }}
              >
                Discard
              </Button>
              <Button disabled={state.status === "saving"} onClick={() => void onConfirm()}>
                {state.status === "saving" ? "Saving…" : "Confirm"}
              </Button>
            </div>
          </div>
        ) : null
      ) : null}
    </section>
  );
}

function errorFromPayload(payload: unknown): string {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof payload.error === "string" &&
    payload.error.trim().length > 0
  ) {
    return payload.error;
  }
  return "Voice logging failed. Log the set by hand.";
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function MicIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-6 w-6"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M6 11a6 6 0 0 0 12 0" />
      <path d="M12 17v4" />
      <path d="M8 21h8" />
    </svg>
  );
}
