import { formatSetShort } from "../format.ts";
import type { PendingRest } from "../exerciseRest.ts";
import {
  clearError,
  dropQueued,
  type Outbox,
  type PendingAction,
  type PendingBody,
  type PendingDelete,
  type PendingEdit,
  type PendingSet,
} from "./outbox.ts";

export type PendingItem = {
  id: string;
  title: string;
  detail: string;
  /** Shown before discard. Says exactly what will be lost. */
  lost: string;
  failed: boolean;
  error: string | null;
};

export function listPendingItems(outbox: Outbox, rests: PendingRest[]): PendingItem[] {
  const items: PendingItem[] = [];
  for (const set of outbox.sets) {
    if (set.removed) {
      if (set.echoedRevision === set.revision) {
        continue;
      }
      items.push(describeRemoval(set));
      continue;
    }
    if (set.echoedRevision === set.revision) {
      continue;
    }
    items.push(describeSet(set));
  }
  for (const edit of outbox.edits) {
    if (!edit.echoed) {
      items.push(describeEdit(edit));
    }
  }
  for (const deletion of outbox.deletes) {
    if (!deletion.echoed) {
      items.push(describeDelete(deletion));
    }
  }
  for (const action of outbox.actions) {
    if (!action.echoed) {
      items.push(describeAction(action));
    }
  }
  for (const entry of outbox.body) {
    if (!entry.echoed) {
      items.push(describeBody(entry));
    }
  }
  for (const rest of rests) {
    items.push(describeRest(rest));
  }
  return items;
}

export function clearItemError(outbox: Outbox, id: string, now = Date.now()): Outbox {
  if (id.startsWith("set:")) {
    const clientId = id.slice("set:".length);
    return {
      ...outbox,
      sets: outbox.sets.map((set) => (set.clientId === clientId ? clearError(set, now) : set)),
    };
  }
  if (id.startsWith("edit:")) {
    const editId = id.slice("edit:".length);
    return {
      ...outbox,
      edits: outbox.edits.map((edit) => (edit.editId === editId ? clearError(edit, now) : edit)),
    };
  }
  if (id.startsWith("delete:")) {
    const deleteId = id.slice("delete:".length);
    return {
      ...outbox,
      deletes: outbox.deletes.map((deletion) =>
        deletion.deleteId === deleteId ? clearError(deletion, now) : deletion,
      ),
    };
  }
  if (id.startsWith("action:")) {
    const actionId = id.slice("action:".length);
    return {
      ...outbox,
      actions: outbox.actions.map((action) =>
        action.actionId === actionId ? clearError(action, now) : action,
      ),
    };
  }
  if (id.startsWith("body:")) {
    const clientId = id.slice("body:".length);
    return {
      ...outbox,
      body: outbox.body.map((entry) => (entry.clientId === clientId ? clearError(entry, now) : entry)),
    };
  }
  return outbox;
}

export function clearAllErrors(outbox: Outbox, now = Date.now()): Outbox {
  return {
    ...outbox,
    sets: outbox.sets.map((set) => clearError(set, now)),
    edits: outbox.edits.map((edit) => clearError(edit, now)),
    deletes: outbox.deletes.map((deletion) => clearError(deletion, now)),
    actions: outbox.actions.map((action) => clearError(action, now)),
    body: outbox.body.map((entry) => clearError(entry, now)),
  };
}

/**
 * Drops one queued change and records a tombstone so another tab cannot
 * restore it. The caller must already have confirmed.
 */
export function discardPendingItem(outbox: Outbox, id: string): Outbox {
  for (const kind of ["set", "edit", "delete", "action", "body"] as const) {
    if (id.startsWith(`${kind}:`)) {
      return dropQueued(outbox, [{ kind, id: id.slice(kind.length + 1) }]);
    }
  }
  return outbox;
}

function describeSet(set: PendingSet): PendingItem {
  const label = `${set.set.exerciseName} ${formatSetShort(set.set)}`;
  const when = clock(set.set.loggedAt);
  const saved = set.ackedSetId !== null || set.echoedRevision !== null;
  return {
    id: `set:${set.clientId}`,
    title: saved ? `Unsent edit to ${set.set.exerciseName}` : label,
    detail: saved ? `${label}, logged ${when}` : `Logged ${when}`,
    lost: saved
      ? `${label}, logged ${when}. Discarding drops this unsent edit. The last saved version stays in your history.`
      : `${label}, logged ${when}. Discarding removes it from this phone. It has not been saved.`,
    failed: set.syncError !== null,
    error: set.syncError,
  };
}

function describeRemoval(set: PendingSet): PendingItem {
  const label = `${set.set.exerciseName} ${formatSetShort(set.set)}`;
  return {
    id: `set:${set.clientId}`,
    title: `Remove ${set.set.exerciseName}`,
    detail: label,
    lost: `${label}. Discarding keeps this set. The removal will not be sent.`,
    failed: set.syncError !== null,
    error: set.syncError,
  };
}

function describeEdit(edit: PendingEdit): PendingItem {
  const label = formatSetShort(edit);
  return {
    id: `edit:${edit.editId}`,
    title: "Unsent edit to a saved set",
    detail: label,
    lost: `${label}. Discarding drops this edit. The last saved version stays in your history.`,
    failed: edit.syncError !== null,
    error: edit.syncError,
  };
}

function describeDelete(deletion: PendingDelete): PendingItem {
  return {
    id: `delete:${deletion.deleteId}`,
    title: "Delete a saved set",
    detail: "Waiting to remove it from history",
    lost: "Discarding keeps that set in your history. The delete will not be sent.",
    failed: deletion.syncError !== null,
    error: deletion.syncError,
  };
}

function describeAction(action: PendingAction): PendingItem {
  const title =
    action.kind === "complete"
      ? "Finish workout"
      : action.kind === "discard"
        ? "Discard empty workout"
        : "Keep workout open";
  const when = clock(action.requestedAt);
  const note = action.note ? ` Note: ${action.note}.` : "";
  return {
    id: `action:${action.actionId}`,
    title,
    detail: action.note ? action.note : when,
    lost:
      action.kind === "complete"
        ? `Finishing this workout at ${when}.${note} Discarding leaves it unfinished and drops the note and end time.`
        : action.kind === "discard"
          ? `Discarding this request keeps the empty workout. Nothing already logged is removed.`
          : `Discarding this request does not mark the workout as still going.`,
    failed: action.syncError !== null,
    error: action.syncError,
  };
}

function describeBody(entry: PendingBody): PendingItem {
  const parts: string[] = [];
  if (entry.weightLb !== null) {
    parts.push(`${entry.weightLb} lb`);
  }
  if (entry.bodyFatPct !== null) {
    parts.push(`${entry.bodyFatPct}% fat`);
  }
  const label = parts.length > 0 ? parts.join(", ") : "Body measurement";
  const when = clock(entry.loggedAt);
  return {
    id: `body:${entry.clientId}`,
    title: label,
    detail: `Logged ${when}`,
    lost: `${label}, logged ${when}. Discarding removes it from this phone. It has not been saved.`,
    failed: entry.syncError !== null,
    error: entry.syncError,
  };
}

function describeRest(rest: PendingRest): PendingItem {
  const seconds = rest.restSeconds === null ? "cleared" : `${rest.restSeconds} seconds`;
  return {
    id: `rest:${rest.name}`,
    title: `Rest for ${rest.name}`,
    detail: seconds,
    lost: `Rest for ${rest.name} (${seconds}). Discarding drops this change. The saved rest stays as it is.`,
    failed: false,
    error: null,
  };
}

function clock(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) {
    return "an unknown time";
  }
  return new Date(ms).toISOString().slice(0, 16).replace("T", " ") + " UTC";
}
