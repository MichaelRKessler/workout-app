import { newerClock } from "./clock.ts";
import {
  repairOpenSession,
  type DroppedItem,
  type ErrorState,
  type KnownSetId,
  type Outbox,
  type PendingAction,
  type PendingBody,
  type PendingDelete,
  type PendingEdit,
  type PendingSet,
} from "./outbox.ts";

/**
 * Unions two copies of the queue. The same item keeps the higher revision.
 * A drop recorded by either tab hides that revision and anything older, so a
 * stale tab cannot restore a set the other tab already finished or discarded.
 * Between copies at the same point, the one whose error changed last wins.
 */
export function mergeOutboxes(left: Outbox, right: Outbox): Outbox {
  const dropped = mergeDrops(left.dropped, right.dropped);
  const hidden = dropIndex(dropped);
  const closed = uniqueStrings([
    ...left.closedSessionClientIds,
    ...right.closedSessionClientIds,
  ]).slice(-200);

  return repairOpenSession({
    openSessionClientId: mergeOpenId(left, right, new Set(closed)),
    closedSessionClientIds: closed,
    knownSetIds: mergeKnown(left.knownSetIds, right.knownSetIds),
    dropped,
    sets: mergeSets(left.sets, right.sets, hidden),
    edits: mergeEdits(left.edits, right.edits, hidden),
    deletes: mergeDeletes(left.deletes, right.deletes, hidden),
    actions: mergeActions(left.actions, right.actions, hidden),
    body: mergeBody(left.body, right.body, hidden),
    clock: newerClock(left.clock, right.clock),
  });
}

function mergeOpenId(left: Outbox, right: Outbox, closed: Set<string>): string | null {
  const leftId = openId(left.openSessionClientId, closed);
  const rightId = openId(right.openSessionClientId, closed);
  if (leftId === rightId) {
    return leftId;
  }
  if (!leftId) {
    return rightId;
  }
  if (!rightId) {
    return leftId;
  }
  return newestActivity(right, rightId) >= newestActivity(left, leftId) ? rightId : leftId;
}

function openId(id: string | null, closed: Set<string>): string | null {
  if (!id || closed.has(id)) {
    return null;
  }
  return id;
}

function newestActivity(outbox: Outbox, sessionClientId: string): number {
  let newest = 0;
  for (const set of outbox.sets) {
    if (set.sessionClientId === sessionClientId && set.set.loggedAt > newest) {
      newest = set.set.loggedAt;
    }
  }
  return newest;
}

function mergeSets(left: PendingSet[], right: PendingSet[], hidden: Map<string, number>): PendingSet[] {
  const byId = new Map<string, PendingSet>();
  for (const set of [...left, ...right]) {
    const current = byId.get(set.clientId);
    byId.set(set.clientId, current ? preferSet(current, set) : set);
  }
  return [...byId.values()].filter((set) => !isHidden(hidden, "set", set.clientId, set.revision));
}

function preferSet(left: PendingSet, right: PendingSet): PendingSet {
  if (left.revision !== right.revision) {
    return left.revision > right.revision ? left : right;
  }
  if (left.removed !== right.removed) {
    return left.removed ? left : right;
  }
  const leftEcho = left.echoedRevision ?? -1;
  const rightEcho = right.echoedRevision ?? -1;
  if (leftEcho !== rightEcho) {
    return leftEcho > rightEcho ? left : right;
  }
  return newerErrorState(left, right) ?? right;
}

/**
 * The copy whose error was set or cleared last. A copy without a time is
 * older. On a tie the copy with an error wins, so a rejection stays visible
 * instead of being resent forever.
 */
function newerErrorState<T extends ErrorState>(left: T, right: T): T | null {
  const leftAt = left.errorChangedAt ?? 0;
  const rightAt = right.errorChangedAt ?? 0;
  if (leftAt !== rightAt) {
    return leftAt > rightAt ? left : right;
  }
  if (left.syncError && !right.syncError) {
    return left;
  }
  if (right.syncError && !left.syncError) {
    return right;
  }
  return null;
}

function mergeEdits(
  left: PendingEdit[],
  right: PendingEdit[],
  hidden: Map<string, number>,
): PendingEdit[] {
  return mergeRows(left, right, (item) => item.editId, preferAcked, hidden, "edit", 1);
}

function mergeDeletes(
  left: PendingDelete[],
  right: PendingDelete[],
  hidden: Map<string, number>,
): PendingDelete[] {
  return mergeRows(left, right, (item) => item.deleteId, preferAcked, hidden, "delete", 1);
}

function mergeActions(
  left: PendingAction[],
  right: PendingAction[],
  hidden: Map<string, number>,
): PendingAction[] {
  const byId = new Map<string, PendingAction>();
  for (const action of [...left, ...right]) {
    const current = byId.get(action.actionId);
    if (!current || preferAction(current, action) === action) {
      byId.set(action.actionId, action);
    }
  }
  return [...byId.values()].filter((action) => !isHidden(hidden, "action", action.actionId, 1));
}

function preferAction(left: PendingAction, right: PendingAction): PendingAction {
  if (left.echoed !== right.echoed) {
    return left.echoed ? left : right;
  }
  const newer = newerErrorState(left, right);
  if (newer) {
    return newer;
  }
  return right.requestedAt >= left.requestedAt ? right : left;
}

function mergeBody(
  left: PendingBody[],
  right: PendingBody[],
  hidden: Map<string, number>,
): PendingBody[] {
  return mergeRows(left, right, (item) => item.clientId, preferAcked, hidden, "body", 1);
}

function mergeRows<T extends ErrorState & { echoed: boolean }>(
  left: T[],
  right: T[],
  idOf: (item: T) => string,
  prefer: (left: T, right: T) => T,
  hidden: Map<string, number>,
  kind: DroppedItem["kind"],
  revision: number,
): T[] {
  const byId = new Map<string, T>();
  for (const item of [...left, ...right]) {
    const id = idOf(item);
    const current = byId.get(id);
    byId.set(id, current ? prefer(current, item) : item);
  }
  return [...byId.values()].filter((item) => !isHidden(hidden, kind, idOf(item), revision));
}

function preferAcked<T extends ErrorState & { echoed: boolean }>(left: T, right: T): T {
  if (left.echoed !== right.echoed) {
    return left.echoed ? left : right;
  }
  return newerErrorState(left, right) ?? right;
}

function mergeKnown(left: KnownSetId[], right: KnownSetId[]): KnownSetId[] {
  const byClient = new Map<string, string>();
  for (const item of [...left, ...right]) {
    byClient.set(item.clientId, item.setId);
  }
  return [...byClient.entries()].slice(-1000).map(([clientId, setId]) => ({ clientId, setId }));
}

function mergeDrops(left: DroppedItem[], right: DroppedItem[]): DroppedItem[] {
  const byKey = new Map<string, DroppedItem>();
  for (const item of [...left, ...right]) {
    const key = `${item.kind}:${item.id}`;
    const current = byKey.get(key);
    if (!current || item.revision > current.revision) {
      byKey.set(key, item);
    }
  }
  return [...byKey.values()].slice(-2000);
}

function dropIndex(dropped: DroppedItem[]): Map<string, number> {
  const index = new Map<string, number>();
  for (const item of dropped) {
    index.set(`${item.kind}:${item.id}`, item.revision);
  }
  return index;
}

function isHidden(
  hidden: Map<string, number>,
  kind: DroppedItem["kind"],
  id: string,
  revision: number,
): boolean {
  const droppedAt = hidden.get(`${kind}:${id}`);
  return droppedAt !== undefined && revision <= droppedAt;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}
