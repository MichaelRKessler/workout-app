import { isClientId } from "../../convex/lib/clientIds.ts";
import { formatExerciseName } from "../../convex/lib/exerciseName.ts";
import type { PersonalRecord } from "../../convex/lib/records.ts";
import { isSetType, resolvedSetType, type SetType } from "../../convex/lib/setType.ts";
import type { SetLine } from "../groupSets.ts";
import { newerClock, parseClock, type ClockReading } from "./clock.ts";

const CLOSED_CAP = 200;
const KNOWN_CAP = 1000;
const DROPPED_CAP = 2000;

/** Matches the server batch cap in convex/lib/workouts.ts. */
export const OFFLINE_BATCH_LIMIT = 30;

export type Placement = "open" | "completed";

export type SetBody = {
  exerciseName: string;
  reps: number | null;
  weightLb: number;
  durationSec: number | null;
  distanceM: number | null;
  calories?: number | null;
  rpe: number | null;
  setType?: SetType;
  loggedAt: number;
  /** Present when this set was confirmed as part of a superset. */
  supersetId?: string;
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
  errorChangedAt?: number;
  echoedRevision: number | null;
  ackedSetId: string | null;
};

/**
 * `errorChangedAt` is when syncError was last set or cleared on this phone.
 * A merge keeps the copy that changed last, so another tab's stale copy
 * cannot erase a rejection or undo a retry. Older queues omit it.
 */
export type ErrorState = {
  syncError: string | null;
  errorChangedAt?: number;
};

export type PendingEdit = {
  editId: string;
  setId: string;
  reps: number | null;
  weightLb: number;
  durationSec: number | null;
  distanceM: number | null;
  calories?: number | null;
  rpe: number | null;
  setType?: SetType;
  syncError: string | null;
  errorChangedAt?: number;
  echoed: boolean;
};

export type PendingDelete = {
  deleteId: string;
  setId: string;
  syncError: string | null;
  errorChangedAt?: number;
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
  errorChangedAt?: number;
  echoed: boolean;
};

/** A weigh-in waiting on the phone. Null fields were left blank. */
export type PendingBody = {
  clientId: string;
  loggedAt: number;
  weightLb: number | null;
  bodyFatPct: number | null;
  waistCm: number | null;
  chestCm: number | null;
  armCm: number | null;
  hipsCm: number | null;
  thighCm: number | null;
  note: string | null;
  syncError: string | null;
  errorChangedAt?: number;
  echoed: boolean;
};

/** A server set id learned from a sync ack, kept after the set leaves the queue. */
export type KnownSetId = {
  clientId: string;
  setId: string;
};

/**
 * An item this tab has finished with. A stale copy in another tab must not
 * put it back. `revision` is the last revision that was dropped.
 */
export type DroppedItem = {
  kind: "set" | "edit" | "delete" | "action" | "body";
  id: string;
  revision: number;
};

export type Outbox = {
  openSessionClientId: string | null;
  /** Session client ids that were finished or discarded. Never reuse them. */
  closedSessionClientIds: string[];
  knownSetIds: KnownSetId[];
  dropped: DroppedItem[];
  sets: PendingSet[];
  edits: PendingEdit[];
  deletes: PendingDelete[];
  actions: PendingAction[];
  body: PendingBody[];
  /** Null until this phone has read the server clock. */
  clock: ClockReading | null;
};

export type SyncBatch = {
  sets: PendingSet[];
  edits: PendingEdit[];
  deletes: PendingDelete[];
  actions: PendingAction[];
  body: PendingBody[];
};

export type SetSyncResult = {
  clientId: string;
  revision: number;
  /** "removed" means the server deleted this set and will not save its client id again. */
  status: "applied" | "rejected" | "removed";
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

export type BodySyncResult = {
  clientId: string;
  status: "applied" | "rejected";
  entryId: string | null;
  message: string | null;
};

export type SyncResult = {
  sets: SetSyncResult[];
  edits: EditSyncResult[];
  deletes: DeleteSyncResult[];
  actions: ActionSyncResult[];
  body: BodySyncResult[];
};

export type WorkoutView =
  | { kind: "open"; sessionId: string | null }
  | { kind: "session"; sessionId: string };

export function emptyOutbox(): Outbox {
  return {
    openSessionClientId: null,
    closedSessionClientIds: [],
    knownSetIds: [],
    dropped: [],
    sets: [],
    edits: [],
    deletes: [],
    actions: [],
    body: [],
    clock: null,
  };
}

/** Records a new server clock reading, keeping whichever reading is later. */
export function recordClock(outbox: Outbox, reading: ClockReading | null): Outbox {
  const clock = newerClock(outbox.clock, reading);
  return clock === outbox.clock ? outbox : { ...outbox, clock };
}

/** Marks an item failed now. */
export function markFailed<T extends ErrorState>(item: T, message: string, now: number): T {
  return { ...item, syncError: message, errorChangedAt: now };
}

/**
 * Clears an item's error for another try. An item with no error is left
 * as is, so a stale copy does not look newer than another tab's rejection.
 */
export function clearError<T extends ErrorState>(item: T, now: number): T {
  if (item.syncError === null) {
    return item;
  }
  return { ...item, syncError: null, errorChangedAt: now };
}

/**
 * Takes items off the queue and records each one as dropped, so a stale copy
 * in storage or another tab cannot put it back when the queues merge. Just
 * filtering the list is not enough: the merge is a union.
 */
export function dropQueued(
  outbox: Outbox,
  items: Array<{ kind: DroppedItem["kind"]; id: string }>,
): Outbox {
  if (items.length === 0) {
    return outbox;
  }
  const idsOf = (kind: DroppedItem["kind"]) =>
    new Set(items.filter((item) => item.kind === kind).map((item) => item.id));
  const sets = idsOf("set");
  const edits = idsOf("edit");
  const deletes = idsOf("delete");
  const actions = idsOf("action");
  const body = idsOf("body");

  let dropped = outbox.dropped;
  for (const set of outbox.sets) {
    if (sets.has(set.clientId)) {
      dropped = rememberDrop(dropped, { kind: "set", id: set.clientId, revision: set.revision });
    }
  }
  for (const item of items) {
    if (item.kind !== "set") {
      dropped = rememberDrop(dropped, { kind: item.kind, id: item.id, revision: 1 });
    }
  }
  return {
    ...outbox,
    dropped,
    sets: outbox.sets.filter((set) => !sets.has(set.clientId)),
    edits: outbox.edits.filter((edit) => !edits.has(edit.editId)),
    deletes: outbox.deletes.filter((deletion) => !deletes.has(deletion.deleteId)),
    actions: outbox.actions.filter((action) => !actions.has(action.actionId)),
    body: outbox.body.filter((entry) => !body.has(entry.clientId)),
  };
}

/** Forgets the open workout id so the next workout cannot reuse it. */
export function releaseOpenSession(outbox: Outbox): Outbox {
  const id = outbox.openSessionClientId;
  if (!id) {
    return outbox;
  }
  return {
    ...outbox,
    openSessionClientId: null,
    closedSessionClientIds: rememberClosed(outbox.closedSessionClientIds, id),
  };
}

/**
 * A finish that went straight to the server used to leave the open id behind.
 * If nothing is still waiting on that id, retire it.
 */
export function repairOpenSession(outbox: Outbox): Outbox {
  const id = outbox.openSessionClientId;
  if (!id) {
    return outbox;
  }
  const waitingSet = outbox.sets.some(
    (set) =>
      !set.removed &&
      set.placement === "open" &&
      set.sessionClientId === id &&
      set.echoedRevision !== set.revision,
  );
  const waitingClose = outbox.actions.some(
    (action) =>
      !action.echoed &&
      action.sessionClientId === id &&
      (action.kind === "complete" || action.kind === "discard"),
  );
  if (waitingSet || waitingClose) {
    return outbox;
  }
  return releaseOpenSession(outbox);
}

/**
 * Past workouts always get a fresh id. An open workout reuses the id it
 * already queued, unless that id was finished or discarded.
 */
export function resolveSessionClientId(
  outbox: Outbox,
  input: {
    sessionId: string | null;
    explicit?: string;
    placement: Placement;
  },
  createId: () => string,
): string {
  const closed = new Set(outbox.closedSessionClientIds);
  const reusable = (id: string | null | undefined): id is string =>
    typeof id === "string" && isClientId(id) && !closed.has(id);

  if (input.placement === "completed") {
    if (reusable(input.explicit) && input.explicit !== outbox.openSessionClientId) {
      return input.explicit;
    }
    return createId();
  }
  if (reusable(input.explicit)) {
    return input.explicit;
  }
  if (input.sessionId === null) {
    if (reusable(outbox.openSessionClientId)) {
      return outbox.openSessionClientId;
    }
    return createId();
  }
  const existing = outbox.sets.find((set) => set.sessionId === input.sessionId);
  if (existing && reusable(existing.sessionClientId)) {
    return existing.sessionClientId;
  }
  if (reusable(input.sessionId)) {
    return input.sessionId;
  }
  return createId();
}

export function knownServerIds(outbox: Outbox): Map<string, string> {
  const known = new Map<string, string>();
  for (const item of outbox.knownSetIds) {
    known.set(item.clientId, item.setId);
    known.set(item.setId, item.setId);
  }
  for (const set of outbox.sets) {
    if (set.ackedSetId) {
      known.set(set.clientId, set.ackedSetId);
      known.set(set.ackedSetId, set.ackedSetId);
    }
  }
  return known;
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
        calories: set.calories ?? null,
        rpe: set.rpe,
        ...(set.setType !== undefined ? { setType: set.setType } : {}),
        ...(set.supersetId ? { supersetId: set.supersetId } : {}),
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
        action.sessionClientId === sessionClientId ? clearError(action, input.now) : action,
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

/** A newer edit of the same set replaces the older one, which is dropped. */
export function queueEdit(
  outbox: Outbox,
  edit: Omit<PendingEdit, "syncError" | "echoed">,
): Outbox {
  const next: PendingEdit = { ...edit, syncError: null, echoed: false };
  const replaced = dropQueued(
    outbox,
    outbox.edits
      .filter((item) => item.setId === edit.setId && item.editId !== edit.editId)
      .map((item) => ({ kind: "edit" as const, id: item.editId })),
  );
  return {
    ...replaced,
    edits: [...replaced.edits.filter((item) => item.editId !== edit.editId), next],
  };
}

/** A delete replaces any queued edit or older delete of the same set. */
export function queueDelete(outbox: Outbox, deleteId: string, setId: string): Outbox {
  const replaced = dropQueued(outbox, [
    ...outbox.edits
      .filter((item) => item.setId === setId)
      .map((item) => ({ kind: "edit" as const, id: item.editId })),
    ...outbox.deletes
      .filter((item) => item.setId === setId && item.deleteId !== deleteId)
      .map((item) => ({ kind: "delete" as const, id: item.deleteId })),
  ]);
  return {
    ...replaced,
    deletes: [
      ...replaced.deletes.filter((item) => item.deleteId !== deleteId),
      { deleteId, setId, syncError: null, echoed: false },
    ],
    sets: replaced.sets.map((set) =>
      set.ackedSetId === setId
        ? { ...set, removed: true, revision: set.revision + 1, syncError: null }
        : set,
    ),
  };
}

/** A newer request of the same kind for the same workout replaces the older one. */
export function queueAction(
  outbox: Outbox,
  action: Omit<PendingAction, "syncError" | "echoed">,
): Outbox {
  const replaced = dropQueued(
    outbox,
    outbox.actions
      .filter(
        (item) =>
          item.kind === action.kind &&
          item.sessionClientId === action.sessionClientId &&
          item.actionId !== action.actionId,
      )
      .map((item) => ({ kind: "action" as const, id: item.actionId })),
  );
  return {
    ...replaced,
    actions: [
      ...replaced.actions.filter((item) => item.actionId !== action.actionId),
      { ...action, syncError: null, echoed: false },
    ],
  };
}

export function enqueueBody(
  outbox: Outbox,
  entry: Omit<PendingBody, "syncError" | "echoed">,
): Outbox {
  const without = outbox.body.filter((item) => item.clientId !== entry.clientId);
  return {
    ...outbox,
    body: [...without, { ...entry, syncError: null, echoed: false }],
  };
}

export function removePendingBody(outbox: Outbox, clientId: string): Outbox {
  return dropQueued(outbox, [{ kind: "body", id: clientId }]);
}

export function nextBatch(outbox: Outbox, limit = OFFLINE_BATCH_LIMIT): SyncBatch {
  const batch: SyncBatch = { sets: [], edits: [], deletes: [], actions: [], body: [] };
  const remaining = () =>
    limit -
    (batch.sets.length +
      batch.edits.length +
      batch.deletes.length +
      batch.actions.length +
      batch.body.length);

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
  for (const entry of outbox.body) {
    if (remaining() <= 0) {
      return batch;
    }
    if (entry.syncError || entry.echoed) {
      continue;
    }
    batch.body.push(entry);
  }
  return batch;
}

export function batchHasWork(batch: SyncBatch): boolean {
  return (
    batch.sets.length +
      batch.edits.length +
      batch.deletes.length +
      batch.actions.length +
      batch.body.length >
    0
  );
}

export function applySyncResult(
  outbox: Outbox,
  result: SyncResult,
  now = Date.now(),
): { outbox: Outbox; personalRecords: PersonalRecord[] } {
  const personalRecords: PersonalRecord[] = [];
  const setResults = new Map(result.sets.map((item) => [item.clientId, item]));
  let openSessionClientId = outbox.openSessionClientId;
  let closedSessionClientIds = outbox.closedSessionClientIds;
  let knownSetIds = outbox.knownSetIds;
  let dropped = outbox.dropped;
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
    if (item.status === "removed") {
      // Deleted on the server, maybe from another device. Any revision of it
      // would get the same answer, so it leaves the queue.
      dropped = rememberDrop(dropped, { kind: "set", id: stamped.clientId, revision: stamped.revision });
      return [];
    }
    if (item.status === "rejected") {
      return [markFailed(stamped, item.message ?? "That set could not be saved", now)];
    }
    if (item.setId) {
      knownSetIds = rememberKnown(knownSetIds, stamped.clientId, item.setId);
    }
    if (item.personalRecord && stamped.revision === item.revision) {
      personalRecords.push(item.personalRecord);
    }
    if (stamped.revision !== item.revision) {
      // An ack for an older revision. Any error belongs to the newer one, so it stays.
      return [
        {
          ...stamped,
          ackedSetId: item.setId ?? stamped.ackedSetId,
        },
      ];
    }
    if (stamped.removed) {
      dropped = rememberDrop(dropped, { kind: "set", id: stamped.clientId, revision: stamped.revision });
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
      return [markFailed(edit, item.message ?? "That edit could not be saved", now)];
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
      return markFailed(deletion, item.message ?? "That set could not be removed", now);
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
      return markFailed(action, item.message ?? "That workout could not be saved", now);
    }
    if (action.kind === "complete" || action.kind === "discard") {
      closedSessionClientIds = rememberClosed(closedSessionClientIds, action.sessionClientId);
      if (action.sessionClientId === openSessionClientId) {
        openSessionClientId = null;
      }
    }
    return {
      ...action,
      sessionId: item.sessionId ?? action.sessionId,
      echoed: true,
      syncError: null,
    };
  });

  const bodyResults = result.body ?? [];
  const body = outbox.body.flatMap((entry) => {
    const item = bodyResults.find((row) => row.clientId === entry.clientId);
    if (!item) {
      return [entry];
    }
    if (item.status === "rejected") {
      return [markFailed(entry, item.message ?? "That entry could not be saved", now)];
    }
    dropped = rememberDrop(dropped, { kind: "body", id: entry.clientId, revision: 1 });
    return [];
  });

  return {
    outbox: {
      openSessionClientId,
      closedSessionClientIds,
      knownSetIds,
      dropped,
      sets,
      edits,
      deletes,
      actions,
      body,
      clock: outbox.clock,
    },
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

  let dropped = outbox.dropped;
  const sets = outbox.sets.filter((set) => {
    const keep = keepPendingSet(set, byId, byClientId);
    if (!keep) {
      dropped = rememberDrop(dropped, { kind: "set", id: set.clientId, revision: set.revision });
    }
    return keep;
  });

  const edits = outbox.edits.filter((edit) => {
    const server = byId.get(edit.setId);
    let keep = true;
    if (!server) {
      keep = !edit.echoed;
    } else if (edit.echoed) {
      keep = !measuresMatch(server, edit);
    }
    if (!keep) {
      dropped = rememberDrop(dropped, { kind: "edit", id: edit.editId, revision: 1 });
    }
    return keep;
  });

  const deletes = outbox.deletes.filter((deletion) => {
    const keep = !deletion.echoed || byId.has(deletion.setId);
    if (!keep) {
      dropped = rememberDrop(dropped, { kind: "delete", id: deletion.deleteId, revision: 1 });
    }
    return keep;
  });

  const actions = outbox.actions.filter((action) => {
    if (action.echoed) {
      dropped = rememberDrop(dropped, { kind: "action", id: action.actionId, revision: 1 });
      return false;
    }
    return true;
  });

  return { ...outbox, sets, edits, deletes, actions, dropped };
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
        calories: edit.calories ?? set.calories ?? null,
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
        calories: newer.set.calories ?? null,
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
      calories: set.set.calories ?? null,
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
  for (const entry of outbox.body) {
    if (!entry.echoed) {
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
  for (const entry of outbox.body) {
    if (entry.syncError) {
      return entry.syncError;
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
    closedSessionClientIds: parseStringList(value.closedSessionClientIds).slice(-CLOSED_CAP),
    knownSetIds: parseKnownSetIds(value.knownSetIds),
    dropped: parseDropped(value.dropped),
    sets,
    edits: parseList(value.edits, parsePendingEdit),
    deletes: parseList(value.deletes, parsePendingDelete),
    actions: parseList(value.actions, parsePendingAction),
    body: parseList(value.body, parsePendingBody),
    clock: parseClock(value.clock),
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
  edit: Pick<PendingEdit, "reps" | "weightLb" | "durationSec" | "distanceM" | "calories" | "rpe" | "setType">,
): boolean {
  const typeMatches =
    edit.setType === undefined || resolvedSetType(server.setType) === resolvedSetType(edit.setType);
  const caloriesMatch =
    edit.calories === undefined || (server.calories ?? null) === (edit.calories ?? null);
  return (
    server.reps === edit.reps &&
    server.weightLb === edit.weightLb &&
    server.durationSec === edit.durationSec &&
    server.distanceM === edit.distanceM &&
    server.rpe === edit.rpe &&
    caloriesMatch &&
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
      calories: typeof body.calories === "number" ? body.calories : null,
      rpe: typeof body.rpe === "number" ? body.rpe : null,
      ...(isSetType(body.setType) ? { setType: body.setType } : {}),
      ...(typeof body.supersetId === "string" && body.supersetId.length > 0
        ? { supersetId: body.supersetId }
        : {}),
      loggedAt: typeof body.loggedAt === "number" ? body.loggedAt : 0,
    },
    ...parseErrorState(value),
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
    ...(typeof value.calories === "number" ? { calories: value.calories } : {}),
    rpe: typeof value.rpe === "number" ? value.rpe : null,
    ...(isSetType(value.setType) ? { setType: value.setType } : {}),
    ...parseErrorState(value),
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
    ...parseErrorState(value),
    echoed: value.echoed === true,
  };
}

function parsePendingBody(value: unknown): PendingBody | null {
  if (!isRecord(value) || typeof value.clientId !== "string" || typeof value.loggedAt !== "number") {
    return null;
  }
  const numberOrNull = (field: unknown): number | null => (typeof field === "number" ? field : null);
  return {
    clientId: value.clientId,
    loggedAt: value.loggedAt,
    weightLb: numberOrNull(value.weightLb),
    bodyFatPct: numberOrNull(value.bodyFatPct),
    waistCm: numberOrNull(value.waistCm),
    chestCm: numberOrNull(value.chestCm),
    armCm: numberOrNull(value.armCm),
    hipsCm: numberOrNull(value.hipsCm),
    thighCm: numberOrNull(value.thighCm),
    note: typeof value.note === "string" ? value.note : null,
    ...parseErrorState(value),
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
    ...parseErrorState(value),
    echoed: value.echoed === true,
  };
}

function parseErrorState(value: Record<string, unknown>): ErrorState {
  return {
    syncError: typeof value.syncError === "string" ? value.syncError : null,
    ...(typeof value.errorChangedAt === "number" && Number.isFinite(value.errorChangedAt)
      ? { errorChangedAt: value.errorChangedAt }
      : {}),
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

function keepPendingSet(
  set: PendingSet,
  byId: Map<string, SetLine & { clientId?: string | null }>,
  byClientId: Map<string, SetLine & { clientId?: string | null }>,
): boolean {
  if (set.removed) {
    return set.echoedRevision !== set.revision;
  }
  if (set.echoedRevision !== set.revision) {
    return true;
  }
  // Acked with no set id: an older server's answer for a set deleted
  // elsewhere. It will never appear on the server, so it would stay forever.
  if (set.ackedSetId === null) {
    return false;
  }
  if (set.clientId && byClientId.has(set.clientId)) {
    return false;
  }
  if (set.ackedSetId && byId.has(set.ackedSetId)) {
    return false;
  }
  return true;
}

function rememberClosed(ids: string[], id: string): string[] {
  if (ids.includes(id)) {
    return ids;
  }
  return [...ids, id].slice(-CLOSED_CAP);
}

function rememberKnown(known: KnownSetId[], clientId: string, setId: string): KnownSetId[] {
  const without = known.filter((item) => item.clientId !== clientId);
  return [...without, { clientId, setId }].slice(-KNOWN_CAP);
}

function rememberDrop(dropped: DroppedItem[], item: DroppedItem): DroppedItem[] {
  const without = dropped.filter((entry) => !(entry.kind === item.kind && entry.id === item.id));
  const previous = dropped.find((entry) => entry.kind === item.kind && entry.id === item.id);
  const revision = Math.max(item.revision, previous?.revision ?? 0);
  return [...without, { ...item, revision }].slice(-DROPPED_CAP);
}

function parseStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function parseKnownSetIds(value: unknown): KnownSetId[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const known: KnownSetId[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.clientId !== "string" || typeof item.setId !== "string") {
      continue;
    }
    known.push({ clientId: item.clientId, setId: item.setId });
  }
  return known.slice(-KNOWN_CAP);
}

function parseDropped(value: unknown): DroppedItem[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const dropped: DroppedItem[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.id !== "string" || typeof item.revision !== "number") {
      continue;
    }
    if (
      item.kind !== "set" &&
      item.kind !== "edit" &&
      item.kind !== "delete" &&
      item.kind !== "action" &&
      item.kind !== "body"
    ) {
      continue;
    }
    dropped.push({ kind: item.kind, id: item.id, revision: item.revision });
  }
  return dropped.slice(-DROPPED_CAP);
}
