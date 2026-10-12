import { isPhoneClientId, resolveDocumentId } from "./documentId.ts";
import {
  knownServerIds,
  type Outbox,
  type PendingDelete,
  type PendingEdit,
  type SyncBatch,
} from "./outbox.ts";

export type HeldChange = {
  kind: "edit" | "delete";
  id: string;
  message: string;
};

const HELD_MESSAGE =
  "This change is missing its saved id, so it was held back. Retry once the set has synced, or discard it.";

type FlatItem =
  | { kind: "set"; index: number }
  | { kind: "edit"; index: number }
  | { kind: "delete"; index: number }
  | { kind: "action"; index: number }
  | { kind: "body"; index: number };

/** Splits a failed batch in half so one bad item does not fail the rest. */
export function splitBatch(batch: SyncBatch): [SyncBatch, SyncBatch] | null {
  const items = flatten(batch);
  if (items.length < 2) {
    return null;
  }
  const mid = Math.ceil(items.length / 2);
  return [take(batch, items.slice(0, mid)), take(batch, items.slice(mid))];
}

/**
 * Rewrites edits and deletes onto server ids. A phone client id with no
 * learned server id is held back instead of being sent.
 */
export function prepareBatch(
  outbox: Outbox,
  batch: SyncBatch,
): { batch: SyncBatch; held: HeldChange[] } {
  const known = knownServerIds(outbox);
  const held: HeldChange[] = [];
  const edits: PendingEdit[] = [];
  const deletes: PendingDelete[] = [];

  for (const edit of batch.edits) {
    const setId = resolveDocumentId(edit.setId, known);
    if (!setId) {
      held.push({ kind: "edit", id: edit.editId, message: HELD_MESSAGE });
      continue;
    }
    edits.push(setId === edit.setId ? edit : { ...edit, setId });
  }
  for (const deletion of batch.deletes) {
    const setId = resolveDocumentId(deletion.setId, known);
    if (!setId) {
      held.push({ kind: "delete", id: deletion.deleteId, message: HELD_MESSAGE });
      continue;
    }
    deletes.push(setId === deletion.setId ? deletion : { ...deletion, setId });
  }

  return {
    batch: {
      ...batch,
      sets: batch.sets.map((set) => ({
        ...set,
        sessionId: set.sessionId && isPhoneClientId(set.sessionId) ? null : set.sessionId,
      })),
      edits,
      deletes,
    },
    held,
  };
}

export function holdChanges(outbox: Outbox, held: HeldChange[]): Outbox {
  if (held.length === 0) {
    return outbox;
  }
  const edits = new Map(held.filter((item) => item.kind === "edit").map((item) => [item.id, item.message]));
  const deletes = new Map(
    held.filter((item) => item.kind === "delete").map((item) => [item.id, item.message]),
  );
  return {
    ...outbox,
    edits: outbox.edits.map((edit) => {
      const message = edits.get(edit.editId);
      return message && !edit.echoed ? { ...edit, syncError: message } : edit;
    }),
    deletes: outbox.deletes.map((deletion) => {
      const message = deletes.get(deletion.deleteId);
      return message && !deletion.echoed ? { ...deletion, syncError: message } : deletion;
    }),
  };
}

function flatten(batch: SyncBatch): FlatItem[] {
  const items: FlatItem[] = [];
  batch.sets.forEach((_, index) => items.push({ kind: "set", index }));
  batch.edits.forEach((_, index) => items.push({ kind: "edit", index }));
  batch.deletes.forEach((_, index) => items.push({ kind: "delete", index }));
  batch.actions.forEach((_, index) => items.push({ kind: "action", index }));
  batch.body.forEach((_, index) => items.push({ kind: "body", index }));
  return items;
}

function take(batch: SyncBatch, items: FlatItem[]): SyncBatch {
  const next: SyncBatch = { sets: [], edits: [], deletes: [], actions: [], body: [] };
  for (const item of items) {
    if (item.kind === "set") {
      const set = batch.sets[item.index];
      if (set) {
        next.sets.push(set);
      }
    } else if (item.kind === "edit") {
      const edit = batch.edits[item.index];
      if (edit) {
        next.edits.push(edit);
      }
    } else if (item.kind === "delete") {
      const deletion = batch.deletes[item.index];
      if (deletion) {
        next.deletes.push(deletion);
      }
    } else if (item.kind === "action") {
      const action = batch.actions[item.index];
      if (action) {
        next.actions.push(action);
      }
    } else {
      const entry = batch.body[item.index];
      if (entry) {
        next.body.push(entry);
      }
    }
  }
  return next;
}
