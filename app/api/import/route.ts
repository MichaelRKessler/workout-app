import "server-only";
import { NextResponse } from "next/server";
import { handleImportParse } from "@/lib/import/handleImportParse";
import { readGeminiApiKey, readGeminiModel } from "@/lib/voice/env";
import { loadRoutePreferences, loadRouteUser } from "@/lib/voice/routeUser";

export const runtime = "nodejs";
// A long part of a spreadsheet, or a PDF of a training log, can take Gemini a while.
export const maxDuration = 120;

export async function POST(request: Request) {
  const user = await loadRouteUser();

  let payload: unknown;
  try {
    payload = (await request.json()) as unknown;
  } catch {
    return NextResponse.json({ error: "That file could not be read. Try another file." }, { status: 400 });
  }
  const body = isRecord(payload) ? payload : {};
  const preferences = await loadRoutePreferences(user);

  const result = await handleImportParse({
    token: user.token,
    signedIn: user.signedIn,
    allowed: user.allowed,
    apiKey: readGeminiApiKey(),
    model: readGeminiModel(),
    text: typeof body.text === "string" ? body.text : undefined,
    fileBase64: typeof body.fileBase64 === "string" ? body.fileBase64 : undefined,
    mimeType: typeof body.mimeType === "string" ? body.mimeType : undefined,
    part: partOf(body.part),
    today: todayOf(body.today),
    weightUnit: preferences.weightUnit,
    lengthUnit: preferences.lengthUnit,
  });
  return NextResponse.json(result.body, { status: result.status });
}

/** The phone's own date, so "Mar 3" with no year resolves in its time zone. */
function todayOf(value: unknown): string {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  return new Date().toISOString().slice(0, 10);
}

function partOf(value: unknown): { index: number; count: number } | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const { index, count } = value;
  if (
    typeof index !== "number" ||
    typeof count !== "number" ||
    !Number.isInteger(index) ||
    !Number.isInteger(count) ||
    index < 0 ||
    count < 1 ||
    index >= count
  ) {
    return undefined;
  }
  return { index, count };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
