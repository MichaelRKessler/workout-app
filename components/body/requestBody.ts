import { readBodyResponse, type BodyProposal } from "@/lib/voice/bodyProposal";

type ParseBody = { audioBase64: string; mimeType: string } | { text: string };

/** Asks /api/voice for a body-weight preview. Nothing is saved. */
export async function requestBodyProposal(
  body: ParseBody,
  signal: AbortSignal,
): Promise<BodyProposal> {
  const response = await fetch("/api/voice", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, kind: "body" }),
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
  return readBodyResponse(payload);
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
  return "That could not be read. Type the measurement in.";
}
