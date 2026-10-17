import type { LengthUnit } from "../../convex/lib/bodyMeasures";
import type { WeightUnit } from "../../convex/lib/units";
import { parseBodyAudio, parseBodyText } from "./parseBody";
import { parseWorkoutAudio, parseWorkoutText } from "./parseWorkout";
import type { BodyProposal } from "./bodyProposal";
import { voiceErrorStatus, type VoiceLogResult } from "./proposal";

export type VoiceParseResult = {
  status: number;
  body:
    | { error: string }
    | (VoiceLogResult & { persisted: false })
    | { proposal: BodyProposal; persisted: false };
};

/**
 * Parses a recording, or a typed note when `text` is given, into a preview.
 * The main log can hear sets, a body weigh-in, or both. Nothing is stored
 * here: the client writes only after the person confirms.
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
  knownExerciseNames?: readonly string[];
  weightUnit?: WeightUnit;
  lengthUnit?: LengthUnit;
  kind?: "workout" | "body";
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
    if (input.kind === "body") {
      const proposal = typed
        ? await parseBodyText({
            apiKey: input.apiKey,
            model: input.model,
            text: input.text ?? "",
            weightUnit: input.weightUnit,
            lengthUnit: input.lengthUnit,
            fetchImpl: input.fetchImpl,
          })
        : await parseBodyAudio({
            apiKey: input.apiKey,
            model: input.model,
            audioBase64: input.audioBase64,
            mimeType: input.mimeType,
            weightUnit: input.weightUnit,
            lengthUnit: input.lengthUnit,
            fetchImpl: input.fetchImpl,
          });
      return { status: 200, body: { proposal, persisted: false } };
    }
    const result = typed
      ? await parseWorkoutText({
          apiKey: input.apiKey,
          model: input.model,
          text: input.text ?? "",
          knownExerciseNames: input.knownExerciseNames,
          weightUnit: input.weightUnit,
          lengthUnit: input.lengthUnit,
          fetchImpl: input.fetchImpl,
        })
      : await parseWorkoutAudio({
          apiKey: input.apiKey,
          model: input.model,
          audioBase64: input.audioBase64,
          mimeType: input.mimeType,
          knownExerciseNames: input.knownExerciseNames,
          weightUnit: input.weightUnit,
          lengthUnit: input.lengthUnit,
          fetchImpl: input.fetchImpl,
        });
    return { status: 200, body: { ...result, persisted: false } };
  } catch (error) {
    const mapped = voiceErrorStatus(error);
    return { status: mapped.status, body: { error: mapped.error } };
  }
}
