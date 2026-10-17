export type VoiceParseCode =
  | "missing_key"
  | "rejected"
  | "invalid"
  | "unavailable";

export class VoiceParseError extends Error {
  readonly code: VoiceParseCode;

  constructor(message: string, code: VoiceParseCode) {
    super(message);
    this.name = "VoiceParseError";
    this.code = code;
  }
}
