import { formatExerciseName } from "../../convex/lib/exerciseName.ts";
import type { PersonalRecord } from "../../convex/lib/records.ts";
import { isSetType, resolvedSetType, type SetType } from "../../convex/lib/setType.ts";
import type { SetLine } from "../groupSets.ts";

/** Matches the server batch cap in convex/lib/workouts.ts. */
export const OFFLINE_BATCH_LIMIT = 30;

export type Placement = "open" | "completed";

export type SetBody = {
  exerciseName: string;
  reps: number | null;
  weightLb: number;
  durationSec: number | null;
  distanceM: number | null;
  rpe: number | null;
  setType?: SetType;
  loggedAt: number;
};

export type PendingSet = {
  clientId: string;
  revision: number;
  removed: boolean;
  placement: Placement;
  sessionId: string | null;
  sessionClientId: string;
  sessionStartedAt: number;
  note: string | null;
  set: SetBody;
  syncError: string | null;
  echoedRevision: number | null;
  ackedSetId: string | null;
};

export type PendingEdit = {
  editId: string;
  setId: string;
  reps: number | null;
  weightLb: number;
  durationSec: number | null;
  distanceM: number | null;
  rpe: number | null;
  setType?: SetType;
  syncError: string | null;
  echoed: boolean;
};

export type PendingDelete = {
  deleteId: string;
  setId: string;
  syncError: string | null;
  echoed: boolean;
};

export type PendingAction = {
  actionId: string;
  sessionId: string | null;
  sessionClientId: string;
  kind: "complete" | "discard" | "keepGoing";
  note: string | null;
  requestedAt: number;
  syncError: string | null;
  echoed: boolean;
};

export type Outbox = {
  openSessionClientId: string | null;
  sets: PendingSet[];
  edits: PendingEdit[];
  deletes: PendingDelete[];
  actions: PendingAction[];
};

export type SyncBatch = {
  sets: PendingSet[];
  edits: PendingEdit[];
  deletes: PendingDelete[];
  actions: PendingAction[];
};

export type SetSyncResult = {
  clientId: string;
  revision: number;
  status: "applied" | "rejected";
  setId: string | null;
  sessionId: string | null;
  personalRecord: PersonalRecord | null;
  message: string | null;
};

export type EditSyncResult = {
  editId: string;
  status: "applied" | "rejected";
  personalRecord: PersonalRecord | null;
  message: string | null;
};

export type DeleteSyncResult = {
  deleteId: string;
  status: "applied" | "rejected";
  message: string | null;
};

export type ActionSyncResult = {
  actionId: string;
  status: "applied" | "rejected";
  sessionId: string | null;
  message: string | null;
};

export type SyncResult = {
  sets: SetSyncResult[];
  edits: EditSyncResult[];
  deletes: DeleteSyncResult[];
  actions: ActionSyncResult[];
};

export type WorkoutView =
  | { kind: "open"; sessionId: string | null }
  | { kind: "session"; sessionId: string };

export function emptyOutbox(): Outbox {
  return {
    openSessionClientId: null,
    sets: [],
    edits: [],
    deletes: [],
    actions: [],
  };
}

export function enqueueSets(
  outbox: Outbox,
  input: {
    placement: Placement;
    sessionId: string | null;
    sessionClientId: string;
    sessionStartedAt: number;
    note: string | null;
    sets: Array<Omit<SetBody, "loggedAt"> & { clientId: string; loggedAt?: number }>;
    now: number;
  },
): { outbox: Outbox; clientIds: string[] } {
  const sessionClientId = input.sessionClientId;
  const used = new Set<number>();
  for (const set of outbox.sets) {
    if (set.sessionClientId === sessionClientId) {
      used.add(set.set.loggedAt);
    }
  }
  let cursor = input.now;
  const known = new Set(outbox.sets.map((set) => set.clientId));
  const added: PendingSet[] = [];
  const clientIds: string[] = [];

  for (const set of input.sets) {
    clientIds.push(set.clientId);
    if (known.has(set.clientId)) {
      continue;
    }
    known.add(set.clientId);
    let loggedAt = set.loggedAt ?? cursor;
    if (!Number.isFinite(loggedAt)) {
      loggedAt = cursor;
    }
    while (used.has(loggedAt)) {
      loggedAt += 1;
    }
    used.add(loggedAt);
    if (loggedAt >= cursor) {
      cursor = loggedAt + 1;
    }
    added.push({
      clientId: set.clientId,
      revision: 1,
      removed: false,
      placement: input.placement,
      sessionId: input.sessionId,
      sessionClientId,
      sessionStartedAt: input.sessionStartedAt,
      note: input.note,
      set: {
        exerciseName: set.exerciseName,
        reps: set.reps,
        weightLb: set.weightLb,
        durationSec: set.durationSec,
        distanceM: set.distanceM,
        rpe: set.rpe,
        ...(set.setType !== undefined ? { setType: set.setType } : {}),
        loggedAt,
      },
      syncError: null,
      echoedRevision: null,
      ackedSetId: null,
    });
  }

  return {
    outbox: {
      ...outbox,
      openSessionClientId:
        input.placement === "open" && input.sessionId === null
          ? (outbox.openSessionClientId ?? sessionClientId)
          : outbox.openSessionClientId,
      sets: [...outbox.sets, ...added],
      actions: outbox.actions.map((action) =>
        action.sessionClientId === sessionClientId && action.syncError
          ? { ...action, syncError: null }
          : action,
      ),
    },
    clientIds,
  };
}

export function editPendingSet(
  outbox: Outbox,
  clientId: string,
  patch: Partial<Omit<SetBody, "loggedAt">>,
): Outbox {
  return {
    ...outbox,
    sets: outbox.sets.map((set) => {
      if (set.clientId !== clientId || set.removed) {
        return set;
      }
      return {
        ...set,
        revision: set.revision + 1,
        syncError: null,
        set: {
          ...set.set,
          ...patch,
        },
      };
    }),
  };
}

export function removePendingSet(outbox: Outbox, clientId: string): Outbox {
  return {
    ...outbox,
    sets: outbox.sets.map((set) => {
      if (set.clientId !== clientId) {
        return set;
      }
      return {
        ...set,
        removed: true,
        revision: set.revision + 1,
        syncError: null,
      };
    }),
  };
}

export function queueEdit(
  outbox: Outbox,
  edit: Omit<PendingEdit, "syncError" | "echoed">,
): Outbox {
  const next: PendingEdit = { ...edit, syncError: null, echoed: false };
  const without = outbox.edits.filter((item) => item.setId !== edit.setId);
  return { ...outbox, edits: [...without, next] };
}

export function queueDelete(outbox: Outbox, deleteId: string, setId: string): Outbox {
  const deletes = outbox.deletes.filter((item) => item.setId !== setId);
  return {
    ...outbox,
    edits: outbox.edits.filter((item) => item.setId !== setId),
    deletes: [
      ...deletes,
      { deleteId, setId, syncError: null, echoed: false },
    ],
    sets: outbox.sets.map((set) =>
      set.ackedSetId === setId
        ? { ...set, removed: true, revision: set.revision + 1, syncError: null }
        : set,
    ),
  };
}

export function queueAction(
  outbox: Outbox,
  action: Omit<PendingAction, "syncError" | "echoed">,
): Outbox {
  const actions = outbox.actions.filter(
    (item) =>
      !(item.kind === action.kind && item.sessionClientId === action.sessionClientId),
  );
  return {
    ...outbox,
    actions: [...actions, { ...action, syncError: null, echoed: false }],
  };
}

export function nextBatch(outbox: Outbox, limit = OFFLINE_BATCH_LIMIT): SyncBatch {
  const batch: SyncBatch = { sets: [], edits: [], deletes: [], actions: [] };
  const remaining = () =>
    limit - (batch.sets.length + batch.edits.length + batch.deletes.length + batch.actions.length);

  for (const set of outbox.sets) {
    if (remaining() <= 0) {
      return batch;
    }
    if (set.syncError || set.echoedRevision === set.revision) {
      continue;
    }
    batch.sets.push(set);
  }
  for (const edit of outbox.edits) {
    if (remaining() <= 0) {
      return batch;
    }
    if (edit.syncError || edit.echoed) {
      continue;
    }
    batch.edits.push(edit);
  }
  for (const deletion of outbox.deletes) {
    if (remaining() <= 0) {
      return batch;
    }
    if (deletion.syncError || deletion.echoed) {
      continue;
    }
    batch.deletes.push(deletion);
  }
  for (const action of outbox.actions) {
    if (remaining() <= 0) {
      return batch;
    }
    if (action.syncError || action.echoed) {
      continue;
    }
    batch.actions.push(action);
  }
  return batch;
}

export function batchHasWork(batch: SyncBatch): boolean {
  return (
    batch.sets.length + batch.edits.length + batch.deletes.length + batch.actions.length > 0
  );
}

export function applySyncResult(
  outbox: Outbox,
  result: SyncResult,
): { outbox: Outbox; personalRecords: PersonalRecord[] } {
  const personalRecords: PersonalRecord[] = [];
  const setResults = new Map(result.sets.map((item) => [item.clientId, item]));
  let openSessionClientId = outbox.openSessionClientId;
  const sessionByClient = new Map<string, string>();

  for (const item of result.sets) {
    if (item.status === "applied" && item.sessionId) {
      const local = outbox.sets.find((set) => set.clientId === item.clientId);
      if (local) {
        sessionByClient.set(local.sessionClientId, item.sessionId);
      }
    }
  }
  for (const item of result.actions) {
    if (item.status === "applied" && item.sessionId) {
      const local = outbox.actions.find((action) => action.actionId === item.actionId);
      if (local && local.sessionId === null) {
        sessionByClient.set(local.sessionClientId, item.sessionId);
      }
    }
  }

  const sets = outbox.sets.flatMap((set) => {
    const appliedSession = sessionByClient.get(set.sessionClientId);
    const stamped =
      set.sessionId === null && appliedSession
        ? { ...set, sessionId: appliedSession }
        : set;
    const item = setResults.get(set.clientId);
    if (!item) {
      return [stamped];
    }
    if (item.status === "rejected") {
      return [{ ...stamped, syncError: item.message ?? "That set could not be saved" }];
    }
    if (item.personalRecord && stamped.revision === item.revision) {
      personalRecords.push(item.personalRecord);
    }
    if (stamped.revision !== item.revision) {
      return [
        {
          ...stamped,
          ackedSetId: item.setId ?? stamped.ackedSetId,
          syncError: null,
        },
      ];
    }
    if (stamped.removed) {
      return [];
    }
    return [
      {
        ...stamped,
        echoedRevision: item.revision,
        ackedSetId: item.setId,
        syncError: null,
      },
    ];
  });

  const edits = outbox.edits.flatMap((edit) => {
    const item = result.edits.find((entry) => entry.editId === edit.editId);
    if (!item) {
      return [edit];
    }
    if (item.status === "rejected") {
      return [{ ...edit, syncError: item.message ?? "That edit could not be saved" }];
    }
    if (item.personalRecord) {
      personalRecords.push(item.personalRecord);
    }
    return [{ ...edit, echoed: true, syncError: null }];
  });

  const deletes = outbox.deletes.map((deletion) => {
    const item = result.deletes.find((entry) => entry.deleteId === deletion.deleteId);
    if (!item) {
      return deletion;
    }
    if (item.status === "rejected") {
      return { ...deletion, syncError: item.message ?? "That set could not be removed" };
    }
    return { ...deletion, echoed: true, syncError: null };
  });

  const actions = outbox.actions.map((action) => {
    const item = result.actions.find((entry) => entry.actionId === action.actionId);
    if (!item) {
      const appliedSession = sessionByClient.get(action.sessionClientId);
      if (action.sessionId === null && appliedSession) {
        return { ...action, sessionId: appliedSession };
      }
      return action;
    }
    if (item.status === "rejected") {
      return { ...action, syncError: item.message ?? "That workout could not be saved" };
    }
    if (
      action.kind === "complete" &&
      action.sessionClientId === openSessionClientId
    ) {
      openSessionClientId = null;
    }
    return {
      ...action,
      sessionId: item.sessionId ?? action.sessionId,
      echoed: true,
      syncError: null,
    };
  });

  return {
    outbox: { openSessionClientId, sets, edits, deletes, actions },
    personalRecords,
  };
}

export function reconcileOutbox(
  outbox: Outbox,
  serverSets: Array<SetLine & { clientId?: string | null }>,
): Outbox {
  const byId = new Map(serverSets.map((set) => [set._id, set]));
  const byClientId = new Map<string, SetLine & { clientId?: string | null }>();
  for (const set of serverSets) {
    if (set.clientId) {
      byClientId.set(set.clientId, set);
    }
  }

  const sets = outbox.sets.filter((set) => {
    if (set.removed) {
      return set.echoedRevision !== set.revision;
    }
    if (set.echoedRevision !== set.revision) {
      return true;
    }
    if (set.clientId && byClientId.has(set.clientId)) {
      return false;
    }
    if (set.ackedSetId && byId.has(set.ackedSetId)) {
      return false;
    }
    return true;
  });

  const edits = outbox.edits.filter((edit) => {
    const server = byId.get(edit.setId);
    if (!server) {
      return !edit.echoed;
    }
    if (!edit.echoed) {
      return true;
    }
    return !measuresMatch(server, edit);
  });

  const deletes = outbox.deletes.filter((deletion) => {
    if (!deletion.echoed) {
      return true;
    }
    return byId.has(deletion.setId);
  });

  const actions = outbox.actions.filter((action) => !action.echoed);

  return { ...outbox, sets, edits, deletes, actions };
}

export function mergeVisibleSets(
  serverSets: Array<SetLine & { clientId?: string | null }>,
  outbox: Outbox,
  view: WorkoutView,
): SetLine[] {
  const deleted = new Set(outbox.deletes.map((item) => item.setId));
  const edits = new Map(outbox.edits.map((item) => [item.setId, item]));
  const pendingByClient = new Map<string, PendingSet>();
  for (const set of outbox.sets) {
    if (!set.removed) {
      pendingByClient.set(set.clientId, set);
    }
  }
  const visible: SetLine[] = [];

  for (const set of serverSets) {
    if (deleted.has(set._id)) {
      continue;
    }
    const edit = edits.get(set._id);
    const pending = set.clientId ? pendingByClient.get(set.clientId) : undefined;
    const newer =
      pending && pending.echoedRevision !== pending.revision ? pending : undefined;
    if (edit) {
      visible.push({
        ...set,
        reps: edit.reps,
        weightLb: edit.weightLb,
        durationSec: edit.durationSec,
        distanceM: edit.distanceM,
        rpe: edit.rpe,
        ...(edit.setType !== undefined ? { setType: edit.setType } : {}),
        pending: true,
        clientId: set.clientId ?? null,
      });
      continue;
    }
    if (newer) {
      visible.push({
        ...set,
        exerciseName: newer.set.exerciseName,
        reps: newer.set.reps,
        weightLb: newer.set.weightLb,
        durationSec: newer.set.durationSec,
        distanceM: newer.set.distanceM,
        rpe: newer.set.rpe,
        ...(newer.set.setType !== undefined ? { setType: newer.set.setType } : {}),
        pending: true,
        clientId: set.clientId ?? null,
      });
      continue;
    }
    visible.push({ ...set, pending: false, clientId: set.clientId ?? null });
  }

  const seenClients = new Set(
    serverSets.flatMap((set) => (set.clientId ? [set.clientId] : [])),
  );
  const seenIds = new Set(serverSets.map((set) => set._id));

  for (const set of outbox.sets) {
    if (set.removed || !belongsToView(set, outbox, view)) {
      continue;
    }
    if (seenClients.has(set.clientId)) {
      continue;
    }
    if (set.ackedSetId && seenIds.has(set.ackedSetId)) {
      continue;
    }
    visible.push({
      _id: `pending:${set.clientId}`,
      exerciseId: exerciseIdFor(set.set.exerciseName, visible),
      exerciseName: set.set.exerciseName,
      reps: set.set.reps,
      weightLb: set.set.weightLb,
      durationSec: set.set.durationSec,
      distanceM: set.set.distanceM,
      rpe: set.set.rpe,
      ...(set.set.setType !== undefined ? { setType: set.set.setType } : {}),
      loggedAt: set.set.loggedAt,
      pending: true,
      clientId: set.clientId,
    });
  }

  visible.sort((left, right) => left.loggedAt - right.loggedAt);
  return visible;
}

export function pendingChangeCount(outbox: Outbox): number {
  let count = 0;
  for (const set of outbox.sets) {
    if (!set.removed && set.echoedRevision !== set.revision) {
      count += 1;
    }
  }
  for (const edit of outbox.edits) {
    if (!edit.echoed) {
      count += 1;
    }
  }
  for (const deletion of outbox.deletes) {
    if (!deletion.echoed) {
      count += 1;
    }
  }
  for (const action of outbox.actions) {
    if (!action.echoed) {
      count += 1;
    }
  }
  return count;
}

export function pendingExerciseNames(outbox: Outbox): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const set of outbox.sets) {
    if (set.removed || set.echoedRevision === set.revision) {
      continue;
    }
    const key = formatExerciseName(set.set.exerciseName)?.normalizedName ?? set.set.exerciseName;
    if (!seen.has(key)) {
      seen.add(key);
      names.push(set.set.exerciseName);
    }
  }
  return names;
}

export function firstSyncError(outbox: Outbox): string | null {
  for (const set of outbox.sets) {
    if (set.syncError) {
      return set.syncError;
    }
  }
  for (const edit of outbox.edits) {
    if (edit.syncError) {
      return edit.syncError;
    }
  }
  for (const deletion of outbox.deletes) {
    if (deletion.syncError) {
      return deletion.syncError;
    }
  }
  for (const action of outbox.actions) {
    if (action.syncError) {
      return action.syncError;
    }
  }
  return null;
}

export function pendingResumedAt(
  outbox: Outbox,
  sessionId: string | null,
): number | null {
  let newest: number | null = null;
  for (const action of outbox.actions) {
    if (action.kind !== "keepGoing" || action.echoed) {
      continue;
    }
    if (sessionId && action.sessionId !== sessionId && action.sessionClientId !== outbox.openSessionClientId) {
      continue;
    }
    if (!sessionId && action.sessionClientId !== outbox.openSessionClientId) {
      continue;
    }
    if (newest === null || action.requestedAt > newest) {
      newest = action.requestedAt;
    }
  }
  return newest;
}

export function hasPendingFinish(outbox: Outbox, sessionId: string | null): boolean {
  return outbox.actions.some((action) => {
    if (action.kind !== "complete" || action.echoed) {
      return false;
    }
    if (sessionId && (action.sessionId === sessionId || action.sessionClientId === outbox.openSessionClientId)) {
      return true;
    }
    return !sessionId && action.sessionClientId === outbox.openSessionClientId;
  });
}

export function pendingNote(outbox: Outbox, view: WorkoutView): string | null {
  const notes: string[] = [];
  for (const set of outbox.sets) {
    if (!set.note || set.removed || !belongsToView(set, outbox, view)) {
      continue;
    }
    if (!notes.includes(set.note)) {
      notes.push(set.note);
    }
  }
  return notes.length > 0 ? notes.join("\n") : null;
}

export function parseOutbox(value: unknown): Outbox {
  if (!isRecord(value)) {
    return emptyOutbox();
  }
  const sets: PendingSet[] = [];
  if (Array.isArray(value.sets)) {
    for (const item of value.sets) {
      const parsed = parsePendingSet(item);
      if (parsed) {
        sets.push(parsed);
      }
    }
  }
  return {
    openSessionClientId:
      typeof value.openSessionClientId === "string" ? value.openSessionClientId : null,
    sets,
    edits: parseList(value.edits, parsePendingEdit),
    deletes: parseList(value.deletes, parsePendingDelete),
    actions: parseList(value.actions, parsePendingAction),
  };
}

function belongsToView(set: PendingSet, outbox: Outbox, view: WorkoutView): boolean {
  if (view.kind === "session") {
    return set.sessionId === view.sessionId;
  }
  if (set.placement !== "open") {
    return false;
  }
  if (view.sessionId) {
    return (
      set.sessionId === view.sessionId ||
      (set.sessionId === null && set.sessionClientId === outbox.openSessionClientId)
    );
  }
  return set.sessionId === null;
}

function exerciseIdFor(name: string, sets: SetLine[]): string {
  const normalized = formatExerciseName(name)?.normalizedName;
  for (const set of sets) {
    if (formatExerciseName(set.exerciseName)?.normalizedName === normalized) {
      return set.exerciseId;
    }
  }
  return `local:${normalized ?? name}`;
}

function measuresMatch(
  server: SetLine,
  edit: Pick<PendingEdit, "reps" | "weightLb" | "durationSec" | "distanceM" | "rpe" | "setType">,
): boolean {
  const typeMatches =
    edit.setType === undefined || resolvedSetType(server.setType) === resolvedSetType(edit.setType);
  return (
    server.reps === edit.reps &&
    server.weightLb === edit.weightLb &&
    server.durationSec === edit.durationSec &&
    server.distanceM === edit.distanceM &&
    server.rpe === edit.rpe &&
    typeMatches
  );
}

function parsePendingSet(value: unknown): PendingSet | null {
  if (!isRecord(value) || typeof value.clientId !== "string" || !isRecord(value.set)) {
    return null;
  }
  const body = value.set;
  if (typeof body.exerciseName !== "string" || typeof body.weightLb !== "number") {
    return null;
  }
  const placement = value.placement === "completed" ? "completed" : "open";
  return {
    clientId: value.clientId,
    revision: typeof value.revision === "number" ? value.revision : 1,
    removed: value.removed === true,
    placement,
    sessionId: typeof value.sessionId === "string" ? value.sessionId : null,
    sessionClientId: typeof value.sessionClientId === "string" ? value.sessionClientId : value.clientId,
    sessionStartedAt: typeof value.sessionStartedAt === "number" ? value.sessionStartedAt : 0,
    note: typeof value.note === "string" ? value.note : null,
    set: {
      exerciseName: body.exerciseName,
      reps: typeof body.reps === "number" ? body.reps : null,
      weightLb: body.weightLb,
      durationSec: typeof body.durationSec === "number" ? body.durationSec : null,
      distanceM: typeof body.distanceM === "number" ? body.distanceM : null,
      rpe: typeof body.rpe === "number" ? body.rpe : null,
      ...(isSetType(body.setType) ? { setType: body.setType } : {}),
      loggedAt: typeof body.loggedAt === "number" ? body.loggedAt : 0,
    },
    syncError: typeof value.syncError === "string" ? value.syncError : null,
    echoedRevision: typeof value.echoedRevision === "number" ? value.echoedRevision : null,
    ackedSetId: typeof value.ackedSetId === "string" ? value.ackedSetId : null,
  };
}

function parsePendingEdit(value: unknown): PendingEdit | null {
  if (!isRecord(value) || typeof value.editId !== "string" || typeof value.setId !== "string") {
    return null;
  }
  if (typeof value.weightLb !== "number") {
    return null;
  }
  return {
    editId: value.editId,
    setId: value.setId,
    reps: typeof value.reps === "number" ? value.reps : null,
    weightLb: value.weightLb,
    durationSec: typeof value.durationSec === "number" ? value.durationSec : null,
    distanceM: typeof value.distanceM === "number" ? value.distanceM : null,
    rpe: typeof value.rpe === "number" ? value.rpe : null,
    ...(isSetType(value.setType) ? { setType: value.setType } : {}),
    syncError: typeof value.syncError === "string" ? value.syncError : null,
    echoed: value.echoed === true,
  };
}

function parsePendingDelete(value: unknown): PendingDelete | null {
  if (!isRecord(value) || typeof value.deleteId !== "string" || typeof value.setId !== "string") {
    return null;
  }
  return {
    deleteId: value.deleteId,
    setId: value.setId,
    syncError: typeof value.syncError === "string" ? value.syncError : null,
    echoed: value.echoed === true,
  };
}

function parsePendingAction(value: unknown): PendingAction | null {
  if (!isRecord(value) || typeof value.actionId !== "string" || typeof value.sessionClientId !== "string") {
    return null;
  }
  if (value.kind !== "complete" && value.kind !== "discard" && value.kind !== "keepGoing") {
    return null;
  }
  return {
    actionId: value.actionId,
    sessionId: typeof value.sessionId === "string" ? value.sessionId : null,
    sessionClientId: value.sessionClientId,
    kind: value.kind,
    note: typeof value.note === "string" ? value.note : null,
    requestedAt: typeof value.requestedAt === "number" ? value.requestedAt : 0,
    syncError: typeof value.syncError === "string" ? value.syncError : null,
    echoed: value.echoed === true,
  };
}

function parseList<T>(value: unknown, parse: (item: unknown) => T | null): T[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const items: T[] = [];
  for (const item of value) {
    const parsed = parse(item);
    if (parsed) {
      items.push(parsed);
    }
  }
  return items;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
