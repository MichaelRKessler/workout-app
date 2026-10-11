import "server-only";
import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { fetchQuery } from "convex/nextjs";
import { NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import type { LengthUnit } from "@/convex/lib/bodyMeasures";
import { defaultLengthUnit } from "@/convex/lib/bodyMeasures";
import type { WeightUnit } from "@/convex/lib/units";
import { readVoiceAccess } from "@/lib/voice/access";
import { readGeminiApiKey, readGeminiModel } from "@/lib/voice/env";
import { handleVoiceParse } from "@/lib/voice/handleVoiceParse";
import { loadKnownExerciseNames } from "@/lib/voice/knownExercises";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const token = await convexAuthNextjsToken();
  let status: { allowed: boolean } | null = null;
  if (token && process.env.NEXT_PUBLIC_CONVEX_URL) {
    try {
      const access = await fetchQuery(api.access.myStatus, {}, { token });
      status = { allowed: access.allowed };
    } catch {
      status = null;
    }
  }
  const voiceAccess = readVoiceAccess({ token, status });

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

  const knownExerciseNames = await loadKnownExerciseNames(voiceAccess, async () => {
    if (!token || !process.env.NEXT_PUBLIC_CONVEX_URL) {
      return [];
    }
    // namesForVoice is allow-listed and scoped to this token's user. The request
    // body is not a source of names.
    return await fetchQuery(api.exercises.namesForVoice, {}, { token });
  });

  const preferences = await loadPreferences(voiceAccess, async () => {
    if (!token || !process.env.NEXT_PUBLIC_CONVEX_URL) {
      return { weightUnit: "lb" as const, lengthUnit: "in" as const };
    }
    const row = await fetchQuery(api.users.preferences, {}, { token });
    return { weightUnit: row.weightUnit, lengthUnit: row.lengthUnit };
  });

  const result = await handleVoiceParse({
    token,
    signedIn: voiceAccess.signedIn,
    allowed: voiceAccess.allowed,
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

async function loadPreferences(
  access: { signedIn: boolean; allowed: boolean },
  load: () => Promise<{ weightUnit: WeightUnit; lengthUnit: LengthUnit }>,
): Promise<{ weightUnit: WeightUnit; lengthUnit: LengthUnit }> {
  if (!access.signedIn || !access.allowed) {
    return { weightUnit: "lb", lengthUnit: "in" };
  }
  try {
    const row = await load();
    const weightUnit = row.weightUnit === "kg" ? "kg" : "lb";
    const lengthUnit = row.lengthUnit === "cm" || row.lengthUnit === "in" ? row.lengthUnit : defaultLengthUnit(weightUnit);
    return { weightUnit, lengthUnit };
  } catch {
    return { weightUnit: "lb", lengthUnit: "in" };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
