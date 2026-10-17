import {
  fromCentimeters,
  toCentimeters,
  type LengthUnit,
} from "../convex/lib/bodyMeasures.ts";
import { normalizeNote } from "../convex/lib/measures.ts";
import { formatBodyWeightAmount, fromPounds, parseDisplayWeight, toPounds, type WeightUnit } from "../convex/lib/units.ts";
import type { BodyProposal } from "./voice/bodyProposal.ts";
import { formatDateInput, loggedAtFromDateInput, shiftDateInput } from "./bodyDate.ts";

export type BodyDraft = {
  date: string;
  weight: string;
  bodyFat: string;
  waist: string;
  chest: string;
  arm: string;
  hips: string;
  thigh: string;
  note: string;
};

export type BodySave = {
  loggedAt: number;
  weightLb?: number;
  bodyFatPct?: number;
  waistCm?: number;
  chestCm?: number;
  armCm?: number;
  hipsCm?: number;
  thighCm?: number;
  note?: string;
};

export function emptyBodyDraft(now = Date.now()): BodyDraft {
  return {
    date: formatDateInput(now),
    weight: "",
    bodyFat: "",
    waist: "",
    chest: "",
    arm: "",
    hips: "",
    thigh: "",
    note: "",
  };
}

export function draftFromProposal(
  proposal: BodyProposal,
  weightUnit: WeightUnit,
  lengthUnit: LengthUnit,
  now = Date.now(),
): BodyDraft {
  return {
    date: shiftDateInput(proposal.dayOffset, now),
    weight: proposal.weightLb === null ? "" : amount(fromPounds(proposal.weightLb, weightUnit)),
    bodyFat: proposal.bodyFatPct === null ? "" : amount(proposal.bodyFatPct),
    waist: proposal.waistCm === null ? "" : amount(fromCentimeters(proposal.waistCm, lengthUnit)),
    chest: proposal.chestCm === null ? "" : amount(fromCentimeters(proposal.chestCm, lengthUnit)),
    arm: proposal.armCm === null ? "" : amount(fromCentimeters(proposal.armCm, lengthUnit)),
    hips: proposal.hipsCm === null ? "" : amount(fromCentimeters(proposal.hipsCm, lengthUnit)),
    thigh: proposal.thighCm === null ? "" : amount(fromCentimeters(proposal.thighCm, lengthUnit)),
    note: proposal.note ?? "",
  };
}

export function draftFromStored(
  entry: {
    loggedAt: number;
    weightLb: number | null;
    bodyFatPct: number | null;
    waistCm: number | null;
    chestCm: number | null;
    armCm: number | null;
    hipsCm: number | null;
    thighCm: number | null;
    note: string | null;
  },
  weightUnit: WeightUnit,
  lengthUnit: LengthUnit,
): BodyDraft {
  return {
    date: formatDateInput(entry.loggedAt),
    weight: entry.weightLb === null ? "" : amount(fromPounds(entry.weightLb, weightUnit)),
    bodyFat: entry.bodyFatPct === null ? "" : amount(entry.bodyFatPct),
    waist: entry.waistCm === null ? "" : amount(fromCentimeters(entry.waistCm, lengthUnit)),
    chest: entry.chestCm === null ? "" : amount(fromCentimeters(entry.chestCm, lengthUnit)),
    arm: entry.armCm === null ? "" : amount(fromCentimeters(entry.armCm, lengthUnit)),
    hips: entry.hipsCm === null ? "" : amount(fromCentimeters(entry.hipsCm, lengthUnit)),
    thigh: entry.thighCm === null ? "" : amount(fromCentimeters(entry.thighCm, lengthUnit)),
    note: entry.note ?? "",
  };
}

/** Display-unit fields become pounds and centimeters, or an error to show. */
export function measuresFromDraft(
  draft: BodyDraft,
  weightUnit: WeightUnit,
  lengthUnit: LengthUnit,
  now = Date.now(),
): { ok: true; save: BodySave } | { ok: false; error: string } {
  const loggedAt = loggedAtFromDateInput(draft.date, now);
  if (loggedAt === null) {
    return { ok: false, error: "Pick today or an earlier date." };
  }
  const weight = optionalWeight(draft.weight, weightUnit);
  if (!weight.ok) {
    return weight;
  }
  const bodyFat = optionalFat(draft.bodyFat);
  if (!bodyFat.ok) {
    return bodyFat;
  }
  const waist = optionalLength(draft.waist, lengthUnit, "Waist");
  if (!waist.ok) {
    return waist;
  }
  const chest = optionalLength(draft.chest, lengthUnit, "Chest");
  if (!chest.ok) {
    return chest;
  }
  const arm = optionalLength(draft.arm, lengthUnit, "Arm");
  if (!arm.ok) {
    return arm;
  }
  const hips = optionalLength(draft.hips, lengthUnit, "Hips");
  if (!hips.ok) {
    return hips;
  }
  const thigh = optionalLength(draft.thigh, lengthUnit, "Thigh");
  if (!thigh.ok) {
    return thigh;
  }
  let note: string | undefined;
  try {
    note = normalizeNote(draft.note);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "That note is too long." };
  }
  if (
    weight.value === undefined &&
    bodyFat.value === undefined &&
    waist.value === undefined &&
    chest.value === undefined &&
    arm.value === undefined &&
    hips.value === undefined &&
    thigh.value === undefined
  ) {
    return { ok: false, error: "Add a weight or a measurement." };
  }
  return {
    ok: true,
    save: {
      loggedAt,
      ...(weight.value !== undefined ? { weightLb: weight.value } : {}),
      ...(bodyFat.value !== undefined ? { bodyFatPct: bodyFat.value } : {}),
      ...(waist.value !== undefined ? { waistCm: waist.value } : {}),
      ...(chest.value !== undefined ? { chestCm: chest.value } : {}),
      ...(arm.value !== undefined ? { armCm: arm.value } : {}),
      ...(hips.value !== undefined ? { hipsCm: hips.value } : {}),
      ...(thigh.value !== undefined ? { thighCm: thigh.value } : {}),
      ...(note !== undefined ? { note } : {}),
    },
  };
}

/** A weight as the form shows it, used as the hint in an empty weight field. */
export function weightHint(weightLb: number | null | undefined, unit: WeightUnit): string | undefined {
  return weightLb == null ? undefined : amount(fromPounds(weightLb, unit));
}

function amount(value: number): string {
  return String(value);
}

function optionalWeight(
  value: string,
  unit: WeightUnit,
): { ok: true; value: number | undefined } | { ok: false; error: string } {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return { ok: true, value: undefined };
  }
  const parsed = parseDisplayWeight(trimmed, unit);
  if (parsed === null || parsed <= 0) {
    return { ok: false, error: `Enter a weight in ${unit}.` };
  }
  const pounds = toPounds(parsed, unit);
  if (pounds < 1 || pounds > 2000) {
    return { ok: false, error: "Weight must be between 1 and 2000 lb." };
  }
  return { ok: true, value: pounds };
}

function optionalFat(
  value: string,
): { ok: true; value: number | undefined } | { ok: false; error: string } {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return { ok: true, value: undefined };
  }
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
    return { ok: false, error: "Body fat is a percent from 1 to 80." };
  }
  const parsed = Number(trimmed);
  if (parsed < 1 || parsed > 80) {
    return { ok: false, error: "Body fat is a percent from 1 to 80." };
  }
  return { ok: true, value: Math.round(parsed * 100) / 100 };
}

function optionalLength(
  value: string,
  unit: LengthUnit,
  label: string,
): { ok: true; value: number | undefined } | { ok: false; error: string } {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return { ok: true, value: undefined };
  }
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
    return { ok: false, error: `${label} needs a number in ${unit}.` };
  }
  const parsed = Number(trimmed);
  const cm = toCentimeters(parsed, unit);
  if (cm < 1 || cm > 300) {
    return { ok: false, error: `${label} is outside the range this log accepts.` };
  }
  return { ok: true, value: cm };
}

export function formatBodySummary(
  entry: {
    weightLb: number | null;
    bodyFatPct: number | null;
    waistCm: number | null;
    chestCm: number | null;
    armCm: number | null;
    hipsCm: number | null;
    thighCm: number | null;
  },
  weightUnit: WeightUnit,
  lengthUnit: LengthUnit,
): string {
  const parts: string[] = [];
  if (entry.weightLb !== null) {
    parts.push(`${formatBodyWeightAmount(entry.weightLb, weightUnit)} ${weightUnit}`);
  }
  if (entry.bodyFatPct !== null) {
    parts.push(`${amount(entry.bodyFatPct)}% fat`);
  }
  const lengths: Array<[string, number | null]> = [
    ["waist", entry.waistCm],
    ["chest", entry.chestCm],
    ["arm", entry.armCm],
    ["hips", entry.hipsCm],
    ["thigh", entry.thighCm],
  ];
  for (const [label, cm] of lengths) {
    if (cm !== null) {
      // A tenth is as fine as a tape measure reads; cm-to-inch conversion leaves noise past that.
      parts.push(`${label} ${amount(Math.round(fromCentimeters(cm, lengthUnit) * 10) / 10)} ${lengthUnit}`);
    }
  }
  return parts.join(" · ");
}
