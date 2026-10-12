import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { insertBodyEntry, type BodyWrite } from "./bodyEntries";
import { clampToWindow, correctClientTime, requestOffsetMs } from "./clockSkew";
import { isClientId } from "./clientIds";
import { formatExerciseName } from "./exerciseName";
import { combineNotes, normalizeNote, type NormalizedSet } from "./measures";
import {
  invalidateExercises,
  recordEditedSet,
  recordInsertedSets,
  recordRemovedSets,
} from "./exerciseStats";
import { announcedRecords, type PersonalRecord } from "./records";
import { newestLoggedAt, noteSetsRemoved } from "./sessionActivity";
import { plannedCompletedAt } from "./sessionTiming";
import { resolvedSetType, type SetType } from "./setType";
import { cleanSupersetId, mergeSupersetMembers, withStoredSuperset } from "./superset";
import { userError } from "./errors";
import {
  MAX_SETS_PER_BATCH,
  getOrCreateExercise,
  loadSetsBefore,
  normalizeSetInput,
  recordPoint,
  storedSetFields,
} from "./workouts";

const MAX_REVISION = 1_000_000;
const SAME_START_MS = 60_000;

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
  status: "applied" | "rejected" | "removed";
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
  serverNow: number;
};

function acceptedTime(value: number, offsetMs: number, now: number): number | null {
  return correctClientTime(value, offsetMs, now);
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
    .order("desc")
    .take(32);
}

async function findRemoval(
  ctx: MutationCtx,
  userId: Id<"users">,
  clientId: string,
): Promise<Doc<"removedClientIds"> | null> {
  const matches = await ctx.db
    .query("removedClientIds")
    .withIndex("by_user_and_client_id", (q) =>
      q.eq("userId", userId).eq("clientId", clientId),
    )
    .take(1);
  return matches[0] ?? null;
}

async function rememberRemoval(
  ctx: MutationCtx,
  userId: Id<"users">,
  clientId: string,
  now: number,
): Promise<void> {
  if (!isClientId(clientId)) {
    return;
  }
  const existing = await findRemoval(ctx, userId, clientId);
  if (existing) {
    return;
  }
  await ctx.db.insert("removedClientIds", {
    userId,
    clientId,
    removedAt: now,
  });
}

/**
 * Whether a finished workout already saved under this client id is the one
 * being sent. The phone's own start time does not change between batches, so
 * it is compared when the session kept it. Older sessions compare the
 * corrected start, which moves with each batch's clock reading.
 */
function samePastWorkout(
  session: Doc<"sessions">,
  clientStartedAt: number,
  startedAt: number,
): boolean {
  if (session.status !== "completed") {
    return false;
  }
  if (session.clientStartedAt !== undefined) {
    return Math.abs(session.clientStartedAt - clientStartedAt) <= SAME_START_MS;
  }
  return Math.abs(session.startedAt - startedAt) <= SAME_START_MS;
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

async function movedSetRecord(
  ctx: MutationCtx,
  userId: Id<"users">,
  fromId: Id<"exercises">,
  intoId: Id<"exercises">,
  exerciseName: string,
  loggedAt: number,
  normalized: NormalizedSet,
  sessionId: Id<"sessions">,
): Promise<PersonalRecord | null> {
  await invalidateExercises(ctx, userId, [fromId, intoId]);
  const earlier = await loadSetsBefore(ctx, userId, intoId, loggedAt);
  const previous = earlier
    .filter((set) => set.userId === userId && set.exerciseId === intoId)
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

async function saveFinishOnCompleted(
  ctx: MutationCtx,
  userId: Id<"users">,
  session: Doc<"sessions">,
  item: OfflineActionInput,
  offsetMs: number,
  now: number,
): Promise<void> {
  if (session.userId !== userId || item.kind !== "complete") {
    return;
  }
  const patch: { note?: string; completedAt?: number } = {};
  if (item.note !== undefined) {
    try {
      patch.note = normalizeNote(item.note);
    } catch {
      // The finish still applies. A note that does not fit is left off.
    }
  }
  const requested = acceptedTime(item.requestedAt, offsetMs, now);
  const lastSetAt = await newestLoggedAt(ctx, session);
  if (
    requested !== null &&
    lastSetAt !== null &&
    requested >= session.startedAt &&
    requested >= lastSetAt
  ) {
    patch.completedAt = requested;
  }
  if (patch.note !== undefined || patch.completedAt !== undefined) {
    await ctx.db.patch("sessions", session._id, patch);
  }
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
    clientNow?: number;
    clockOffsetMs?: number;
  },
  now = Date.now(),
): Promise<AcceptOfflineResult> {
  const offsetMs = requestOffsetMs(args, now);
  const body = args.body ?? [];
  const total =
    args.sets.length + args.edits.length + args.deletes.length + args.actions.length + body.length;
  if (total === 0) {
    throw userError("Nothing to sync");
  }
  if (total > MAX_SETS_PER_BATCH) {
    throw userError(`Log up to ${MAX_SETS_PER_BATCH} changes at a time`);
  }

  const setResults: OfflineSetResult[] = [];
  const notes = new Map<Id<"sessions">, string[]>();
  const createdSessions = new Map<Id<"sessions">, number>();
  const resolvedSessions = new Map<string, Id<"sessions">>();
  const resolvedByClient = new Map<string, Id<"sessions">>();
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

  function rememberSession(key: string, sessionClientId: string, sessionId: Id<"sessions">) {
    resolvedSessions.set(key, sessionId);
    if (isClientId(sessionClientId)) {
      resolvedByClient.set(sessionClientId, sessionId);
    }
  }

  async function resolveSession(item: OfflineSetInput): Promise<Id<"sessions">> {
    const key = `${item.placement}:${item.sessionClientId}:${item.sessionId ?? ""}`;
    const cached = resolvedSessions.get(key);
    if (cached) {
      return cached;
    }

    let missingRequested = false;
    if (item.sessionId) {
      const row = await ctx.db.get("sessions", item.sessionId);
      if (row && row.userId === userId) {
        rememberSession(key, item.sessionClientId, row._id);
        return row._id;
      }
      if (row && row.userId !== userId) {
        throw userError("Workout not found");
      }
      missingRequested = true;
    }

    const startedAt = acceptedTime(item.sessionStartedAt, offsetMs, now);
    if (startedAt === null) {
      throw userError("That set's time is invalid");
    }

    if (isClientId(item.sessionClientId)) {
      const matches = await sessionsForClientId(ctx, userId, item.sessionClientId);
      if (item.placement === "completed") {
        const same = matches.find((session) =>
          samePastWorkout(session, item.sessionStartedAt, startedAt),
        );
        if (same) {
          rememberSession(key, item.sessionClientId, same._id);
          return same._id;
        }
      } else {
        const openMatch = matches.find((session) => session.status === "open");
        if (openMatch) {
          rememberSession(key, item.sessionClientId, openMatch._id);
          return openMatch._id;
        }
      }
    } else if (!item.sessionId) {
      throw userError("That set could not be saved");
    }

    if (item.placement === "open" && !missingRequested) {
      const open = await openSession(ctx, userId);
      if (open) {
        if (!open.clientId && isClientId(item.sessionClientId)) {
          await ctx.db.patch("sessions", open._id, { clientId: item.sessionClientId });
        }
        rememberSession(key, item.sessionClientId, open._id);
        return open._id;
      }
    }

    const sessionId = await ctx.db.insert("sessions", {
      userId,
      status: item.placement === "completed" ? "completed" : "open",
      startedAt,
      setCount: 0,
      ...(item.placement === "completed" ? { completedAt: startedAt } : {}),
      ...(isClientId(item.sessionClientId)
        ? { clientId: item.sessionClientId, clientStartedAt: item.sessionStartedAt }
        : {}),
    });
    createdSessions.set(sessionId, startedAt);
    rememberSession(key, item.sessionClientId, sessionId);
    return sessionId;
  }

  const freshSets: Array<{
    setId: Id<"sets">;
    sessionId: Id<"sessions">;
    exerciseId: Id<"exercises">;
    exerciseName: string;
    loggedAt: number;
    normalized: NormalizedSet;
  }> = [];
  const droppedSets: Array<Doc<"sets">> = [];

  for (const item of args.sets) {
    try {
      if (!isClientId(item.clientId) || !acceptedRevision(item.revision)) {
        throw userError("That set could not be saved");
      }
      const existing = await findByClientId(ctx, userId, item.clientId);
      if (item.removed) {
        await rememberRemoval(ctx, userId, item.clientId, now);
        if (existing) {
          droppedSets.push(existing);
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
      const removed = await findRemoval(ctx, userId, item.clientId);
      if (removed) {
        setResults.push({
          clientId: item.clientId,
          revision: item.revision,
          status: "removed",
          setId: null,
          sessionId: null,
          personalRecord: null,
          message: null,
        });
        continue;
      }
      const correctedLoggedAt = acceptedTime(item.loggedAt, offsetMs, now);
      if (correctedLoggedAt === null) {
        throw userError("That set's time is invalid");
      }
      const normalized = normalizeSetInput(item);
      const formatted = formatExerciseName(item.exerciseName);
      if (!formatted) {
        throw userError("Exercise name must be 1 to 80 characters");
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
      let loggedAt = correctedLoggedAt;
      const sessionForWindow = await ctx.db.get("sessions", sessionId);
      if (sessionForWindow && !createdSessions.has(sessionId)) {
        loggedAt = clampToWindow(loggedAt, sessionForWindow.startedAt, now);
      }
      if (loggedAt > now) {
        loggedAt = now;
      }
      const exerciseId = await getOrCreateExercise(ctx, userId, formatted.name);
      const exercise = await ctx.db.get("exercises", exerciseId);

      if (!existing) {
        const count = await ctx.db
          .query("sets")
          .withIndex("by_session_and_exercise", (q) => q.eq("sessionId", sessionId))
          .take(500);
        if (count.length >= 500) {
          throw userError("This workout already has 500 sets");
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
        freshSets.push({
          setId,
          sessionId,
          exerciseId,
          exerciseName: exercise?.name ?? formatted.name,
          loggedAt,
          normalized,
        });
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
          personalRecord: null,
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
      const personalRecord =
        existing.exerciseId === exerciseId
          ? await recordEditedSet(
              ctx,
              userId,
              exercise?.name ?? formatted.name,
              existing,
              recordPoint({ ...normalized, sessionId: existing.sessionId }),
            )
          : await movedSetRecord(
              ctx,
              userId,
              existing.exerciseId,
              exerciseId,
              exercise?.name ?? formatted.name,
              existing.loggedAt,
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

  // Removals are applied before new sets are scored, so a record in this
  // batch is judged without the sets it removes.
  const deletedSets: Array<Doc<"sets">> = [];
  const deleteResults: OfflineDeleteResult[] = [];
  for (const item of args.deletes) {
    try {
      if (!isClientId(item.deleteId)) {
        throw userError("That set could not be removed");
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
      if (set.clientId) {
        await rememberRemoval(ctx, userId, set.clientId, now);
      }
      await ctx.db.delete("sets", set._id);
      await noteSetsRemoved(ctx, set.sessionId, [set.loggedAt]);
      deletedSets.push(set);
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
  if (droppedSets.length > 0) {
    const droppedSessions = new Set(droppedSets.map((set) => set.sessionId));
    for (const sessionId of droppedSessions) {
      await noteSetsRemoved(
        ctx,
        sessionId,
        droppedSets.filter((set) => set.sessionId === sessionId).map((set) => set.loggedAt),
      );
    }
  }
  await recordRemovedSets(ctx, userId, [...droppedSets, ...deletedSets]);

  const freshByExercise = new Map<Id<"exercises">, typeof freshSets>();
  for (const item of freshSets) {
    const list = freshByExercise.get(item.exerciseId) ?? [];
    list.push(item);
    freshByExercise.set(item.exerciseId, list);
  }
  for (const group of freshByExercise.values()) {
    const first = group[0];
    if (!first) {
      continue;
    }
    const recorded = await recordInsertedSets(
      ctx,
      userId,
      first.exerciseId,
      first.exerciseName,
      group.map((item) => ({
        _id: item.setId,
        sessionId: item.sessionId,
        loggedAt: item.loggedAt,
        reps: item.normalized.reps,
        weightLb: item.normalized.weightLb,
        durationSec: item.normalized.durationSec,
        distanceM: item.normalized.distanceM,
        calories: item.normalized.calories,
        setType: item.normalized.setType,
      })),
    );
    for (const item of recorded.perSet) {
      const result = setResults.find((row) => row.setId === item.setId);
      if (result) {
        result.personalRecord = item.personalRecord;
      }
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
        throw userError("That edit could not be saved");
      }
      const set = await ctx.db.get("sets", item.setId);
      if (!set && deletedSets.some((row) => row._id === item.setId)) {
        // Deleted earlier in this batch. Edits used to land first, then the delete.
        editResults.push({
          editId: item.editId,
          status: "applied",
          personalRecord: null,
          message: null,
        });
        continue;
      }
      if (!set || set.userId !== userId) {
        throw userError("Set not found");
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
      const personalRecord = await recordEditedSet(
        ctx,
        userId,
        exercise?.name ?? "Exercise",
        set,
        recordPoint({ ...normalized, sessionId: set.sessionId }),
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

  const actionResults: OfflineActionResult[] = [];
  for (const item of args.actions) {
    try {
      if (!isClientId(item.actionId) || !isClientId(item.sessionClientId)) {
        throw userError("That workout could not be saved");
      }
      let session: Doc<"sessions"> | null = null;
      if (item.sessionId) {
        const row = await ctx.db.get("sessions", item.sessionId);
        if (row && row.userId !== userId) {
          throw userError("Workout not found");
        }
        if (row && row.userId === userId) {
          session = row;
        }
      }
      if (!session) {
        const createdId = resolvedByClient.get(item.sessionClientId);
        if (createdId) {
          const created = await ctx.db.get("sessions", createdId);
          if (created && created.userId === userId) {
            session = created;
          }
        }
      }
      if (!session && isClientId(item.sessionClientId)) {
        const matches = await sessionsForClientId(ctx, userId, item.sessionClientId);
        session = matches.find((candidate) => candidate.status === "open") ?? matches[0] ?? null;
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
          throw userError("This workout has sets. Finish it instead");
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
        await saveFinishOnCompleted(ctx, userId, session, item, offsetMs, now);
        actionResults.push({
          actionId: item.actionId,
          status: "applied",
          sessionId: session._id,
          message: null,
        });
        continue;
      }
      const lastSetAt = await newestLoggedAt(ctx, session);
      if (lastSetAt === null) {
        throw userError("Log at least one set before finishing");
      }
      const requested = acceptedTime(item.requestedAt, offsetMs, now);
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
      const loggedAt = acceptedTime(item.loggedAt, offsetMs, now);
      const entryId = await insertBodyEntry(
        ctx,
        userId,
        loggedAt === null ? item : { ...item, loggedAt },
        now,
      );
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
    serverNow: now,
  };
}
