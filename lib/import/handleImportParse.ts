import type { LengthUnit } from "../../convex/lib/bodyMeasures";
import type { WeightUnit } from "../../convex/lib/units";
import { normalizeBase64, requestGeminiObject } from "../voice/gemini";
import { voiceErrorStatus, VoiceParseError } from "../voice/proposal";
import {
  checkInlineFile,
  IMPORT_PROMPT,
  IMPORT_RESPONSE_SCHEMA,
  importContextPrompt,
  MAX_IMPORT_TEXT_LENGTH,
  normalizeImport,
  type ImportProposal,
} from "./proposal";

export type ImportParseResult = {
  status: number;
  body: { error: string } | { proposal: ImportProposal; persisted: false };
};

/**
 * Reads one part of an uploaded file into workouts and body entries.
 * Nothing is stored here: the phone saves only what the person confirms.
 */
export async function handleImportParse(input: {
  token: string | null | undefined;
  signedIn: boolean;
  allowed: boolean;
  apiKey: string | undefined;
  model?: string;
  /** Text the phone pulled out of the file. */
  text?: string;
  /** A PDF or photo, sent whole. */
  fileBase64?: string;
  mimeType?: string;
  part?: { index: number; count: number };
  today: string;
  weightUnit: WeightUnit;
  lengthUnit: LengthUnit;
  fetchImpl?: typeof fetch;
}): Promise<ImportParseResult> {
  if (!input.token || !input.signedIn) {
    return { status: 401, body: { error: "Sign in to import a file." } };
  }
  if (!input.allowed) {
    return { status: 403, body: { error: "You don't have access yet." } };
  }
  const apiKey = input.apiKey?.trim() ?? "";
  if (apiKey.length === 0) {
    return {
      status: 503,
      body: { error: "Importing is not set up on the server (GEMINI_API_KEY)." },
    };
  }

  let filePart: Record<string, unknown>;
  const text = typeof input.text === "string" ? input.text.trim() : "";
  if (text.length > 0) {
    if (text.length > MAX_IMPORT_TEXT_LENGTH) {
      return { status: 400, body: { error: "That part of the file is too long. Try again." } };
    }
    filePart = { text };
  } else {
    const base64 = normalizeBase64(input.fileBase64 ?? "");
    const mimeType = (input.mimeType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
    const problem = checkInlineFile(base64, mimeType);
    if (problem) {
      return { status: 400, body: { error: problem } };
    }
    filePart = { inlineData: { mimeType, data: base64 } };
  }

  try {
    const structured = await requestGeminiObject({
      apiKey,
      model: input.model,
      fetchImpl: input.fetchImpl,
      parts: [
        { text: IMPORT_PROMPT },
        {
          text: importContextPrompt({
            today: input.today,
            weightUnit: input.weightUnit,
            lengthUnit: input.lengthUnit,
            part: input.part,
          }),
        },
        filePart,
      ],
      schema: IMPORT_RESPONSE_SCHEMA,
      logLabel: "Gemini import parse",
      logContext: text.length > 0 ? { kind: "text" } : { kind: "file" },
      unavailable: "The file reader did not answer. Try again in a minute.",
      rejected: "The file reader could not read that file. Try another file.",
      invalid: "That file could not be turned into workouts. Try another file.",
    });
    const proposal = normalizeImport(structured, {
      weightUnit: input.weightUnit,
      lengthUnit: input.lengthUnit,
      today: input.today,
    });
    return { status: 200, body: { proposal, persisted: false } };
  } catch (error) {
    if (error instanceof VoiceParseError) {
      const mapped = voiceErrorStatus(error);
      return { status: mapped.status, body: { error: mapped.error } };
    }
    return { status: 502, body: { error: "The file reader did not answer. Try again in a minute." } };
  }
}
