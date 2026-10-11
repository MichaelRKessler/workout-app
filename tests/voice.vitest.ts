// @vitest-environment node

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test, vi } from "vitest";
import { microphoneErrorMessage, preferredRecorderMimeType } from "../lib/voice/capture";
import {
  commitProposal,
  draftToProposal,
  proposalToSave,
  readVoiceResponse,
  reduceVoiceLog,
  VoiceSaveError,
  type VoiceLogEvent,
} from "../lib/voice/confirm";
import { readGeminiApiKey, readGeminiModel } from "../lib/voice/env";
import { handleVoiceParse } from "../lib/voice/handleVoiceParse";
import { GEMINI_FLASH_MODEL } from "../lib/voice/model";
import { parseWorkoutAudio, parseWorkoutText } from "../lib/voice/parseWorkout";
import {
  geminiAudioMimeType,
  normalizeGeminiWorkout,
  WORKOUT_PARSE_PROMPT,
  WORKOUT_RESPONSE_SCHEMA,
  WORKOUT_TEXT_PROMPT,
} from "../lib/voice/proposal";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const benchThreeSets = {
  exerciseName: "bench press",
  sets: [
    { reps: 10, weight: 135, unit: "lb" },
    { reps: 10, weight: 135, unit: "lb" },
    { reps: 10, weight: 135, unit: "lb" },
  ],
};

describe("spoken workout phrases", () => {
  test("bench press, three sets of ten at 135", () => {
    expect(normalizeGeminiWorkout(benchThreeSets)).toEqual({
      exerciseName: "bench press",
      sets: [
        { reps: 10, weightLb: 135 },
        { reps: 10, weightLb: 135 },
        { reps: 10, weightLb: 135 },
      ],
    });
  });

  test("push-ups 20, with no weight, is bodyweight", () => {
    expect(
      normalizeGeminiWorkout({
        exerciseName: "push-ups",
        sets: [{ reps: 20, weight: 0, unit: "lb" }],
      }),
    ).toEqual({
      exerciseName: "push-ups",
      sets: [{ reps: 20, weightLb: 0 }],
    });
  });

  test("pull-ups 8 bodyweight", () => {
    expect(
      normalizeGeminiWorkout({
        exerciseName: "pull-ups",
        sets: [{ reps: 8, weight: 0, unit: "bodyweight" }],
      }),
    ).toEqual({
      exerciseName: "pull-ups",
      sets: [{ reps: 8, weightLb: 0 }],
    });
  });

  test("dips, three sets of 12, when weight is omitted", () => {
    expect(
      normalizeGeminiWorkout({
        exerciseName: "dips",
        sets: [{ reps: 12 }, { reps: 12 }, { reps: 12 }],
      }),
    ).toEqual({
      exerciseName: "dips",
      sets: [
        { reps: 12, weightLb: 0 },
        { reps: 12, weightLb: 0 },
        { reps: 12, weightLb: 0 },
      ],
    });
  });

  test("squat 5 at 60 kg converts to pounds", () => {
    expect(
      normalizeGeminiWorkout({
        exerciseName: "squat",
        sets: [{ reps: 5, weight: 60, unit: "kg" }],
      }),
    ).toEqual({
      exerciseName: "squat",
      sets: [{ reps: 5, weightLb: 132.28 }],
    });
  });

  test("overhead press, two sets of 8 at 95 pounds", () => {
    expect(
      normalizeGeminiWorkout({
        exerciseName: "overhead press",
        sets: [
          { reps: 8, weight: 95, unit: "pounds" },
          { reps: 8, weight: 95, unit: "pounds" },
        ],
      }),
    ).toEqual({
      exerciseName: "overhead press",
      sets: [
        { reps: 8, weightLb: 95 },
        { reps: 8, weightLb: 95 },
      ],
    });
  });

  test("dumbbell row 12 at 40 lbs", () => {
    expect(
      normalizeGeminiWorkout({
        exerciseName: "dumbbell row",
        sets: [{ reps: 12, weight: 40, unit: "lbs" }],
      }),
    ).toEqual({
      exerciseName: "dumbbell row",
      sets: [{ reps: 12, weightLb: 40 }],
    });
  });
});

describe("gemini request", () => {
  test("a missing key fails before any request", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(
      parseWorkoutAudio({
        apiKey: undefined,
        audioBase64: "AAAA",
        mimeType: "audio/webm",
        fetchImpl,
      }),
    ).rejects.toThrow(/GEMINI_API_KEY/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("a blank key fails before any request", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(
      parseWorkoutAudio({
        apiKey: "   ",
        audioBase64: "AAAA",
        mimeType: "audio/webm",
        fetchImpl,
      }),
    ).rejects.toThrow(/GEMINI_API_KEY/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("sends structured audio output for bench press, three sets of ten at 135", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: `\`\`\`json\n${JSON.stringify(benchThreeSets)}\n\`\`\`` }],
              },
            },
          ],
        }),
        { status: 200 },
      );
    });

    const proposal = await parseWorkoutAudio({
      apiKey: "test-gemini-key",
      audioBase64: "AAAA",
      mimeType: "audio/mp4",
      fetchImpl,
    });

    expect(proposal.sets).toHaveLength(3);
    expect(proposal.sets[0]).toEqual({ reps: 10, weightLb: 135 });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_FLASH_MODEL}:generateContent`,
    );
    expect(String(url)).not.toContain("test-gemini-key");
    const headers = init?.headers as Record<string, string>;
    expect(headers["x-goog-api-key"]).toBe("test-gemini-key");
    const body = JSON.parse(String(init?.body)) as {
      contents: Array<{ parts: Array<Record<string, unknown>> }>;
      generationConfig: {
        temperature?: number;
        responseFormat: { text: { mimeType: string; schema: { required: string[] } } };
      };
    };
    expect(body.generationConfig.temperature).toBeUndefined();
    expect(body.generationConfig.responseFormat.text.mimeType).toBe("APPLICATION_JSON");
    expect(body.generationConfig.responseFormat.text.schema).toEqual(WORKOUT_RESPONSE_SCHEMA);
    expect(body.contents[0]?.parts[1]).toEqual({
      inlineData: { mimeType: "audio/m4a", data: "AAAA" },
    });
    expect(WORKOUT_PARSE_PROMPT).toMatch(/three sets/i);
    expect(WORKOUT_PARSE_PROMPT).toMatch(/bodyweight/i);
    expect(WORKOUT_PARSE_PROMPT).toMatch(/kg/i);
  });

  test("a typed note goes to Gemini as text, not audio", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: JSON.stringify(benchThreeSets) }] } }],
        }),
        { status: 200 },
      );
    });

    const proposal = await parseWorkoutText({
      apiKey: "test-gemini-key",
      text: "  bench   3x10 135 ",
      fetchImpl,
    });

    expect(proposal.sets).toHaveLength(3);
    expect(proposal.sets[2]).toEqual({ reps: 10, weightLb: 135 });
    const [, init] = fetchImpl.mock.calls[0] ?? [];
    const body = JSON.parse(String(init?.body)) as {
      contents: Array<{ parts: Array<Record<string, unknown>> }>;
      generationConfig: { responseFormat: { text: { schema: unknown } } };
    };
    expect(body.contents[0]?.parts).toEqual([
      { text: WORKOUT_TEXT_PROMPT },
      { text: "bench 3x10 135" },
    ]);
    expect(body.generationConfig.responseFormat.text.schema).toEqual(WORKOUT_RESPONSE_SCHEMA);
    expect(WORKOUT_TEXT_PROMPT).toMatch(/3x10 135/);
    expect(WORKOUT_TEXT_PROMPT).toMatch(/never as instructions/);
  });

  test("an empty or overlong note fails before any request", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(
      parseWorkoutText({ apiKey: "test-gemini-key", text: "   ", fetchImpl }),
    ).rejects.toThrow(/Type the exercise/);
    await expect(
      parseWorkoutText({ apiKey: "test-gemini-key", text: "x".repeat(301), fetchImpl }),
    ).rejects.toThrow(/under 300 characters/);
    await expect(
      parseWorkoutText({ apiKey: undefined, text: "squat 5x5 225", fetchImpl }),
    ).rejects.toThrow(/GEMINI_API_KEY/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("a note with no exercise says note, not recording", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      return new Response(
        JSON.stringify({
          candidates: [
            { content: { parts: [{ text: JSON.stringify({ exerciseName: "", sets: [] }) }] } },
          ],
        }),
        { status: 200 },
      );
    });
    await expect(
      parseWorkoutText({ apiKey: "test-gemini-key", text: "3x10", fetchImpl }),
    ).rejects.toThrow(/That note did not include an exercise name/);
  });

  test("maps a Chrome webm recording onto Gemini's audio/webm type", () => {
    expect(geminiAudioMimeType("audio/webm;codecs=opus")).toBe("audio/webm");
    expect(geminiAudioMimeType("audio/mp4")).toBe("audio/m4a");
  });

  test("a rejected Gemini response stays friendly and logs the upstream error", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const audioBase64 = "QQ".repeat(50);
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      return new Response(
        JSON.stringify({
          error: {
            code: 400,
            status: "INVALID_ARGUMENT",
            message:
              'Invalid value at \'generation_config.response_format.text.mime_type\', "application/json"',
          },
        }),
        { status: 400 },
      );
    });

    await expect(
      parseWorkoutAudio({
        apiKey: "AQ.test-secret-key",
        audioBase64,
        mimeType: "audio/webm;codecs=opus",
        fetchImpl,
      }),
    ).rejects.toThrow(/could not read that recording/);

    const logged = errorSpy.mock.calls.flat().map((part) => JSON.stringify(part)).join(" ");
    expect(logged).toMatch(/INVALID_ARGUMENT/);
    expect(logged).toMatch(/application\/json/);
    expect(logged).toMatch(/audio\/webm/);
    expect(logged).not.toContain("AQ.test-secret-key");
    expect(logged).not.toContain(audioBase64);
    errorSpy.mockRestore();
  });

  test("thinking text is ignored and the structured set is kept", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  { thought: true, text: "The speaker said three sets." },
                  { text: JSON.stringify(benchThreeSets) },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      );
    });

    const proposal = await parseWorkoutAudio({
      apiKey: "test-gemini-key",
      audioBase64: "AAAA",
      mimeType: "audio/webm;codecs=opus",
      fetchImpl,
    });
    expect(proposal).toEqual({
      exerciseName: "bench press",
      sets: [
        { reps: 10, weightLb: 135 },
        { reps: 10, weightLb: 135 },
        { reps: 10, weightLb: 135 },
      ],
    });
  });
});

describe("who can parse, and when a set is stored", () => {
  test("a signed-out request does not call Gemini", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const result = await handleVoiceParse({
      token: null,
      signedIn: false,
      apiKey: undefined,
      audioBase64: "AAAA",
      mimeType: "audio/webm",
      fetchImpl,
    });
    expect(result.status).toBe(401);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("a signed-in request with no key explains that and does not call Gemini", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const result = await handleVoiceParse({
      token: "session-token",
      signedIn: true,
      apiKey: undefined,
      audioBase64: "AAAA",
      mimeType: "audio/webm",
      fetchImpl,
    });
    expect(result.status).toBe(503);
    expect(result.body).toMatchObject({
      error: expect.stringMatching(/GEMINI_API_KEY/),
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("a successful parse is only a preview", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: JSON.stringify(benchThreeSets) }] } }],
        }),
        { status: 200 },
      );
    });
    const result = await handleVoiceParse({
      token: "session-token",
      signedIn: true,
      apiKey: "test-gemini-key",
      audioBase64: "AAAA",
      mimeType: "audio/webm",
      fetchImpl,
    });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ persisted: false });
    if (!("proposal" in result.body)) {
      throw new Error("expected a proposal");
    }
    expect(result.body.proposal.sets).toHaveLength(3);
    expect(readVoiceResponse(result.body).exerciseName).toBe("bench press");
    expect(() =>
      readVoiceResponse({ proposal: result.body.proposal, persisted: true }),
    ).toThrow(/Nothing was saved/);
  });

  test("a typed note uses the same preview, and an empty note still needs a recording", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: JSON.stringify(benchThreeSets) }] } }],
        }),
        { status: 200 },
      );
    });
    const typed = await handleVoiceParse({
      token: "session-token",
      signedIn: true,
      apiKey: "test-gemini-key",
      audioBase64: "",
      mimeType: "",
      text: "bench press 3x10 135",
      fetchImpl,
    });
    expect(typed.status).toBe(200);
    expect(typed.body).toMatchObject({ persisted: false });

    const blank = await handleVoiceParse({
      token: "session-token",
      signedIn: true,
      apiKey: "test-gemini-key",
      audioBase64: "",
      mimeType: "",
      text: "   ",
      fetchImpl,
    });
    expect(blank.status).toBe(400);
    expect(fetchImpl).toHaveBeenCalledOnce();

    const signedOut = await handleVoiceParse({
      token: null,
      signedIn: false,
      apiKey: "test-gemini-key",
      audioBase64: "",
      mimeType: "",
      text: "bench press 3x10 135",
      fetchImpl,
    });
    expect(signedOut.status).toBe(401);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  test("typing, cancelling, and a failed save move between the right states", () => {
    const proposal = normalizeGeminiWorkout(benchThreeSets);
    expect(reduceVoiceLog({ status: "idle" }, { type: "submit-text" }).status).toBe("parsing");
    expect(
      reduceVoiceLog({ status: "preview", proposal }, { type: "submit-text" }).status,
    ).toBe("parsing");
    expect(reduceVoiceLog({ status: "recording" }, { type: "submit-text" }).status).toBe(
      "recording",
    );
    expect(reduceVoiceLog({ status: "parsing" }, { type: "cancel" }).status).toBe("idle");
    expect(
      reduceVoiceLog({ status: "error", message: "x" }, { type: "dismiss" }).status,
    ).toBe("idle");

    const remaining = { exerciseName: "bench press", sets: [{ reps: 10, weightLb: 135 }] };
    expect(
      reduceVoiceLog({ status: "saving", proposal }, { type: "save-failed", proposal: remaining }),
    ).toEqual({ status: "preview", proposal: remaining });
    expect(
      reduceVoiceLog({ status: "idle" }, { type: "save-failed", proposal: remaining }).status,
    ).toBe("idle");
  });

  test("nothing is saved until the preview is confirmed", () => {
    const proposal = normalizeGeminiWorkout({
      exerciseName: "push-ups",
      sets: [{ reps: 20, weight: 0, unit: "lb" }],
    });
    const preview = reduceVoiceLog({ status: "parsing" }, { type: "parsed", proposal });
    expect(preview.status).toBe("preview");

    const beforeConfirm: VoiceLogEvent[] = [
      { type: "parsed", proposal },
      { type: "discard" },
      { type: "cancel" },
      { type: "submit-audio" },
      { type: "failed", message: "Microphone access is blocked." },
      { type: "saved" },
      { type: "start-recording" },
    ];
    for (const event of beforeConfirm) {
      expect(proposalToSave(preview, event)).toBeNull();
      expect(reduceVoiceLog(preview, event).status).not.toBe("saving");
    }

    const edited = {
      exerciseName: "Push-ups",
      sets: [{ reps: 15, weightLb: 0 }],
    };
    expect(proposalToSave(preview, { type: "confirm", proposal: edited })).toEqual(edited);
    expect(proposalToSave({ status: "idle" }, { type: "confirm", proposal: edited })).toBeNull();
    expect(
      reduceVoiceLog({ status: "idle" }, { type: "confirm", proposal: edited }).status,
    ).toBe("idle");
  });

  test("confirm writes one set per parsed set, and a discarded preview writes none", async () => {
    const proposal = normalizeGeminiWorkout(benchThreeSets);
    const preview = reduceVoiceLog({ status: "parsing" }, { type: "parsed", proposal });
    const saved: Array<{ exerciseName: string; reps: number; weightLb: number }> = [];

    expect(proposalToSave(preview, { type: "discard" })).toBeNull();
    expect(saved).toEqual([]);

    const toSave = proposalToSave(preview, { type: "confirm", proposal });
    if (!toSave) {
      throw new Error("confirm should return the proposal");
    }
    await commitProposal(toSave, async (set) => {
      saved.push(set);
    });
    expect(saved).toEqual([
      { exerciseName: "bench press", reps: 10, weightLb: 135 },
      { exerciseName: "bench press", reps: 10, weightLb: 135 },
      { exerciseName: "bench press", reps: 10, weightLb: 135 },
    ]);
  });

  test("an edit has to stay valid, and a failed later set does not pretend the rest saved", async () => {
    expect(
      draftToProposal({
        exerciseName: "squat",
        sets: [
          { reps: "5", weight: "132.28" },
          { reps: "5", weight: "0" },
        ],
      }),
    ).toEqual({
      exerciseName: "squat",
      sets: [
        { reps: 5, weightLb: 132.28 },
        { reps: 5, weightLb: 0 },
      ],
    });
    expect(
      draftToProposal({
        exerciseName: "squat",
        sets: [{ reps: "0", weight: "100" }],
      }),
    ).toBeNull();

    const proposal = normalizeGeminiWorkout({
      exerciseName: "squat",
      sets: [
        { reps: 5, weight: 100, unit: "kg" },
        { reps: 5, weight: 100, unit: "kg" },
      ],
    });
    let calls = 0;
    await expect(
      commitProposal(proposal, async () => {
        calls += 1;
        if (calls === 2) {
          throw new Error("Workout not found");
        }
      }),
    ).rejects.toBeInstanceOf(VoiceSaveError);
    expect(calls).toBe(2);
  });
});

describe("microphone failures stay on the manual log", () => {
  test("permission denied, missing capture, and an insecure page have clear messages", () => {
    expect(
      microphoneErrorMessage(new DOMException("nope", "NotAllowedError"), {
        hasMediaDevices: true,
        hasMediaRecorder: true,
        secureContext: true,
      }),
    ).toMatch(/Microphone access is blocked/);
    expect(
      microphoneErrorMessage(null, {
        hasMediaDevices: false,
        hasMediaRecorder: false,
        secureContext: true,
      }),
    ).toMatch(/cannot record/);
    expect(
      microphoneErrorMessage(null, {
        hasMediaDevices: true,
        hasMediaRecorder: true,
        secureContext: false,
      }),
    ).toMatch(/secure page/);
    expect(
      preferredRecorderMimeType((type) => type === "audio/mp4"),
    ).toBe("audio/mp4");
    expect(preferredRecorderMimeType(undefined)).toBeUndefined();
  });
});

describe("server env", () => {
  test("GEMINI_API_KEY is read from the server env and a blank value counts as missing", () => {
    const previousKey = process.env.GEMINI_API_KEY;
    const previousModel = process.env.GEMINI_MODEL;
    process.env.GEMINI_API_KEY = "   ";
    delete process.env.GEMINI_MODEL;
    expect(readGeminiApiKey()).toBeUndefined();
    expect(readGeminiModel()).toBe(GEMINI_FLASH_MODEL);
    process.env.GEMINI_API_KEY = "test-gemini-key";
    process.env.GEMINI_MODEL = "gemini-3.8-flash";
    expect(readGeminiApiKey()).toBe("test-gemini-key");
    expect(readGeminiModel()).toBe("gemini-3.8-flash");
    restore("GEMINI_API_KEY", previousKey);
    restore("GEMINI_MODEL", previousModel);
  });

  test("client code never mentions the key or the Gemini endpoint", () => {
    const files = [
      ...sourceFiles(path.join(root, "components")),
      ...sourceFiles(path.join(root, "app"), new Set(["api"])),
    ];
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toContain("GEMINI_API_KEY");
      expect(source, file).not.toContain("generativelanguage.googleapis.com");
      expect(source, file).not.toContain("readGeminiApiKey");
      expect(source, file).not.toContain("parseWorkoutAudio");
      expect(source, file).not.toContain("parseWorkoutText");
    }
  });
});

function restore(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

function sourceFiles(dir: string, skip = new Set<string>()): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (skip.has(entry)) {
      continue;
    }
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...sourceFiles(full, skip));
      continue;
    }
    if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
      files.push(full);
    }
  }
  return files;
}
