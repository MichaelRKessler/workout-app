import { formatExerciseName } from "../../convex/lib/exerciseName";
import {
  formatClock,
  formatDistance,
  parseClock,
  parseDistanceInput,
  setKind,
  type SetKind,
} from "../../convex/lib/measures";
import { resolvedSetType, type SetType } from "../../convex/lib/setType";
import { formatWeightAmount, weightLbFromDisplay, type WeightUnit } from "../../convex/lib/units";
import { parseReps } from "../numbers";
import {
  MAX_VOICE_SETS,
  normalizeGeminiWorkout,
  type VoiceProposal,
  type VoiceSet,
  VoiceParseError,
} from "./proposal";

export type DraftSet = {
  kind: SetKind;
  reps: string;
  weight: string;
  duration: string;
  distance: string;
  rpe: string;
  /** Stored pounds behind the weight field, so an unedited kg display does not drift. */
  weightLb: number | null;
  setType: SetType;
};

export type VoiceDraft = {
  note: string;
  exercises: Array<{
    exerciseName: string;
    sets: DraftSet[];
  }>;
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
  | { type: "submit-text" }
  | { type: "parsed"; proposal: VoiceProposal }
  | { type: "failed"; message: string }
  | { type: "discard" }
  | { type: "confirm"; proposal: VoiceProposal }
  | { type: "saved" }
  | { type: "save-failed"; proposal: VoiceProposal }
  | { type: "dismiss" };

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
      return state.status === "recording" || state.status === "parsing"
        ? { status: "idle" }
        : state;
    case "submit-audio":
      return state.status === "recording" ? { status: "parsing" } : state;
    case "submit-text":
      return state.status === "idle" ||
        state.status === "error" ||
        state.status === "preview"
        ? { status: "parsing" }
        : state;
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
    case "save-failed":
      return state.status === "saving"
        ? { status: "preview", proposal: event.proposal }
        : state;
    case "dismiss":
      return state.status === "error" ? { status: "idle" } : state;
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

export function proposalToDraft(proposal: VoiceProposal, unit: WeightUnit = "lb"): VoiceDraft {
  return {
    note: proposal.note ?? "",
    exercises: proposal.exercises.map((exercise) => ({
      exerciseName: exercise.exerciseName,
      sets: exercise.sets.map((set) => ({
        kind: setKind(set),
        reps: set.reps === null ? "" : String(set.reps),
        weight: formatWeightAmount(set.weightLb, unit),
        duration: set.durationSec === null ? "" : formatClock(set.durationSec),
        distance: set.distanceM === null ? "" : formatDistance(set.distanceM),
        rpe: set.rpe === null ? "" : String(set.rpe),
        weightLb: set.weightLb,
        setType: resolvedSetType(set.setType),
      })),
    })),
  };
}

export function draftToProposal(draft: VoiceDraft, unit: WeightUnit = "lb"): VoiceProposal | null {
  if (draft.exercises.length === 0) {
    return null;
  }
  const note = draft.note.trim().replace(/\s+/g, " ");
  if (note.length > 500) {
    return null;
  }
  const exercises: VoiceProposal["exercises"] = [];
  let total = 0;
  for (const exercise of draft.exercises) {
    const formatted = formatExerciseName(exercise.exerciseName);
    if (!formatted || exercise.sets.length === 0) {
      return null;
    }
    total += exercise.sets.length;
    if (total > MAX_VOICE_SETS) {
      return null;
    }
    const sets: VoiceSet[] = [];
    for (const set of exercise.sets) {
      const parsed = draftSetToVoice(set, unit);
      if (!parsed) {
        return null;
      }
      sets.push(parsed);
    }
    exercises.push({ exerciseName: formatted.name, sets });
  }
  return { note: note.length > 0 ? note : null, exercises };
}

function draftSetToVoice(set: DraftSet, unit: WeightUnit): VoiceSet | null {
  const weightLb = weightLbFromDisplay(set.weight, unit, set.weightLb);
  if (weightLb === null) {
    return null;
  }
  const rpe = set.rpe.trim().length === 0 ? null : Number(set.rpe.trim());
  if (rpe !== null && (!Number.isInteger(rpe) || rpe < 1 || rpe > 10)) {
    return null;
  }
  if (set.kind === "timed") {
    const durationSec = parseClock(set.duration);
    if (durationSec === null) {
      return null;
    }
    return { reps: null, weightLb, durationSec, distanceM: null, rpe, setType: set.setType };
  }
  if (set.kind === "distance") {
    const distanceM = parseDistanceInput(set.distance);
    if (distanceM === null) {
      return null;
    }
    const durationSec = set.duration.trim().length === 0 ? null : parseClock(set.duration);
    if (set.duration.trim().length > 0 && durationSec === null) {
      return null;
    }
    return { reps: null, weightLb, durationSec, distanceM, rpe, setType: set.setType };
  }
  const reps = parseReps(set.reps);
  if (reps === null) {
    return null;
  }
  return { reps, weightLb, durationSec: null, distanceM: null, rpe, setType: set.setType };
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

  return normalizeGeminiWorkout(payload.proposal);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
