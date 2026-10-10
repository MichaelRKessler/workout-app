import { GEMINI_FLASH_MODEL, GEMINI_GENERATE_CONTENT_URL } from "./model";
import {
  normalizeGeminiWorkout,
  WORKOUT_PARSE_PROMPT,
  WORKOUT_RESPONSE_SCHEMA,
  geminiAudioMimeType,
  VoiceParseError,
  type VoiceProposal,
} from "./proposal";

const MAX_AUDIO_BASE64_LENGTH = 2_000_000;

export async function parseWorkoutAudio(options: {
  apiKey: string | undefined;
  audioBase64: string;
  mimeType: string;
  model?: string;
  fetchImpl?: typeof fetch;
}): Promise<VoiceProposal> {
  const apiKey = options.apiKey?.trim() ?? "";
  if (apiKey.length === 0) {
    throw new VoiceParseError(
      "Voice logging is not set up on the server (GEMINI_API_KEY). Log the set by hand.",
      "missing_key",
    );
  }

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
  const model = options.model?.trim() || GEMINI_FLASH_MODEL;
  const fetchImpl = options.fetchImpl ?? fetch;

  let response: Response;
  try {
    response = await fetchImpl(GEMINI_GENERATE_CONTENT_URL(model), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              { text: WORKOUT_PARSE_PROMPT },
              { inlineData: { mimeType, data: audioBase64 } },
            ],
          },
        ],
        generationConfig: {
          temperature: 0,
          responseFormat: {
            text: {
              mimeType: "application/json",
              schema: WORKOUT_RESPONSE_SCHEMA,
            },
          },
        },
      }),
    });
  } catch {
    throw new VoiceParseError(
      "The voice service did not answer. Log the set by hand.",
      "unavailable",
    );
  }

  const raw = await response.text();
  if (!response.ok) {
    throw new VoiceParseError(
      "The voice service could not read that recording. Log the set by hand.",
      "unavailable",
    );
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw) as unknown;
  } catch {
    throw new VoiceParseError(
      "That recording could not be turned into a set. Try again, or log it by hand.",
      "invalid",
    );
  }

  const text = extractCandidateText(payload);
  let structured: unknown;
  try {
    structured = JSON.parse(stripFences(text)) as unknown;
  } catch {
    throw new VoiceParseError(
      "That recording could not be turned into a set. Try again, or log it by hand.",
      "invalid",
    );
  }

  return normalizeGeminiWorkout(structured);
}

function normalizeBase64(value: string): string {
  const trimmed = value.trim();
  const marker = "base64,";
  const markerIndex = trimmed.indexOf(marker);
  const payload =
    trimmed.startsWith("data:") && markerIndex !== -1
      ? trimmed.slice(markerIndex + marker.length)
      : trimmed;
  return payload.replace(/\s/g, "");
}

function isBase64(value: string): boolean {
  if (value.length === 0 || value.length % 4 !== 0) {
    return false;
  }
  return /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}

function stripFences(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith("```")) {
    return trimmed;
  }
  return trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

function extractCandidateText(payload: unknown): string {
  if (!isRecord(payload) || !Array.isArray(payload.candidates)) {
    throw new VoiceParseError(
      "That recording could not be turned into a set. Try again, or log it by hand.",
      "invalid",
    );
  }
  const candidate = payload.candidates[0];
  if (!isRecord(candidate) || !isRecord(candidate.content)) {
    throw new VoiceParseError(
      "That recording could not be turned into a set. Try again, or log it by hand.",
      "invalid",
    );
  }
  const parts = candidate.content.parts;
  if (!Array.isArray(parts)) {
    throw new VoiceParseError(
      "That recording could not be turned into a set. Try again, or log it by hand.",
      "invalid",
    );
  }
  const text = parts
    .map((part) => (isRecord(part) && typeof part.text === "string" ? part.text : ""))
    .join("")
    .trim();
  if (text.length === 0) {
    throw new VoiceParseError(
      "That recording could not be turned into a set. Try again, or log it by hand.",
      "invalid",
    );
  }
  return text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
