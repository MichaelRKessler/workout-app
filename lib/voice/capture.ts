export const MAX_RECORDING_MS = 20_000;

const RECORDER_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/aac",
];

export function preferredRecorderMimeType(
  isTypeSupported: ((type: string) => boolean) | undefined,
): string | undefined {
  if (!isTypeSupported) {
    return undefined;
  }
  return RECORDER_CANDIDATES.find((candidate) => {
    try {
      return isTypeSupported(candidate);
    } catch {
      return false;
    }
  });
}

export function microphoneErrorMessage(
  error: unknown,
  options: {
    hasMediaDevices: boolean;
    hasMediaRecorder: boolean;
    secureContext: boolean;
  },
): string {
  if (!options.secureContext) {
    return "Voice logging needs a secure page (HTTPS or localhost). Log the set by hand.";
  }
  if (!options.hasMediaDevices || !options.hasMediaRecorder) {
    return "This browser cannot record from the microphone. Log the set by hand.";
  }
  const name = error instanceof Error ? error.name : "";
  if (
    name === "NotAllowedError" ||
    name === "PermissionDeniedError" ||
    name === "SecurityError"
  ) {
    return "Microphone access is blocked. Allow the mic for this site, or log the set by hand.";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "No microphone was found. Log the set by hand.";
  }
  return "The microphone could not be started. Log the set by hand.";
}
