import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { insertBodyEntry, type BodyWrite } from "./bodyEntries";
import { isClientId } from "./clientIds";
import { formatExerciseName } from "./exerciseName";
import { combineNotes, normalizeNote, type NormalizedSet } from "./measures";
import { announcedRecords, type PersonalRecord } from "./records";
import { plannedCompletedAt } from "./sessionTiming";
import { resolvedSetType, type SetType } from "./setType";
import { cleanSupersetId, mergeSupersetMembers, withStoredSuperset } from "./superset";
import {
  EXERCISE_RECORD_SCAN,
  MAX_SETS_PER_BATCH,
  getOrCreateExercise,
  getOwnedSession,
  loadRecentSetsForExercise,
  normalizeSetInput,
  recordPoint,
  storedSetFields,
} from "./workouts";

const EARLIEST_AT = Date.UTC(2000, 0, 1);
const FUTURE_SKEW_MS = 2 * 60 * 1000;
const MAX_REVISION = 1_000_000;

export type OfflineSetInput = {
  clientId: string;
  revision: number;
  removed: boolean;
  placement: "open" | "completed";
  sessionId?: Id<"sessions">;
  sessionClientId: string;
  sessionStartedAt: number;
  exerciseName: string;
  reps?: number;
  weightLb: number;
  durationSec?: number;
  distanceM?: number;
  calories?: number;
  rpe?: number;
  setType?: SetType;
  loggedAt: number;
  note?: string;
  /** Voice label for a superset. Omitted on sets logged by hand. */
  supersetId?: string;
};

export type OfflineEditInput = {
  editId: string;
  setId: Id<"sets">;
  reps?: number;
  weightLb: number;
  durationSec?: number;
  distanceM?: number;
  calories?: number;
  rpe?: number;
  setType?: SetType;
};

export type OfflineDeleteInput = {
  deleteId: string;
  setId: Id<"sets">;
};

export type OfflineBodyInput = BodyWrite & {
  clientId: string;
};

export type OfflineActionInput = {
  actionId: string;
  kind: "complete" | "discard" | "keepGoing";
  sessionId?: Id<"sessions">;
  sessionClientId: string;
  note?: string;
  requestedAt: number;
};

export type OfflineSetResult = {
  clientId: string;
  revision: number;
  status: "applied" | "rejected";
  setId: Id<"sets"> | null;
  sessionId: Id<"sessions"> | null;
  personalRecord: PersonalRecord | null;
  message: string | null;
};

export type OfflineEditResult = {
  editId: string;
  status: "applied" | "rejected";
  personalRecord: PersonalRecord | null;
  message: string | null;
};

export type OfflineDeleteResult = {
  deleteId: string;
  status: "applied" | "rejected";
  message: string | null;
};

export type OfflineActionResult = {
  actionId: string;
  status: "applied" | "rejected";
  sessionId: Id<"sessions"> | null;
  message: string | null;
};

export type OfflineBodyResult = {
  clientId: string;
  status: "applied" | "rejected";
  entryId: Id<"bodyEntries"> | null;
  message: string | null;
};

export type AcceptOfflineResult = {
  sets: OfflineSetResult[];
  edits: OfflineEditResult[];
  deletes: OfflineDeleteResult[];
  actions: OfflineActionResult[];
  body: OfflineBodyResult[];
};

function acceptedTime(value: number, now: number): number | null {
  if (!Number.isFinite(value) || value < EARLIEST_AT || value > now + FUTURE_SKEW_MS) {
    return null;
  }
  return Math.min(value, now);
}

function acceptedRevision(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= MAX_REVISION;
}

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return "That set could not be saved";
}

async function findByClientId(
  ctx: MutationCtx,
  userId: Id<"users">,
  clientId: string,
): Promise<Doc<"sets"> | null> {
  const matches = await ctx.db
    .query("sets")
    .withIndex("by_user_and_client_id", (q) =>
      q.eq("userId", userId).eq("clientId", clientId),
    )
    .take(1);
  return matches[0] ?? null;
}

async function sessionsForClientId(
  ctx: MutationCtx,
  userId: Id<"users">,
  clientId: string,
): Promise<Array<Doc<"sessions">>> {
  return await ctx.db
    .query("sessions")
    .withIndex("by_user_and_client_id", (q) =>
      q.eq("userId", userId).eq("clientId", clientId),
    )
    .take(8);
}

function preferSession(
  sessions: Array<Doc<"sessions">>,
  placement: "open" | "completed",
): Doc<"sessions"> | null {
  for (const session of sessions) {
    if (placement === "open" ? session.status === "open" : session.status === "completed") {
      return session;
    }
  }
  return null;
}

async function openSession(
  ctx: MutationCtx,
  userId: Id<"users">,
): Promise<Doc<"sessions"> | null> {
  return await ctx.db
    .query("sessions")
    .withIndex("by_user_status_and_started", (q) =>
      q.eq("userId", userId).eq("status", "open"),
    )
    .order("desc")
    .first();
}

async function newestLoggedAt(
  ctx: MutationCtx,
  sessionId: Id<"sessions">,
): Promise<number | null> {
  const sets = await ctx.db
    .query("sets")
    .withIndex("by_session_and_exercise", (q) => q.eq("sessionId", sessionId))
    .take(500);
  let newest: number | null = null;
  for (const set of sets) {
    if (newest === null || set.loggedAt > newest) {
      newest = set.loggedAt;
    }
  }
  return newest;
}

async function personalRecordForSet(
  ctx: MutationCtx,
  userId: Id<"users">,
  exerciseId: Id<"exercises">,
  exerciseName: string,
  setId: Id<"sets">,
  normalized: NormalizedSet,
  sessionId: Id<"sessions">,
): Promise<PersonalRecord | null> {
  const recent = await loadRecentSetsForExercise(ctx, userId, exerciseId);
  const previous = recent
    .filter((set) => set._id !== setId)
    .slice(0, EXERCISE_RECORD_SCAN)
    .map((set) => recordPoint(set));
  return announcedRecords(
    exerciseName,
    [recordPoint({ ...normalized, sessionId })],
    previous,
  ).headline;
}

function setDocument(
  existing: Doc<"sets">,
  exerciseId: Id<"exercises">,
  normalized: NormalizedSet,
  clientId: string | undefined,
  revision: number | undefined,
) {
  return {
    userId: existing.userId,
    sessionId: existing.sessionId,
    exerciseId,
    loggedAt: existing.loggedAt,
    ...(existing.order !== undefined ? { order: existing.order } : {}),
    ...storedSetFields(normalized),
    ...(clientId !== undefined ? { clientId } : {}),
    ...(revision !== undefined ? { clientRevision: revision } : {}),
  };
}

/**
 * Writes a phone's queued workout changes. Each set carries a client id, so
 * calling this again with the same id updates that set instead of inserting
 * another one.
 */
export async function acceptOfflineBatch(
  ctx: MutationCtx,
  userId: Id<"users">,
  args: {
    sets: OfflineSetInput[];
    edits: OfflineEditInput[];
    deletes: OfflineDeleteInput[];
    actions: OfflineActionInput[];
    body?: OfflineBodyInput[];
  },
  now = Date.now(),
): Promise<AcceptOfflineResult> {
  const body = args.body ?? [];
  const total =
    args.sets.length + args.edits.length + args.deletes.length + args.actions.length + body.length;
  if (total === 0) {
    throw new Error("Nothing to sync");
  }
  if (total > MAX_SETS_PER_BATCH) {
    throw new Error(`Log up to ${MAX_SETS_PER_BATCH} changes at a time`);
  }

  const setResults: OfflineSetResult[] = [];
  const notes = new Map<Id<"sessions">, string[]>();
  const createdSessions = new Map<Id<"sessions">, number>();
  const resolvedSessions = new Map<string, Id<"sessions">>();
  const supersetLabels = new Map<
    Id<"sessions">,
    Array<{ exerciseId: Id<"exercises">; supersetId: string }>
  >();

  function rememberSuperset(
    sessionId: Id<"sessions">,
    exerciseId: Id<"exercises">,
    label: string | undefined,
  ) {
    const supersetId = cleanSupersetId(label);
    if (!supersetId) {
      return;
    }
    const list = supersetLabels.get(sessionId) ?? [];
    list.push({ exerciseId, supersetId });
    supersetLabels.set(sessionId, list);
  }

  async function resolveSession(item: OfflineSetInput): Promise<Id<"sessions">> {
    const key = item.sessionId ?? `${item.placement}:${item.sessionClientId}`;
    const cached = resolvedSessions.get(key);
    if (cached) {
      return cached;
    }

    if (item.sessionId) {
      const owned = await getOwnedSession(ctx, userId, item.sessionId);
      if (!owned) {
        throw new Error("Workout not found");
      }
      resolvedSessions.set(key, owned._id);
      return owned._id;
    }

    if (!isClientId(item.sessionClientId)) {
      throw new Error("That set could not be saved");
    }

    const matches = await sessionsForClientId(ctx, userId, item.sessionClientId);
    const preferred = preferSession(matches, item.placement);
    if (preferred) {
      resolvedSessions.set(key, preferred._id);
      return preferred._id;
    }

    if (item.placement === "open") {
      const open = await openSession(ctx, userId);
      if (open) {
        if (!open.clientId) {
          await ctx.db.patch("sessions", open._id, { clientId: item.sessionClientId });
        }
        resolvedSessions.set(key, open._id);
        return open._id;
      }
    }

    const startedAt = acceptedTime(item.sessionStartedAt, now);
    if (startedAt === null) {
      throw new Error("That set's time is invalid");
    }
    const sessionId = await ctx.db.insert("sessions", {
      userId,
      status: item.placement === "completed" ? "completed" : "open",
      startedAt,
      ...(item.placement === "completed" ? { completedAt: startedAt } : {}),
      clientId: item.sessionClientId,
    });
    createdSessions.set(sessionId, startedAt);
    resolvedSessions.set(key, sessionId);
    return sessionId;
  }

  for (const item of args.sets) {
    try {
      if (!isClientId(item.clientId) || !acceptedRevision(item.revision)) {
        throw new Error("That set could not be saved");
      }
      const loggedAt = acceptedTime(item.loggedAt, now);
      if (loggedAt === null) {
        throw new Error("That set's time is invalid");
      }
      const normalized = normalizeSetInput(item);
      const formatted = formatExerciseName(item.exerciseName);
      if (!formatted) {
        throw new Error("Exercise name must be 1 to 80 characters");
      }

      const existing = await findByClientId(ctx, userId, item.clientId);
      if (item.removed) {
        if (existing) {
          await ctx.db.delete("sets", existing._id);
        }
        setResults.push({
          clientId: item.clientId,
          revision: item.revision,
          status: "applied",
          setId: null,
          sessionId: existing?.sessionId ?? null,
          personalRecord: null,
          message: null,
        });
        continue;
      }

      if (existing && (existing.clientRevision ?? 0) >= item.revision) {
        rememberSuperset(existing.sessionId, existing.exerciseId, item.supersetId);
        setResults.push({
          clientId: item.clientId,
          revision: item.revision,
          status: "applied",
          setId: existing._id,
          sessionId: existing.sessionId,
          personalRecord: null,
          message: null,
        });
        continue;
      }

      const sessionId = existing?.sessionId ?? (await resolveSession(item));
      const exerciseId = await getOrCreateExercise(ctx, userId, formatted.name);
      const exercise = await ctx.db.get("exercises", exerciseId);

      if (!existing) {
        const count = await ctx.db
          .query("sets")
          .withIndex("by_session_and_exercise", (q) => q.eq("sessionId", sessionId))
          .take(500);
        if (count.length >= 500) {
          throw new Error("This workout already has 500 sets");
        }
        const setId = await ctx.db.insert("sets", {
          userId,
          sessionId,
          exerciseId,
          loggedAt,
          ...storedSetFields(normalized),
          clientId: item.clientId,
          clientRevision: item.revision,
        });
        const createdStart = createdSessions.get(sessionId);
        if (createdStart !== undefined && loggedAt < createdStart) {
          createdSessions.set(sessionId, loggedAt);
        }
        const personalRecord = await personalRecordForSet(
          ctx,
          userId,
          exerciseId,
          exercise?.name ?? formatted.name,
          setId,
          normalized,
          sessionId,
        );
        if (item.note) {
          const list = notes.get(sessionId) ?? [];
          list.push(item.note);
          notes.set(sessionId, list);
        }
        rememberSuperset(sessionId, exerciseId, item.supersetId);
        setResults.push({
          clientId: item.clientId,
          revision: item.revision,
          status: "applied",
          setId,
          sessionId,
          personalRecord,
          message: null,
        });
        continue;
      }

      await ctx.db.replace(
        "sets",
        existing._id,
        setDocument(existing, exerciseId, normalized, item.clientId, item.revision),
      );
      rememberSuperset(existing.sessionId, exerciseId, item.supersetId);
      const personalRecord = await personalRecordForSet(
        ctx,
        userId,
        exerciseId,
        exercise?.name ?? formatted.name,
        existing._id,
        normalized,
        existing.sessionId,
      );
      setResults.push({
        clientId: item.clientId,
        revision: item.revision,
        status: "applied",
        setId: existing._id,
        sessionId: existing.sessionId,
        personalRecord,
        message: null,
      });
    } catch (error) {
      setResults.push({
        clientId: item.clientId,
        revision: item.revision,
        status: "rejected",
        setId: null,
        sessionId: null,
        personalRecord: null,
        message: messageOf(error),
      });
    }
  }

  for (const [sessionId, labels] of supersetLabels) {
    const session = await ctx.db.get("sessions", sessionId);
    if (!session || session.userId !== userId) {
      continue;
    }
    const merged = mergeSupersetMembers(session.plan ?? [], labels, (exerciseId) => ({
      exerciseId,
    }));
    const stored = withStoredSuperset(merged);
    await ctx.db.patch("sessions", sessionId, { plan: stored });
  }

  for (const [sessionId, startedAt] of createdSessions) {
    const session = await ctx.db.get("sessions", sessionId);
    if (!session || session.startedAt === startedAt) {
      continue;
    }
    await ctx.db.patch("sessions", sessionId, {
      startedAt,
      ...(session.status === "completed" ? { completedAt: startedAt } : {}),
    });
  }

  for (const [sessionId, pendingNotes] of notes) {
    const session = await ctx.db.get("sessions", sessionId);
    if (!session) {
      continue;
    }
    let note = session.note;
    for (const raw of pendingNotes) {
      try {
        note = combineNotes(note, normalizeNote(raw));
      } catch {
        // The sets are already stored. A note that does not fit is left off.
      }
    }
    if (note !== session.note) {
      await ctx.db.patch("sessions", sessionId, { note });
    }
  }

  for (const sessionId of createdSessions.keys()) {
    const anySet = await ctx.db
      .query("sets")
      .withIndex("by_session_and_exercise", (q) => q.eq("sessionId", sessionId))
      .take(1);
    if (anySet.length > 0) {
      continue;
    }
    const session = await ctx.db.get("sessions", sessionId);
    if (session && session.note === undefined) {
      await ctx.db.delete("sessions", sessionId);
    }
  }

  const editResults: OfflineEditResult[] = [];
  for (const item of args.edits) {
    try {
      if (!isClientId(item.editId)) {
        throw new Error("That edit could not be saved");
      }
      const set = await ctx.db.get("sets", item.setId);
      if (!set || set.userId !== userId) {
        throw new Error("Set not found");
      }
      const normalized = normalizeSetInput({
        ...item,
        setType: item.setType ?? resolvedSetType(set.setType),
      });
      const exercise = await ctx.db.get("exercises", set.exerciseId);
      await ctx.db.replace(
        "sets",
        set._id,
        setDocument(set, set.exerciseId, normalized, set.clientId, set.clientRevision),
      );
      const personalRecord = await personalRecordForSet(
        ctx,
        userId,
        set.exerciseId,
        exercise?.name ?? "Exercise",
        set._id,
        normalized,
        set.sessionId,
      );
      editResults.push({
        editId: item.editId,
        status: "applied",
        personalRecord,
        message: null,
      });
    } catch (error) {
      editResults.push({
        editId: item.editId,
        status: "rejected",
        personalRecord: null,
        message: messageOf(error),
      });
    }
  }

  const deleteResults: OfflineDeleteResult[] = [];
  for (const item of args.deletes) {
    try {
      if (!isClientId(item.deleteId)) {
        throw new Error("That set could not be removed");
      }
      const set = await ctx.db.get("sets", item.setId);
      if (!set || set.userId !== userId) {
        deleteResults.push({
          deleteId: item.deleteId,
          status: "applied",
          message: null,
        });
        continue;
      }
      await ctx.db.delete("sets", set._id);
      deleteResults.push({
        deleteId: item.deleteId,
        status: "applied",
        message: null,
      });
    } catch (error) {
      deleteResults.push({
        deleteId: item.deleteId,
        status: "rejected",
        message: messageOf(error),
      });
    }
  }

  const actionResults: OfflineActionResult[] = [];
  for (const item of args.actions) {
    try {
      if (!isClientId(item.actionId) || !isClientId(item.sessionClientId)) {
        throw new Error("That workout could not be saved");
      }
      let session: Doc<"sessions"> | null = null;
      if (item.sessionId) {
        session = await getOwnedSession(ctx, userId, item.sessionId);
        if (!session) {
          throw new Error("Workout not found");
        }
      } else {
        const matches = await sessionsForClientId(ctx, userId, item.sessionClientId);
        session =
          matches.find((candidate) => candidate.status === "open") ??
          matches.find((candidate) => candidate.status === "completed") ??
          null;
      }

      if (!session) {
        actionResults.push({
          actionId: item.actionId,
          status: "applied",
          sessionId: null,
          message: null,
        });
        continue;
      }

      if (item.kind === "keepGoing") {
        if (session.status === "open") {
          await ctx.db.patch("sessions", session._id, { resumedAt: now });
        }
        actionResults.push({
          actionId: item.actionId,
          status: "applied",
          sessionId: session._id,
          message: null,
        });
        continue;
      }

      if (item.kind === "discard") {
        if (session.status !== "open") {
          actionResults.push({
            actionId: item.actionId,
            status: "applied",
            sessionId: session._id,
            message: null,
          });
          continue;
        }
        const existing = await ctx.db
          .query("sets")
          .withIndex("by_session_and_exercise", (q) => q.eq("sessionId", session._id))
          .take(1);
        if (existing.length > 0) {
          throw new Error("This workout has sets. Finish it instead");
        }
        await ctx.db.delete("sessions", session._id);
        actionResults.push({
          actionId: item.actionId,
          status: "applied",
          sessionId: null,
          message: null,
        });
        continue;
      }

      if (session.status === "completed") {
        actionResults.push({
          actionId: item.actionId,
          status: "applied",
          sessionId: session._id,
          message: null,
        });
        continue;
      }
      const lastSetAt = await newestLoggedAt(ctx, session._id);
      if (lastSetAt === null) {
        throw new Error("Log at least one set before finishing");
      }
      const requested = acceptedTime(item.requestedAt, now);
      const explicit =
        requested !== null && requested >= session.startedAt && requested >= lastSetAt
          ? requested
          : undefined;
      const completedAt = plannedCompletedAt({
        now,
        startedAt: session.startedAt,
        lastSetAt,
        explicit,
      });
      const note = item.note === undefined ? session.note : normalizeNote(item.note);
      await ctx.db.patch("sessions", session._id, {
        status: "completed",
        completedAt,
        note,
      });
      actionResults.push({
        actionId: item.actionId,
        status: "applied",
        sessionId: session._id,
        message: null,
      });
    } catch (error) {
      actionResults.push({
        actionId: item.actionId,
        status: "rejected",
        sessionId: null,
        message: messageOf(error),
      });
    }
  }

  const bodyResults: OfflineBodyResult[] = [];
  for (const item of body) {
    try {
      const entryId = await insertBodyEntry(ctx, userId, item, now);
      bodyResults.push({
        clientId: item.clientId,
        status: "applied",
        entryId,
        message: null,
      });
    } catch (error) {
      bodyResults.push({
        clientId: item.clientId,
        status: "rejected",
        entryId: null,
        message: messageOf(error),
      });
    }
  }

  return {
    sets: setResults,
    edits: editResults,
    deletes: deleteResults,
    actions: actionResults,
    body: bodyResults,
  };
}
