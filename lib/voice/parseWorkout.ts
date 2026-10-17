import { knownExercisePrompt } from "./knownExercises";
import { isBase64, normalizeBase64, requestGeminiObject } from "./gemini";
import type { LengthUnit } from "../../convex/lib/bodyMeasures";
import type { WeightUnit } from "../../convex/lib/units";
import {
  geminiAudioMimeType,
  MAX_WORKOUT_TEXT_LENGTH,
  normalizeVoiceLog,
  VoiceParseError,
  weightUnitPrompt,
  WORKOUT_PARSE_PROMPT,
  WORKOUT_RESPONSE_SCHEMA,
  WORKOUT_TEXT_PROMPT,
  type VoiceLogResult,
} from "./proposal";

const MAX_AUDIO_BASE64_LENGTH = 2_000_000;

export async function parseWorkoutAudio(options: {
  apiKey: string | undefined;
  audioBase64: string;
  mimeType: string;
  model?: string;
  knownExerciseNames?: readonly string[];
  weightUnit?: WeightUnit;
  lengthUnit?: LengthUnit;
  fetchImpl?: typeof fetch;
}): Promise<VoiceLogResult> {
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
    parts: promptParts(WORKOUT_PARSE_PROMPT, options, [
      { inlineData: { mimeType, data: audioBase64 } },
    ]),
    subject: "recording",
    weightUnit: options.weightUnit,
    lengthUnit: options.lengthUnit,
    logContext: { mimeType },
  });
}

/** Parses a typed note such as "squat 3x5 225" or "weight 232" the same way a recording is parsed. */
export async function parseWorkoutText(options: {
  apiKey: string | undefined;
  text: string;
  model?: string;
  knownExerciseNames?: readonly string[];
  weightUnit?: WeightUnit;
  lengthUnit?: LengthUnit;
  fetchImpl?: typeof fetch;
}): Promise<VoiceLogResult> {
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
    parts: promptParts(WORKOUT_TEXT_PROMPT, options, [
      { text },
    ]),
    subject: "note",
    weightUnit: options.weightUnit,
    lengthUnit: options.lengthUnit,
    logContext: {},
  });
}

function promptParts(
  instructions: string,
  options: {
    knownExerciseNames?: readonly string[];
    weightUnit?: WeightUnit;
    lengthUnit?: LengthUnit;
  },
  rest: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  const parts: Array<Record<string, unknown>> = [
    { text: instructions },
    { text: weightUnitPrompt(options.weightUnit ?? "lb", options.lengthUnit ?? "in") },
  ];
  const known = knownExercisePrompt(options.knownExerciseNames ?? []);
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
  lengthUnit: LengthUnit | undefined;
  logContext: Record<string, string>;
}): Promise<VoiceLogResult> {
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
  return normalizeVoiceLog(
    structured,
    options.subject,
    options.weightUnit ?? "lb",
    options.lengthUnit ?? "in",
  );
}
