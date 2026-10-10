/**
 * Gemini model used to parse a spoken set.
 * Change this constant to move to another Flash model.
 * A server env var named GEMINI_MODEL overrides it when set.
 */
export const GEMINI_FLASH_MODEL = "gemini-3.8-flash";

export const GEMINI_GENERATE_CONTENT_URL = (model: string): string =>
  `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
