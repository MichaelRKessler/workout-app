import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { isClientId } from "./clientIds";
import {
  acceptedLoggedAt,
  normalizeBodyMeasures,
  type BodyMeasureInput,
  type StoredBodyMeasures,
} from "./bodyMeasures";
import { normalizeNote } from "./measures";

export const BODY_TREND_SCAN = 400;

export type BodyWrite = BodyMeasureInput & {
  loggedAt: number;
  note?: string | null;
  clientId?: string;
};

export function presentBodyEntry(entry: Doc<"bodyEntries">) {
  return {
    _id: entry._id,
    loggedAt: entry.loggedAt,
    weightLb: entry.weightLb ?? null,
    bodyFatPct: entry.bodyFatPct ?? null,
    waistCm: entry.waistCm ?? null,
    chestCm: entry.chestCm ?? null,
    armCm: entry.armCm ?? null,
    hipsCm: entry.hipsCm ?? null,
    thighCm: entry.thighCm ?? null,
    note: entry.note ?? null,
    clientId: entry.clientId ?? null,
  };
}

async function findByClientId(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  clientId: string,
): Promise<Doc<"bodyEntries"> | null> {
  const matches = await ctx.db
    .query("bodyEntries")
    .withIndex("by_user_and_client_id", (q) => q.eq("userId", userId).eq("clientId", clientId))
    .take(1);
  return matches[0] ?? null;
}

function storedDocument(
  userId: Id<"users">,
  loggedAt: number,
  measures: StoredBodyMeasures,
  note: string | undefined,
  clientId: string | undefined,
) {
  return {
    userId,
    loggedAt,
    ...measures,
    ...(note !== undefined ? { note } : {}),
    ...(clientId !== undefined ? { clientId } : {}),
  };
}

/**
 * Inserts one body entry. The same client id for this user returns the
 * existing row, so a phone retry cannot log the weight twice.
 */
export async function insertBodyEntry(
  ctx: MutationCtx,
  userId: Id<"users">,
  input: BodyWrite,
  now = Date.now(),
): Promise<Id<"bodyEntries">> {
  let clientId: string | undefined;
  if (input.clientId !== undefined) {
    if (!isClientId(input.clientId)) {
      throw new Error("That entry could not be saved");
    }
    clientId = input.clientId;
    const existing = await findByClientId(ctx, userId, clientId);
    if (existing) {
      if (existing.userId !== userId) {
        throw new Error("Entry not found");
      }
      return existing._id;
    }
  }
  const loggedAt = acceptedLoggedAt(input.loggedAt, now);
  if (loggedAt === null) {
    throw new Error("That date is invalid");
  }
  const measures = normalizeBodyMeasures(input);
  const note = normalizeNote(input.note);
  return await ctx.db.insert(
    "bodyEntries",
    storedDocument(userId, loggedAt, measures, note, clientId),
  );
}

export async function updateBodyEntry(
  ctx: MutationCtx,
  userId: Id<"users">,
  entryId: Id<"bodyEntries">,
  input: BodyWrite,
  now = Date.now(),
): Promise<void> {
  const entry = await ctx.db.get("bodyEntries", entryId);
  if (!entry || entry.userId !== userId) {
    throw new Error("Entry not found");
  }
  const loggedAt = acceptedLoggedAt(input.loggedAt, now);
  if (loggedAt === null) {
    throw new Error("That date is invalid");
  }
  const measures = normalizeBodyMeasures(input);
  const note = normalizeNote(input.note);
  await ctx.db.replace(
    "bodyEntries",
    entry._id,
    storedDocument(userId, loggedAt, measures, note, entry.clientId),
  );
}

export async function removeBodyEntry(
  ctx: MutationCtx,
  userId: Id<"users">,
  entryId: Id<"bodyEntries">,
): Promise<void> {
  const entry = await ctx.db.get("bodyEntries", entryId);
  if (!entry || entry.userId !== userId) {
    throw new Error("Entry not found");
  }
  await ctx.db.delete("bodyEntries", entry._id);
}
