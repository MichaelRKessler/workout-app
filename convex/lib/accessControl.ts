import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { requireUserId } from "./auth";

/**
 * The only admin, and always allowed. Compared after trim and lowercase.
 * This is a server constant so the client cannot nominate an admin.
 */
export const ADMIN_EMAIL = "michaelr.kessler@gmail.com";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NOTE_LIMIT = 280;
const LIST_LIMIT = 200;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function parseEmail(raw: string): string {
  const email = normalizeEmail(raw);
  if (email.length === 0 || email.length > 320 || !EMAIL_PATTERN.test(email)) {
    throw new Error("Enter a valid email address");
  }
  return email;
}

export function parseNote(raw: string | undefined): string | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const note = raw.trim();
  if (note.length === 0) {
    return undefined;
  }
  if (note.length > NOTE_LIMIT) {
    throw new Error("Note must be 280 characters or less");
  }
  return note;
}

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) {
    return false;
  }
  return normalizeEmail(email) === ADMIN_EMAIL;
}

type Reader = QueryCtx | MutationCtx;

export async function isEmailAllowed(ctx: Reader, email: string): Promise<boolean> {
  const normalized = normalizeEmail(email);
  if (normalized.length === 0) {
    return false;
  }
  if (normalized === ADMIN_EMAIL) {
    return true;
  }
  const row = await ctx.db
    .query("allowedEmails")
    .withIndex("by_email", (q) => q.eq("email", normalized))
    .unique();
  return row !== null;
}

export async function requireAllowedUser(ctx: Reader): Promise<{
  userId: Id<"users">;
  email: string;
  isAdmin: boolean;
}> {
  const userId = await requireUserId(ctx);
  const user = await ctx.db.get("users", userId);
  const email = user?.email ? normalizeEmail(user.email) : null;
  if (!email || !(await isEmailAllowed(ctx, email))) {
    throw new Error("You don't have access yet");
  }
  return {
    userId,
    email,
    isAdmin: email === ADMIN_EMAIL,
  };
}

export async function requireAdmin(ctx: Reader): Promise<{
  userId: Id<"users">;
  email: string;
  isAdmin: true;
}> {
  const access = await requireAllowedUser(ctx);
  if (!access.isAdmin) {
    throw new Error("Admin access required");
  }
  return { userId: access.userId, email: access.email, isAdmin: true };
}

export async function upsertAllowedEmail(ctx: MutationCtx, email: string): Promise<void> {
  const normalized = normalizeEmail(email);
  const existing = await ctx.db
    .query("allowedEmails")
    .withIndex("by_email", (q) => q.eq("email", normalized))
    .unique();
  if (existing) {
    return;
  }
  await ctx.db.insert("allowedEmails", {
    email: normalized,
    createdAt: Date.now(),
  });
}

async function pendingForEmail(ctx: Reader, email: string) {
  return await ctx.db
    .query("accessRequests")
    .withIndex("by_email_and_status", (q) =>
      q.eq("email", email).eq("status", "pending"),
    )
    .take(8);
}

/** Adds the email and closes any pending requests for it. */
export async function grantEmail(ctx: MutationCtx, email: string): Promise<void> {
  const normalized = normalizeEmail(email);
  await upsertAllowedEmail(ctx, normalized);
  const pending = await pendingForEmail(ctx, normalized);
  const resolvedAt = Date.now();
  for (const request of pending) {
    await ctx.db.patch("accessRequests", request._id, {
      status: "approved",
      resolvedAt,
    });
  }
}

export async function removeAllowedEmail(ctx: MutationCtx, rawEmail: string): Promise<void> {
  const email = parseEmail(rawEmail);
  if (email === ADMIN_EMAIL) {
    throw new Error("The admin email cannot be removed");
  }
  const row = await ctx.db
    .query("allowedEmails")
    .withIndex("by_email", (q) => q.eq("email", email))
    .unique();
  if (!row) {
    throw new Error("That email is not on the allow list");
  }
  await ctx.db.delete("allowedEmails", row._id);
}

const REQUEST_STATUSES = ["pending", "approved", "denied"] as const;

async function latestRequest(ctx: Reader, email: string) {
  const newest = await Promise.all(
    REQUEST_STATUSES.map(async (status) => {
      return await ctx.db
        .query("accessRequests")
        .withIndex("by_email_and_status", (q) =>
          q.eq("email", email).eq("status", status),
        )
        .order("desc")
        .first();
    }),
  );
  return newest.reduce<(typeof newest)[number]>((latest, request) => {
    if (!request) {
      return latest;
    }
    if (!latest || request.createdAt > latest.createdAt) {
      return request;
    }
    return latest;
  }, null);
}

export async function accessStatus(
  ctx: Reader,
  viewer: { email: string | null; name: string | null },
) {
  const email = viewer.email ? normalizeEmail(viewer.email) : null;
  const allowed = email !== null && (await isEmailAllowed(ctx, email));
  const latest = email ? await latestRequest(ctx, email) : null;

  return {
    email,
    name: viewer.name,
    allowed,
    isAdmin: email === ADMIN_EMAIL,
    request: latest
      ? {
          status: latest.status,
          note: latest.note ?? null,
        }
      : null,
  };
}

export async function createAccessRequest(
  ctx: MutationCtx,
  email: string | null,
  rawNote: string | undefined,
): Promise<{ status: "pending"; alreadyRequested: boolean }> {
  if (!email) {
    throw new Error("Your Google account has no email address");
  }
  const normalized = normalizeEmail(email);
  if (await isEmailAllowed(ctx, normalized)) {
    throw new Error("You already have access");
  }
  const note = parseNote(rawNote);
  const pending = await pendingForEmail(ctx, normalized);
  if (pending.length > 0) {
    return { status: "pending", alreadyRequested: true };
  }
  await ctx.db.insert("accessRequests", {
    email: normalized,
    ...(note ? { note } : {}),
    status: "pending",
    createdAt: Date.now(),
  });
  return { status: "pending", alreadyRequested: false };
}

export async function approveRequest(
  ctx: MutationCtx,
  requestId: Id<"accessRequests">,
): Promise<void> {
  const request = await ctx.db.get("accessRequests", requestId);
  if (!request || request.status !== "pending") {
    throw new Error("This request is no longer pending");
  }
  await grantEmail(ctx, request.email);
}

export async function denyRequest(
  ctx: MutationCtx,
  requestId: Id<"accessRequests">,
): Promise<void> {
  const request = await ctx.db.get("accessRequests", requestId);
  if (!request || request.status !== "pending") {
    throw new Error("This request is no longer pending");
  }
  await ctx.db.patch("accessRequests", request._id, {
    status: "denied",
    resolvedAt: Date.now(),
  });
}

export async function listAllowedEmails(ctx: Reader) {
  const rows = await ctx.db
    .query("allowedEmails")
    .withIndex("by_created")
    .order("desc")
    .take(LIST_LIMIT);
  const emails = new Set(rows.map((row) => row.email));
  emails.add(ADMIN_EMAIL);
  return [...emails]
    .sort((left, right) => left.localeCompare(right))
    .map((email) => ({
      email,
      isAdmin: email === ADMIN_EMAIL,
    }));
}

export async function listPendingRequests(ctx: Reader) {
  const rows = await ctx.db
    .query("accessRequests")
    .withIndex("by_status", (q) => q.eq("status", "pending"))
    .order("desc")
    .take(LIST_LIMIT);
  return rows.map((row) => ({
    _id: row._id,
    email: row.email,
    note: row.note ?? null,
    createdAt: row.createdAt,
  }));
}

/** Seeds the admin and records the allow-list decision for this sign-in. */
export async function recordSignInAccess(
  ctx: MutationCtx,
  args: { userId: Id<"users">; email: string | null },
): Promise<{ allowed: boolean }> {
  await upsertAllowedEmail(ctx, ADMIN_EMAIL);
  const email = args.email ? normalizeEmail(args.email) : null;
  const allowed = email !== null && (await isEmailAllowed(ctx, email));
  const existing = await ctx.db
    .query("signInFlags")
    .withIndex("by_user", (q) => q.eq("userId", args.userId))
    .unique();
  if (existing) {
    await ctx.db.patch("signInFlags", existing._id, {
      email,
      allowed,
      updatedAt: Date.now(),
    });
  } else {
    await ctx.db.insert("signInFlags", {
      userId: args.userId,
      email,
      allowed,
      updatedAt: Date.now(),
    });
  }
  return { allowed };
}
