import "server-only";
import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { fetchQuery } from "convex/nextjs";
import { NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import { readGeminiApiKey, readGeminiModel } from "@/lib/voice/env";
import { handleVoiceParse } from "@/lib/voice/handleVoiceParse";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const token = await convexAuthNextjsToken();
  let signedIn = false;
  if (token && process.env.NEXT_PUBLIC_CONVEX_URL) {
    try {
      await fetchQuery(api.users.viewer, {}, { token });
      signedIn = true;
    } catch {
      signedIn = false;
    }
  }

  let payload: unknown;
  try {
    payload = (await request.json()) as unknown;
  } catch {
    return NextResponse.json(
      { error: "The recording could not be read. Log the set by hand." },
      { status: 400 },
    );
  }

  const audioBase64 =
    isRecord(payload) && typeof payload.audioBase64 === "string"
      ? payload.audioBase64
      : "";
  const mimeType =
    isRecord(payload) && typeof payload.mimeType === "string"
      ? payload.mimeType
      : "";

  const result = await handleVoiceParse({
    token,
    signedIn,
    apiKey: readGeminiApiKey(),
    model: readGeminiModel(),
    audioBase64,
    mimeType,
  });

  return NextResponse.json(result.body, { status: result.status });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
