"use client";

import {
  MAX_RECORDING_MS,
  microphoneErrorMessage,
  preferredRecorderMimeType,
} from "@/lib/voice/capture";
import { useCallback, useEffect, useRef, useState } from "react";

type RecorderHandlers = {
  /** Called once with the finished clip after stop(). Not called after cancel(). */
  onAudio: (blob: Blob) => void;
  onError: (message: string) => void;
};

type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext };

/**
 * Records one short clip with MediaRecorder. Also exposes an AnalyserNode on the
 * same stream so the listening screen can show live levels; the analyser never
 * reaches the speakers and is not part of what gets sent.
 */
export function useRecorder(handlers: RecorderHandlers) {
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });

  const [elapsedMs, setElapsedMs] = useState(0);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);

  const mountedRef = useRef(true);
  const startingRef = useRef(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const stopTimerRef = useRef<number | null>(null);
  const tickRef = useRef<number | null>(null);

  const clearTimers = useCallback(() => {
    if (stopTimerRef.current !== null) {
      window.clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
    if (tickRef.current !== null) {
      window.clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }, []);

  const releaseAudio = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    const context = audioContextRef.current;
    audioContextRef.current = null;
    if (context && context.state !== "closed") {
      void context.close().catch(() => undefined);
    }
    if (mountedRef.current) {
      setAnalyser(null);
    }
  }, []);

  const cancel = useCallback(() => {
    clearTimers();
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder && recorder.state !== "inactive") {
      recorder.onstop = null;
      recorder.stop();
    }
    chunksRef.current = [];
    releaseAudio();
  }, [clearTimers, releaseAudio]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cancel();
    };
  }, [cancel]);

  const stop = useCallback(() => {
    clearTimers();
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
      return;
    }
    handlersRef.current.onError(
      "The recording stopped before any audio was captured. Log the set by hand.",
    );
  }, [clearTimers]);

  const start = useCallback(async (): Promise<boolean> => {
    if (startingRef.current || recorderRef.current) {
      return false;
    }
    startingRef.current = true;
    const secureContext = window.isSecureContext;
    const hasMediaDevices = Boolean(navigator.mediaDevices?.getUserMedia);
    const hasMediaRecorder = typeof MediaRecorder !== "undefined";
    if (!secureContext || !hasMediaDevices || !hasMediaRecorder) {
      startingRef.current = false;
      handlersRef.current.onError(
        microphoneErrorMessage(null, { secureContext, hasMediaDevices, hasMediaRecorder }),
      );
      return false;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return false;
      }
      const preferred = preferredRecorderMimeType(
        typeof MediaRecorder.isTypeSupported === "function"
          ? (type) => MediaRecorder.isTypeSupported(type)
          : undefined,
      );
      const recorder = preferred
        ? new MediaRecorder(stream, { mimeType: preferred })
        : new MediaRecorder(stream);
      const fallbackMimeType = recorder.mimeType || preferred || "";
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };
      recorder.onstop = () => {
        const mimeType = recorder.mimeType || fallbackMimeType;
        const chunks = chunksRef.current;
        chunksRef.current = [];
        recorderRef.current = null;
        releaseAudio();
        if (!mountedRef.current) {
          return;
        }
        if (chunks.length === 0) {
          handlersRef.current.onError(
            "No audio was captured. Try again, or log the set by hand.",
          );
          return;
        }
        handlersRef.current.onAudio(new Blob(chunks, { type: mimeType || undefined }));
      };
      streamRef.current = stream;
      recorderRef.current = recorder;
      recorder.start();
      setAnalyser(createAnalyser(stream, audioContextRef));

      setElapsedMs(0);
      const startedAt = Date.now();
      tickRef.current = window.setInterval(() => {
        if (mountedRef.current) {
          setElapsedMs(Math.min(MAX_RECORDING_MS, Date.now() - startedAt));
        }
      }, 100);
      stopTimerRef.current = window.setTimeout(() => {
        stop();
      }, MAX_RECORDING_MS);
      return true;
    } catch (error) {
      cancel();
      if (mountedRef.current) {
        handlersRef.current.onError(
          microphoneErrorMessage(error, {
            secureContext: true,
            hasMediaDevices: true,
            hasMediaRecorder: true,
          }),
        );
      }
      return false;
    } finally {
      startingRef.current = false;
    }
  }, [cancel, releaseAudio, stop]);

  return { start, stop, cancel, elapsedMs, analyser };
}

function createAnalyser(
  stream: MediaStream,
  contextRef: { current: AudioContext | null },
): AnalyserNode | null {
  try {
    const Context = window.AudioContext ?? (window as WebkitWindow).webkitAudioContext;
    if (!Context) {
      return null;
    }
    const context = new Context();
    contextRef.current = context;
    void context.resume().catch(() => undefined);
    const analyser = context.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.75;
    context.createMediaStreamSource(stream).connect(analyser);
    return analyser;
  } catch {
    return null;
  }
}
