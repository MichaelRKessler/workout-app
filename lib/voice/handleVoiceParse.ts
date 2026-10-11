import { parseWorkoutAudio, parseWorkoutText } from "./parseWorkout";
import { voiceErrorStatus, type VoiceProposal } from "./proposal";

export type VoiceParseResult = {
  status: number;
  body:
    | { error: string }
    | { proposal: VoiceProposal; persisted: false };
};

/**
 * Parses a recording, or a typed note when `text` is given, into a preview.
 * Nothing is stored here: the client writes sets only after the person confirms.
 */
export async function handleVoiceParse(input: {
  token: string | null | undefined;
  signedIn: boolean;
  allowed: boolean;
  apiKey: string | undefined;
  model?: string;
  audioBase64: string;
  mimeType: string;
  text?: string;
  fetchImpl?: typeof fetch;
}): Promise<VoiceParseResult> {
  if (!input.token || !input.signedIn) {
    return {
      status: 401,
      body: { error: "Sign in to log a set by voice." },
    };
  }
  if (!input.allowed) {
    return {
      status: 403,
      body: { error: "You don't have access yet." },
    };
  }

  const typed = typeof input.text === "string" && input.text.trim().length > 0;
  if (
    !typed &&
    (input.audioBase64.trim().length === 0 || input.mimeType.trim().length === 0)
  ) {
    return {
      status: 400,
      body: { error: "The recording could not be read. Log the set by hand." },
    };
  }

  try {
    const proposal = typed
      ? await parseWorkoutText({
          apiKey: input.apiKey,
          model: input.model,
          text: input.text ?? "",
          fetchImpl: input.fetchImpl,
        })
      : await parseWorkoutAudio({
          apiKey: input.apiKey,
          model: input.model,
          audioBase64: input.audioBase64,
          mimeType: input.mimeType,
          fetchImpl: input.fetchImpl,
        });
    return { status: 200, body: { proposal, persisted: false } };
  } catch (error) {
    const mapped = voiceErrorStatus(error);
    return { status: mapped.status, body: { error: mapped.error } };
  }
}
