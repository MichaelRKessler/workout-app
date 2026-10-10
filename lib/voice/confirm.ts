import { formatExerciseName } from "../../convex/lib/exerciseName";
import { parseReps, parseWeightLb } from "../numbers";
import {
  MAX_VOICE_SETS,
  normalizeGeminiWorkout,
  type VoiceProposal,
  VoiceParseError,
} from "./proposal";

export type VoiceDraft = {
  exerciseName: string;
  sets: Array<{ reps: string; weight: string }>;
};

export type VoiceLogState =
  | { status: "idle" }
  | { status: "recording" }
  | { status: "parsing" }
  | { status: "preview"; proposal: VoiceProposal }
  | { status: "saving"; proposal: VoiceProposal }
  | { status: "error"; message: string };

export type VoiceLogEvent =
  | { type: "start-recording" }
  | { type: "cancel" }
  | { type: "submit-audio" }
  | { type: "parsed"; proposal: VoiceProposal }
  | { type: "failed"; message: string }
  | { type: "discard" }
  | { type: "confirm"; proposal: VoiceProposal }
  | { type: "saved" };

export class VoiceSaveError extends Error {
  readonly savedCount: number;

  constructor(message: string, savedCount: number) {
    super(message);
    this.name = "VoiceSaveError";
    this.savedCount = savedCount;
  }
}

export function reduceVoiceLog(
  state: VoiceLogState,
  event: VoiceLogEvent,
): VoiceLogState {
  switch (event.type) {
    case "start-recording":
      if (
        state.status === "idle" ||
        state.status === "error" ||
        state.status === "preview"
      ) {
        return { status: "recording" };
      }
      return state;
    case "cancel":
      return state.status === "recording" ? { status: "idle" } : state;
    case "submit-audio":
      return state.status === "recording" ? { status: "parsing" } : state;
    case "parsed":
      return state.status === "parsing"
        ? { status: "preview", proposal: event.proposal }
        : state;
    case "failed":
      if (state.status === "saving") {
        return state;
      }
      return { status: "error", message: event.message };
    case "discard":
      return state.status === "preview" ? { status: "idle" } : state;
    case "confirm":
      return state.status === "preview"
        ? { status: "saving", proposal: event.proposal }
        : state;
    case "saved":
      return state.status === "saving" ? { status: "idle" } : state;
    default:
      return state;
  }
}

/** Returns the proposal to write, and only after an explicit confirm from the preview. */
export function proposalToSave(
  state: VoiceLogState,
  event: VoiceLogEvent,
): VoiceProposal | null {
  if (event.type !== "confirm" || state.status !== "preview") {
    return null;
  }
  const next = reduceVoiceLog(state, event);
  if (next.status !== "saving") {
    return null;
  }
  return next.proposal;
}

export function proposalToDraft(proposal: VoiceProposal): VoiceDraft {
  return {
    exerciseName: proposal.exerciseName,
    sets: proposal.sets.map((set) => ({
      reps: String(set.reps),
      weight: String(set.weightLb),
    })),
  };
}

export function draftToProposal(draft: VoiceDraft): VoiceProposal | null {
  const formatted = formatExerciseName(draft.exerciseName);
  if (!formatted || draft.sets.length === 0 || draft.sets.length > MAX_VOICE_SETS) {
    return null;
  }

  const sets: VoiceProposal["sets"] = [];
  for (const set of draft.sets) {
    const reps = parseReps(set.reps);
    const weightLb = parseWeightLb(set.weight);
    if (reps === null || weightLb === null) {
      return null;
    }
    sets.push({ reps, weightLb });
  }

  return { exerciseName: formatted.name, sets };
}

/**
 * The parse response is a preview. A payload that claims the sets were already
 * stored is rejected so the client cannot treat parsing as a save.
 */
export function readVoiceResponse(payload: unknown): VoiceProposal {
  if (!isRecord(payload) || payload.persisted !== false || !isRecord(payload.proposal)) {
    throw new VoiceParseError(
      "Voice logging returned an unexpected result. Nothing was saved. Log the set by hand.",
      "invalid",
    );
  }

  const sets = Array.isArray(payload.proposal.sets)
    ? payload.proposal.sets.map((set) => {
        if (!isRecord(set)) {
          return set;
        }
        return { reps: set.reps, weight: set.weightLb, unit: "lb" };
      })
    : [];

  return normalizeGeminiWorkout({
    exerciseName: payload.proposal.exerciseName,
    sets,
  });
}

export async function commitProposal(
  proposal: VoiceProposal,
  save: (set: {
    exerciseName: string;
    reps: number;
    weightLb: number;
  }) => Promise<void>,
): Promise<void> {
  for (let index = 0; index < proposal.sets.length; index += 1) {
    const set = proposal.sets[index];
    if (!set) {
      continue;
    }
    try {
      await save({
        exerciseName: proposal.exerciseName,
        reps: set.reps,
        weightLb: set.weightLb,
      });
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : "The set could not be saved.";
      throw new VoiceSaveError(
        index === 0
          ? reason
          : `Saved ${index} ${index === 1 ? "set" : "sets"}, then failed. ${reason}`,
        index,
      );
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
