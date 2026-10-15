import "server-only";
import { fetchQuery } from "convex/nextjs";
import { NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import { readGeminiApiKey, readGeminiModel } from "@/lib/voice/env";
import { handleVoiceParse } from "@/lib/voice/handleVoiceParse";
import { loadKnownExerciseNames } from "@/lib/voice/knownExercises";
import { loadRoutePreferences, loadRouteUser } from "@/lib/voice/routeUser";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const user = await loadRouteUser();
  const { token } = user;

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
  const text =
    isRecord(payload) && typeof payload.text === "string" ? payload.text : undefined;
  const kind = isRecord(payload) && payload.kind === "body" ? "body" : "workout";

  const knownExerciseNames = await loadKnownExerciseNames(user, async () => {
    if (!token || !process.env.NEXT_PUBLIC_CONVEX_URL) {
      return [];
    }
    // namesForVoice is allow-listed and scoped to this token's user. The request
    // body is not a source of names.
    return await fetchQuery(api.exercises.namesForVoice, {}, { token });
  });

  const preferences = await loadRoutePreferences(user);

  const result = await handleVoiceParse({
    token,
    signedIn: user.signedIn,
    allowed: user.allowed,
    apiKey: readGeminiApiKey(),
    model: readGeminiModel(),
    audioBase64,
    mimeType,
    text,
    knownExerciseNames: kind === "body" ? [] : knownExerciseNames,
    weightUnit: preferences.weightUnit,
    lengthUnit: preferences.lengthUnit,
    kind,
  });

  return NextResponse.json(result.body, { status: result.status });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
