import { env } from "node:process";
import { GEMINI_FLASH_MODEL } from "./model";

const GEMINI_API_KEY_NAME = "GEMINI_API_KEY";
const GEMINI_MODEL_NAME = "GEMINI_MODEL";

function readTrimmed(name: string): string | undefined {
  const value = env[name];
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Server-only. Reads GEMINI_API_KEY without a static process.env lookup. */
export function readGeminiApiKey(): string | undefined {
  return readTrimmed(GEMINI_API_KEY_NAME);
}

export function readGeminiModel(): string {
  return readTrimmed(GEMINI_MODEL_NAME) ?? GEMINI_FLASH_MODEL;
}
