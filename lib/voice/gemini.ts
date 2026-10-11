import { GEMINI_FLASH_MODEL, GEMINI_GENERATE_CONTENT_URL } from "./model";
import { VoiceParseError } from "./proposal";

export async function requestGeminiObject(options: {
  apiKey: string;
  model: string | undefined;
  fetchImpl: typeof fetch | undefined;
  parts: Array<Record<string, unknown>>;
  schema: unknown;
  logLabel: string;
  logContext: Record<string, string>;
  unavailable: string;
  rejected: string;
  invalid: string;
}): Promise<unknown> {
  const model = options.model?.trim() || GEMINI_FLASH_MODEL;
  const fetchImpl = options.fetchImpl ?? fetch;

  let response: Response;
  try {
    response = await fetchImpl(GEMINI_GENERATE_CONTENT_URL(model), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": options.apiKey,
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: options.parts }],
        generationConfig: {
          responseFormat: {
            text: {
              mimeType: "APPLICATION_JSON",
              schema: options.schema,
            },
          },
        },
      }),
    });
  } catch (error) {
    console.error(`${options.logLabel} request failed`, {
      model,
      ...options.logContext,
      message: error instanceof Error ? error.message : "unknown",
    });
    throw new VoiceParseError(options.unavailable, "unavailable");
  }

  const raw = await response.text();
  if (!response.ok) {
    console.error(`${options.logLabel} was rejected`, {
      status: response.status,
      model,
      ...options.logContext,
      upstream: summarizeGeminiError(raw),
    });
    throw new VoiceParseError(options.rejected, "unavailable");
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw) as unknown;
  } catch {
    throw new VoiceParseError(options.invalid, "invalid");
  }

  const text = extractCandidateText(payload, options.invalid);
  try {
    return JSON.parse(stripFences(text)) as unknown;
  } catch {
    throw new VoiceParseError(options.invalid, "invalid");
  }
}

export function normalizeBase64(value: string): string {
  const trimmed = value.trim();
  const marker = "base64,";
  const markerIndex = trimmed.indexOf(marker);
  const payload =
    trimmed.startsWith("data:") && markerIndex !== -1
      ? trimmed.slice(markerIndex + marker.length)
      : trimmed;
  return payload.replace(/\s/g, "");
}

export function isBase64(value: string): boolean {
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

function extractCandidateText(payload: unknown, invalidMessage: string): string {
  if (!isRecord(payload) || !Array.isArray(payload.candidates)) {
    throw new VoiceParseError(invalidMessage, "invalid");
  }
  const candidate = payload.candidates[0];
  if (!isRecord(candidate) || !isRecord(candidate.content)) {
    throw new VoiceParseError(invalidMessage, "invalid");
  }
  const parts = candidate.content.parts;
  if (!Array.isArray(parts)) {
    throw new VoiceParseError(invalidMessage, "invalid");
  }
  const text = parts
    .filter((part) => !(isRecord(part) && part.thought === true))
    .map((part) => (isRecord(part) && typeof part.text === "string" ? part.text : ""))
    .join("")
    .trim();
  if (text.length === 0) {
    throw new VoiceParseError(invalidMessage, "invalid");
  }
  return text;
}

function summarizeGeminiError(raw: string): string {
  let message = raw.trim();
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      isRecord(parsed) &&
      isRecord(parsed.error) &&
      typeof parsed.error.message === "string" &&
      parsed.error.message.trim().length > 0
    ) {
      const status = typeof parsed.error.status === "string" ? `${parsed.error.status}: ` : "";
      message = `${status}${parsed.error.message.trim()}`;
    }
  } catch {
    message = raw.trim();
  }
  return redactSecrets(message).slice(0, 500);
}

function redactSecrets(value: string): string {
  return value
    .replace(/AQ\.[A-Za-z0-9._\-]+/g, "[redacted]")
    .replace(/AIza[0-9A-Za-z_\-]+/g, "[redacted]")
    .replace(/[A-Za-z0-9+/]{80,}={0,2}/g, "[redacted]");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
