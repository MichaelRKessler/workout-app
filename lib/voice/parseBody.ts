import type { LengthUnit } from "../../convex/lib/bodyMeasures";
import type { WeightUnit } from "../../convex/lib/units";
import {
  BODY_PARSE_PROMPT,
  BODY_RESPONSE_SCHEMA,
  BODY_TEXT_PROMPT,
  bodyUnitPrompt,
  MAX_BODY_TEXT_LENGTH,
  normalizeBodyProposal,
  type BodyProposal,
} from "./bodyProposal";
import { isBase64, normalizeBase64, requestGeminiObject } from "./gemini";
import { geminiAudioMimeType, VoiceParseError } from "./proposal";

const MAX_AUDIO_BASE64_LENGTH = 2_000_000;

export async function parseBodyAudio(options: {
  apiKey: string | undefined;
  audioBase64: string;
  mimeType: string;
  model?: string;
  weightUnit?: WeightUnit;
  lengthUnit?: LengthUnit;
  fetchImpl?: typeof fetch;
}): Promise<BodyProposal> {
  const apiKey = requireApiKey(options.apiKey);
  const audioBase64 = normalizeBase64(options.audioBase64);
  if (!isBase64(audioBase64)) {
    throw new VoiceParseError("The recording could not be read. Type the measurement in.", "rejected");
  }
  if (audioBase64.length > MAX_AUDIO_BASE64_LENGTH) {
    throw new VoiceParseError(
      "That recording is too long. Keep it under 20 seconds, or type the measurement in.",
      "rejected",
    );
  }
  const weightUnit = options.weightUnit ?? "lb";
  const lengthUnit = options.lengthUnit ?? "in";
  const structured = await requestGeminiObject({
    apiKey,
    model: options.model,
    fetchImpl: options.fetchImpl,
    parts: [
      { text: BODY_PARSE_PROMPT },
      { text: bodyUnitPrompt(weightUnit, lengthUnit) },
      { inlineData: { mimeType: geminiAudioMimeType(options.mimeType), data: audioBase64 } },
    ],
    schema: BODY_RESPONSE_SCHEMA,
    logLabel: "Gemini body parse",
    logContext: { mimeType: options.mimeType },
    unavailable: "The voice service did not answer. Type the measurement in.",
    rejected: "The voice service could not read that recording. Type the measurement in.",
    invalid: "That recording could not be turned into a measurement. Try again, or type it in.",
  });
  return normalizeBodyProposal(structured, weightUnit, lengthUnit);
}

export async function parseBodyText(options: {
  apiKey: string | undefined;
  text: string;
  model?: string;
  weightUnit?: WeightUnit;
  lengthUnit?: LengthUnit;
  fetchImpl?: typeof fetch;
}): Promise<BodyProposal> {
  const apiKey = requireApiKey(options.apiKey);
  const text = options.text.trim().replace(/\s+/g, " ");
  if (text.length === 0) {
    throw new VoiceParseError("Type a weight or a measurement, such as weight 232.", "rejected");
  }
  if (text.length > MAX_BODY_TEXT_LENGTH) {
    throw new VoiceParseError(`Keep it under ${MAX_BODY_TEXT_LENGTH} characters.`, "rejected");
  }
  const weightUnit = options.weightUnit ?? "lb";
  const lengthUnit = options.lengthUnit ?? "in";
  const structured = await requestGeminiObject({
    apiKey,
    model: options.model,
    fetchImpl: options.fetchImpl,
    parts: [
      { text: BODY_TEXT_PROMPT },
      { text: bodyUnitPrompt(weightUnit, lengthUnit) },
      { text },
    ],
    schema: BODY_RESPONSE_SCHEMA,
    logLabel: "Gemini body parse",
    logContext: {},
    unavailable: "That measurement could not be read right now. Type it in.",
    rejected: "That note could not be read right now. Type the measurement in.",
    invalid: "That note could not be turned into a measurement. Try again, or type it in.",
  });
  return normalizeBodyProposal(structured, weightUnit, lengthUnit);
}

function requireApiKey(value: string | undefined): string {
  const apiKey = value?.trim() ?? "";
  if (apiKey.length === 0) {
    throw new VoiceParseError(
      "Voice logging is not set up on the server (GEMINI_API_KEY). Type the measurement in.",
      "missing_key",
    );
  }
  return apiKey;
}
