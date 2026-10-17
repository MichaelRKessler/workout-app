import { readVoiceLogResponse } from "@/lib/voice/confirm";
import type { VoiceLogResult } from "@/lib/voice/proposal";

type ParseBody = { audioBase64: string; mimeType: string } | { text: string };

/** Asks /api/voice to turn a clip or a typed note into a preview of sets, a weigh-in, or both. Nothing is saved. */
export async function requestProposal(
  body: ParseBody,
  signal: AbortSignal,
): Promise<VoiceLogResult> {
  const response = await fetch("/api/voice", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  let payload: unknown = null;
  try {
    payload = (await response.json()) as unknown;
  } catch {
    payload = null;
  }
  if (!response.ok) {
    throw new Error(errorFromPayload(payload));
  }
  return readVoiceLogResponse(payload);
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function errorFromPayload(payload: unknown): string {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof payload.error === "string" &&
    payload.error.trim().length > 0
  ) {
    return payload.error;
  }
  return "That could not be read. Log the set by hand.";
}
