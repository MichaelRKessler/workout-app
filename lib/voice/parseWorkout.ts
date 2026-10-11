import { knownExercisePrompt } from "./knownExercises";
import { isBase64, normalizeBase64, requestGeminiObject } from "./gemini";
import type { WeightUnit } from "../../convex/lib/units";
import {
  geminiAudioMimeType,
  MAX_WORKOUT_TEXT_LENGTH,
  normalizeGeminiWorkout,
  VoiceParseError,
  weightUnitPrompt,
  WORKOUT_PARSE_PROMPT,
  WORKOUT_RESPONSE_SCHEMA,
  WORKOUT_TEXT_PROMPT,
  type VoiceProposal,
} from "./proposal";

const MAX_AUDIO_BASE64_LENGTH = 2_000_000;

export async function parseWorkoutAudio(options: {
  apiKey: string | undefined;
  audioBase64: string;
  mimeType: string;
  model?: string;
  knownExerciseNames?: readonly string[];
  weightUnit?: WeightUnit;
  fetchImpl?: typeof fetch;
}): Promise<VoiceProposal> {
  const apiKey = requireApiKey(options.apiKey);

  const audioBase64 = normalizeBase64(options.audioBase64);
  if (!isBase64(audioBase64)) {
    throw new VoiceParseError(
      "The recording could not be read. Log the set by hand.",
      "rejected",
    );
  }
  if (audioBase64.length > MAX_AUDIO_BASE64_LENGTH) {
    throw new VoiceParseError(
      "That recording is too long. Keep it under 20 seconds, or log the set by hand.",
      "rejected",
    );
  }

  const mimeType = geminiAudioMimeType(options.mimeType);
  return await requestWorkout({
    apiKey,
    model: options.model,
    fetchImpl: options.fetchImpl,
    parts: promptParts(WORKOUT_PARSE_PROMPT, options.knownExerciseNames, options.weightUnit, [
      { inlineData: { mimeType, data: audioBase64 } },
    ]),
    subject: "recording",
    weightUnit: options.weightUnit,
    logContext: { mimeType },
  });
}

/** Parses a typed note such as "squat 3x5 225" the same way a recording is parsed. */
export async function parseWorkoutText(options: {
  apiKey: string | undefined;
  text: string;
  model?: string;
  knownExerciseNames?: readonly string[];
  weightUnit?: WeightUnit;
  fetchImpl?: typeof fetch;
}): Promise<VoiceProposal> {
  const apiKey = requireApiKey(options.apiKey);

  const text = options.text.trim().replace(/\s+/g, " ");
  if (text.length === 0) {
    throw new VoiceParseError(
      "Type the exercise, then the sets, reps, and weight.",
      "rejected",
    );
  }
  if (text.length > MAX_WORKOUT_TEXT_LENGTH) {
    throw new VoiceParseError(
      `Keep it under ${MAX_WORKOUT_TEXT_LENGTH} characters, or add the set by hand.`,
      "rejected",
    );
  }

  return await requestWorkout({
    apiKey,
    model: options.model,
    fetchImpl: options.fetchImpl,
    parts: promptParts(WORKOUT_TEXT_PROMPT, options.knownExerciseNames, options.weightUnit, [
      { text },
    ]),
    subject: "note",
    weightUnit: options.weightUnit,
    logContext: {},
  });
}

function promptParts(
  instructions: string,
  knownExerciseNames: readonly string[] | undefined,
  weightUnit: WeightUnit | undefined,
  rest: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  const parts: Array<Record<string, unknown>> = [
    { text: instructions },
    { text: weightUnitPrompt(weightUnit ?? "lb") },
  ];
  const known = knownExercisePrompt(knownExerciseNames ?? []);
  if (known) {
    parts.push({ text: known });
  }
  parts.push(...rest);
  return parts;
}

type Subject = "recording" | "note";

const MESSAGES: Record<
  Subject,
  { unavailable: string; rejected: string; invalid: string }
> = {
  recording: {
    unavailable: "The voice service did not answer. Log the set by hand.",
    rejected:
      "The voice service could not read that recording. Log the set by hand.",
    invalid:
      "That recording could not be turned into a set. Try again, or log it by hand.",
  },
  note: {
    unavailable: "The set could not be read right now. Add it by hand.",
    rejected: "That note could not be read right now. Add the set by hand.",
    invalid:
      "That note could not be turned into a set. Try again, or add it by hand.",
  },
};

function requireApiKey(value: string | undefined): string {
  const apiKey = value?.trim() ?? "";
  if (apiKey.length === 0) {
    throw new VoiceParseError(
      "Voice logging is not set up on the server (GEMINI_API_KEY). Log the set by hand.",
      "missing_key",
    );
  }
  return apiKey;
}

async function requestWorkout(options: {
  apiKey: string;
  model: string | undefined;
  fetchImpl: typeof fetch | undefined;
  parts: Array<Record<string, unknown>>;
  subject: Subject;
  weightUnit: WeightUnit | undefined;
  logContext: Record<string, string>;
}): Promise<VoiceProposal> {
  const messages = MESSAGES[options.subject];
  const structured = await requestGeminiObject({
    apiKey: options.apiKey,
    model: options.model,
    fetchImpl: options.fetchImpl,
    parts: options.parts,
    schema: WORKOUT_RESPONSE_SCHEMA,
    logLabel: "Gemini workout parse",
    logContext: options.logContext,
    unavailable: messages.unavailable,
    rejected: messages.rejected,
    invalid: messages.invalid,
  });
  return normalizeGeminiWorkout(structured, options.subject, options.weightUnit ?? "lb");
}
