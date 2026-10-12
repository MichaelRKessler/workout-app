import assert from "node:assert/strict";
import test from "node:test";
import { loadPendingRests, queueRest } from "../lib/exerciseRest.ts";
import type { SetLine } from "../lib/groupSets.ts";
import { holdChanges, prepareBatch, splitBatch } from "../lib/offline/batch.ts";
import { CLOCK_READING_MAX_ROUND_TRIP_MS, clockReading } from "../lib/offline/clock.ts";
import { isPhoneClientId, resolveDocumentId } from "../lib/offline/documentId.ts";
import { withQueueLock } from "../lib/offline/lock.ts";
import { mergeOutboxes } from "../lib/offline/merge.ts";
import {
  clearItemError,
  discardPendingItem,
  listPendingItems,
} from "../lib/offline/pendingItems.ts";
import { RETRY_BASE_MS, RETRY_CAP_MS, nextRetryDelay } from "../lib/offline/retry.ts";
import {
  applySyncResult,
  batchHasWork,
  dropQueued,
  editPendingSet,
  emptyOutbox,
  enqueueBody,
  enqueueSets,
  mergeVisibleSets,
  nextBatch,
  parseOutbox,
  pendingChangeCount,
  queueAction,
  queueDelete,
  queueEdit,
  reconcileOutbox,
  recordClock,
  releaseOpenSession,
  removePendingBody,
  repairOpenSession,
  resolveSessionClientId,
  type Outbox,
  type PendingEdit,
  type SyncResult,
} from "../lib/offline/outbox.ts";
import {
  OfflineStorageError,
  clearOfflineStorage,
  guardStore,
  loadOutbox,
  peekOutboxRaw,
  resumeOfflineWrites,
  saveCachedAccess,
  saveOutbox,
  type KeyValueStore,
} from "../lib/offline/storage.ts";

const NOW = 1_700_000_000_000;
const EMAIL = "lifter@example.com";
const SERVER_ID = "j57abcdefghjkmnpqrstvwxyz0123456";

function memoryStore(): KeyValueStore {
  const values = new Map<string, string>();
  return {
    get: (key) => values.get(key) ?? null,
    set: (key, value) => {
      values.set(key, value);
    },
    remove: (key) => {
      values.delete(key);
    },
    keys: () => [...values.keys()],
  };
}

function addBench(outbox: Outbox, clientId: string, weightLb = 135) {
  return enqueueSets(outbox, {
    placement: "open",
    sessionId: null,
    sessionClientId: "sessionclient",
    sessionStartedAt: NOW,
    note: null,
    now: NOW,
    sets: [
      {
        clientId,
        exerciseName: "Bench press",
        reps: 10,
        weightLb,
        durationSec: null,
        distanceM: null,
        rpe: null,
      },
    ],
  }).outbox;
}

/** Mirrors OfflineSync's persist: merge this tab's queue into the stored one, then save. */
function persist(store: KeyValueStore, local: Outbox): Outbox {
  const merged = mergeOutboxes(loadOutbox(store, EMAIL), local);
  saveOutbox(store, EMAIL, merged);
  return merged;
}

function savedSetEdit(editId: string, weightLb: number): Omit<PendingEdit, "syncError" | "echoed"> {
  return {
    editId,
    setId: SERVER_ID,
    reps: 5,
    weightLb,
    durationSec: null,
    distanceM: null,
    calories: null,
    rpe: null,
  };
}

function weighIn(clientId: string) {
  return {
    clientId,
    loggedAt: NOW,
    weightLb: 180,
    bodyFatPct: null,
    waistCm: null,
    chestCm: null,
    armCm: null,
    hipsCm: null,
    thighCm: null,
    note: null,
  };
}

function serverBench(weightLb: number, clientId: string | null = null): SetLine & { clientId: string | null } {
  return {
    _id: SERVER_ID,
    exerciseId: "exercise1",
    exerciseName: "Bench press",
    reps: 5,
    weightLb,
    durationSec: null,
    distanceM: null,
    rpe: null,
    loggedAt: NOW,
    clientId,
  };
}

function setResult(
  clientId: string,
  revision: number,
  status: SyncResult["sets"][number]["status"],
  setId: string | null,
  message: string | null = null,
): SyncResult {
  return {
    sets: [
      {
        clientId,
        revision,
        status,
        setId,
        sessionId: setId ? "session1" : null,
        personalRecord: null,
        message,
      },
    ],
    edits: [],
    deletes: [],
    actions: [],
    body: [],
  };
}

test("migration copies a legacy queue and deletes it only after the new key matches", () => {
  const store = memoryStore();
  const queued = addBench(emptyOutbox(), "client0001");
  store.set("workout-offline:outbox:lifter@example.com", JSON.stringify(queued));
  const loaded = loadOutbox(store, "Lifter@example.com");
  assert.equal(loaded.sets[0]?.clientId, "client0001");
  assert.equal(store.get("workout-offline:outbox:lifter@example.com"), null);
  assert.match(peekOutboxRaw(store, "lifter@example.com") ?? "", /client0001/);
});

test("a write that does not read back leaves the old queue in place", () => {
  const values = new Map<string, string>();
  const store: KeyValueStore = {
    get: (key) => values.get(key) ?? null,
    set: (key, value) => {
      values.set(key, `${value}!`);
    },
    remove: (key) => {
      values.delete(key);
    },
    keys: () => [...values.keys()],
  };
  const legacy = "workout-offline:outbox:lifter@example.com";
  values.set(legacy, JSON.stringify(addBench(emptyOutbox(), "client0001")));
  loadOutbox(store, "lifter@example.com");
  assert.equal(values.has(legacy), true);
});

test("a storage failure while moving does not delete the old queue or return an empty one", () => {
  const values = new Map<string, string>();
  values.set(
    "workout-offline:outbox:lifter@example.com",
    JSON.stringify(addBench(emptyOutbox(), "client0001")),
  );
  const store = guardStore({
    get: (key) => values.get(key) ?? null,
    set: () => {
      throw new Error("QuotaExceededError");
    },
    remove: (key) => {
      values.delete(key);
    },
    keys: () => [...values.keys()],
  });
  const loaded = loadOutbox(store, "lifter@example.com");
  assert.equal(loaded.sets[0]?.clientId, "client0001");
  assert.match(values.get("workout-offline:outbox:lifter@example.com") ?? "", /client0001/);
});

test("a blocked store still reports a storage error instead of an empty queue", () => {
  const store = guardStore({
    get: () => {
      throw new Error("SecurityError");
    },
    set: () => {
      throw new Error("SecurityError");
    },
    remove: () => {
      throw new Error("SecurityError");
    },
    keys: () => {
      throw new Error("SecurityError");
    },
  });
  assert.throws(() => loadOutbox(store, "lifter@example.com"), OfflineStorageError);
});

test("global rest times follow the cached account, not whoever is loading", () => {
  const store = memoryStore();
  saveCachedAccess(store, {
    email: "a@example.com",
    name: "A",
    allowed: true,
    isAdmin: false,
    request: null,
  });
  store.set(
    "workout-offline:pending-rest",
    JSON.stringify([{ name: "bench press", restSeconds: 90 }]),
  );
  const loadedAsOther = loadPendingRests(store, "b@example.com");
  assert.equal(loadedAsOther.length, 0);
  assert.equal(store.get("workout-offline:pending-rest"), null);
  assert.match(store.get("workout-account:a@example.com:pending-rest") ?? "", /bench press/);
  assert.equal(store.get("workout-account:b@example.com:pending-rest"), null);
  queueRest(store, "a@example.com", "squat", 120);
  assert.match(store.get("workout-account:a@example.com:pending-rest") ?? "", /squat/);
});

test("signing out clears only that account's queue", () => {
  const store = memoryStore();
  saveOutbox(store, "a@example.com", addBench(emptyOutbox(), "clientA"));
  saveOutbox(store, "b@example.com", addBench(emptyOutbox(), "clientB"));
  try {
    clearOfflineStorage(store, "a@example.com");
    assert.equal(loadOutbox(store, "a@example.com").sets.length, 0);
    assert.equal(loadOutbox(store, "b@example.com").sets[0]?.clientId, "clientB");
  } finally {
    resumeOfflineWrites();
  }
});

test("two tabs keep both sets, and a drop blocks a stale copy", () => {
  const left = addBench(emptyOutbox(), "client0001", 100);
  const right = addBench(emptyOutbox(), "client0002", 200);
  const together = mergeOutboxes(left, right);
  assert.deepEqual(
    together.sets.map((set) => set.clientId).sort(),
    ["client0001", "client0002"],
  );

  const older = addBench(emptyOutbox(), "client0001", 100);
  const newer = addBench(emptyOutbox(), "client0001", 100);
  newer.sets[0]!.revision = 3;
  newer.sets[0]!.set.weightLb = 225;
  assert.equal(mergeOutboxes(older, newer).sets[0]?.set.weightLb, 225);
  assert.equal(mergeOutboxes(older, newer).sets[0]?.revision, 3);

  const dropped = discardPendingItem(newer, "set:client0001");
  const restored = mergeOutboxes(dropped, older);
  assert.equal(restored.sets.length, 0);
});

test("a past workout gets a fresh id and a finished open id is retired", () => {
  const open = addBench(emptyOutbox(), "client0001");
  assert.equal(open.openSessionClientId, "sessionclient");
  const past = resolveSessionClientId(
    open,
    { sessionId: null, placement: "completed" },
    () => "freshid0001",
  );
  assert.equal(past, "freshid0001");

  const released = releaseOpenSession(open);
  assert.equal(released.openSessionClientId, null);
  assert.ok(released.closedSessionClientIds.includes("sessionclient"));

  const stale = repairOpenSession({ ...emptyOutbox(), openSessionClientId: "sessionclient" });
  assert.equal(stale.openSessionClientId, null);
});

test("one bad batch item is split out, and a phone id is held back", () => {
  const two = addBench(addBench(emptyOutbox(), "client0001"), "client0002");
  const parts = splitBatch(nextBatch(two));
  assert.ok(parts);
  assert.equal(parts[0].sets.length, 1);
  assert.equal(parts[1].sets.length, 1);
  assert.equal(splitBatch(nextBatch(addBench(emptyOutbox(), "onlyone01"))), null);

  const phoneId = "ab".repeat(16);
  assert.equal(phoneId.length, 32);
  assert.equal(isPhoneClientId(phoneId), true);
  const crockford = `c${"0123456789abcdefghjkmnpqrstvwxy"}`;
  assert.equal(crockford.length, 32);
  assert.equal(isPhoneClientId(crockford), false);
  assert.equal(resolveDocumentId(crockford, new Map()), crockford);

  const queued = queueEdit(emptyOutbox(), {
    editId: "edit000001",
    setId: phoneId,
    reps: 5,
    weightLb: 100,
    durationSec: null,
    distanceM: null,
    calories: null,
    rpe: null,
  });
  const held = prepareBatch(queued, nextBatch(queued));
  assert.equal(held.batch.edits.length, 0);
  assert.equal(held.held.length, 1);
  const learned = {
    ...queued,
    knownSetIds: [{ clientId: phoneId, setId: "serverSetId0001" }],
  };
  const ready = prepareBatch(learned, nextBatch(learned));
  assert.equal(ready.batch.edits[0]?.setId, "serverSetId0001");
  const marked = holdChanges(queued, held.held);
  assert.match(marked.edits[0]?.syncError ?? "", /held back/);
});

test("retries back off, and discard says what will be lost", () => {
  assert.equal(nextRetryDelay(0), RETRY_BASE_MS * 2);
  assert.equal(nextRetryDelay(RETRY_BASE_MS), RETRY_BASE_MS * 2);
  assert.equal(nextRetryDelay(RETRY_CAP_MS), RETRY_CAP_MS);

  const queued = addBench(emptyOutbox(), "client0001");
  const [item] = listPendingItems(queued, []);
  assert.match(item?.lost ?? "", /has not been saved/);
  const discarded = discardPendingItem(queued, "set:client0001");
  assert.equal(discarded.sets.length, 0);
  assert.equal(mergeOutboxes(discarded, queued).sets.length, 0);
});

test("the queue lock runs the critical section and still runs without locks", async () => {
  let current = 0;
  let overlap = 0;
  let tail = Promise.resolve();
  const locks = {
    async request<T>(_name: string, callback: () => Promise<T>): Promise<T> {
      const previous = tail;
      let release = () => {};
      tail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      current += 1;
      overlap = Math.max(overlap, current);
      try {
        return await callback();
      } finally {
        current -= 1;
        release();
      }
    },
  };
  await Promise.all([
    withQueueLock("a@example.com", async () => {
      await Promise.resolve();
    }, locks),
    withQueueLock("a@example.com", async () => {
      await Promise.resolve();
    }, locks),
  ]);
  assert.equal(overlap, 1);
  assert.equal(await withQueueLock("a@example.com", async () => 7, null), 7);
});

test("a discarded weigh-in stays discarded after the queues merge", () => {
  const store = memoryStore();
  let tab = persist(store, enqueueBody(emptyOutbox(), weighIn("body0000001")));
  tab = persist(store, removePendingBody(tab, "body0000001"));
  assert.equal(tab.body.length, 0);
  assert.equal(nextBatch(tab).body.length, 0);

  const otherTab = enqueueBody(emptyOutbox(), weighIn("body0000001"));
  assert.equal(persist(store, otherTab).body.length, 0);
});

test("a second offline edit of a saved set replaces the first for good", () => {
  const store = memoryStore();
  const firstOnly = queueEdit(emptyOutbox(), savedSetEdit("edit0000001", 105));
  let tab = persist(store, firstOnly);
  tab = persist(store, queueEdit(tab, savedSetEdit("edit0000002", 110)));
  assert.deepEqual(tab.edits.map((edit) => edit.editId), ["edit0000002"]);
  assert.equal(mergeOutboxes(firstOnly, tab).edits.length, 1);

  tab = applySyncResult(tab, {
    sets: [],
    edits: [{ editId: "edit0000002", status: "applied", personalRecord: null, message: null }],
    deletes: [],
    actions: [],
    body: [],
  }).outbox;
  const server = [serverBench(110)];
  tab = persist(store, reconcileOutbox(tab, server));
  assert.equal(tab.edits.length, 0);
  const visible = mergeVisibleSets(server, tab, { kind: "session", sessionId: "session1" });
  assert.equal(visible[0]?.weightLb, 110);
  assert.equal(visible[0]?.pending, false);
});

test("a delete or a newer finish replaces older queued items for good", () => {
  const withEdit = queueEdit(emptyOutbox(), savedSetEdit("edit0000001", 105));
  const firstDelete = queueDelete(withEdit, "delete000001", SERVER_ID);
  const secondDelete = queueDelete(firstDelete, "delete000002", SERVER_ID);
  const merged = mergeOutboxes(mergeOutboxes(withEdit, firstDelete), secondDelete);
  assert.deepEqual(merged.edits, []);
  assert.deepEqual(merged.deletes.map((item) => item.deleteId), ["delete000002"]);

  const finish = {
    actionId: "action000001",
    sessionId: null,
    sessionClientId: "sessionclient",
    kind: "complete" as const,
    note: "first",
    requestedAt: NOW,
  };
  const first = queueAction(emptyOutbox(), finish);
  const second = queueAction(first, { ...finish, actionId: "action000002", note: "second" });
  assert.deepEqual(mergeOutboxes(first, second).actions.map((action) => action.note), ["second"]);
});

test("items dropped after a rejection do not come back as failed items", () => {
  let tab = addBench(emptyOutbox(), "client0001");
  tab = queueEdit(tab, savedSetEdit("edit0000001", 105));
  tab = queueDelete(tab, "delete000001", "j57zzzzzzzzzzzzzzzzzzzzzzzzzzzzz");
  const stored = tab;
  const dropped = dropQueued(tab, [
    { kind: "set", id: "client0001" },
    { kind: "edit", id: "edit0000001" },
    { kind: "delete", id: "delete000001" },
  ]);
  const merged = mergeOutboxes(stored, dropped);
  assert.equal(merged.sets.length, 0);
  assert.equal(merged.edits.length, 0);
  assert.equal(merged.deletes.length, 0);
  assert.deepEqual(listPendingItems(merged, []), []);
});

test("a set deleted on the server leaves the queue instead of staying pending", () => {
  let tab = addBench(emptyOutbox(), "client0001");
  tab = applySyncResult(tab, setResult("client0001", 1, "applied", SERVER_ID)).outbox;
  tab = editPendingSet(tab, "client0001", { weightLb: 110 });
  const beforeAnswer = tab;
  tab = applySyncResult(tab, setResult("client0001", 2, "removed", null)).outbox;
  assert.equal(tab.sets.length, 0);
  assert.equal(pendingChangeCount(tab), 0);
  assert.equal(mergeVisibleSets([], tab, { kind: "open", sessionId: "session1" }).length, 0);
  assert.equal(mergeOutboxes(beforeAnswer, tab).sets.length, 0);

  // An older server answered "applied" with no set id. That copy is cleared on the next reconcile.
  const ghost = applySyncResult(beforeAnswer, setResult("client0001", 2, "applied", null)).outbox;
  assert.equal(mergeVisibleSets([], ghost, { kind: "open", sessionId: "session1" }).length, 1);
  const cleared = reconcileOutbox(ghost, []);
  assert.equal(cleared.sets.length, 0);
  assert.equal(mergeOutboxes(ghost, cleared).sets.length, 0);
});

test("with two tabs, a rejection in one survives the other's merge, and a later retry wins", () => {
  const store = memoryStore();
  saveOutbox(store, EMAIL, addBench(emptyOutbox(), "client0001"));
  let tabA = loadOutbox(store, EMAIL);
  let tabB = loadOutbox(store, EMAIL);
  tabA = applySyncResult(tabA, setResult("client0001", 1, "rejected", null, "bad"), NOW + 1_000).outbox;
  tabA = persist(store, tabA);
  tabB = persist(store, tabB);
  tabA = persist(store, tabA);
  for (const tab of [tabA, tabB]) {
    assert.equal(tab.sets[0]?.syncError, "bad");
    assert.equal(nextBatch(tab).sets.length, 0);
    assert.equal(listPendingItems(tab, [])[0]?.failed, true);
  }

  tabB = persist(store, clearItemError(tabB, "set:client0001", NOW + 2_000));
  tabA = persist(store, tabA);
  assert.equal(tabA.sets[0]?.syncError, null);
  assert.equal(nextBatch(tabA).sets.length, 1);
});

test("a rejected finish and weigh-in keep their errors over a stale copy", () => {
  let outbox = queueAction(emptyOutbox(), {
    actionId: "action000001",
    sessionId: null,
    sessionClientId: "sessionclient",
    kind: "complete",
    note: null,
    requestedAt: NOW,
  });
  outbox = enqueueBody(outbox, weighIn("body0000001"));
  const stale = outbox;
  const rejected = applySyncResult(
    outbox,
    {
      sets: [],
      edits: [],
      deletes: [],
      actions: [
        { actionId: "action000001", status: "rejected", sessionId: null, message: "Log a set first" },
      ],
      body: [{ clientId: "body0000001", status: "rejected", entryId: null, message: "Bad date" }],
    },
    NOW,
  ).outbox;
  const merged = mergeOutboxes(rejected, stale);
  assert.equal(merged.actions[0]?.syncError, "Log a set first");
  assert.equal(merged.body[0]?.syncError, "Bad date");
  assert.equal(batchHasWork(nextBatch(merged)), false);
});

test("an error saved before errors were timed is kept over a copy without one", () => {
  const fresh = addBench(emptyOutbox(), "client0001");
  const legacy = parseOutbox(JSON.parse(JSON.stringify({ ...fresh, sets: [{ ...fresh.sets[0], syncError: "bad" }] })));
  assert.equal(legacy.sets[0]?.errorChangedAt, undefined);
  assert.equal(mergeOutboxes(legacy, fresh).sets[0]?.syncError, "bad");
  assert.equal(mergeOutboxes(fresh, legacy).sets[0]?.syncError, "bad");
});

test("a clock reading uses the middle of a quick round trip and is kept with the queue", () => {
  assert.deepEqual(clockReading(1_000, 1_400, 5_200), { offsetMs: 4_000, measuredAt: 1_400 });
  assert.equal(clockReading(1_000, 1_001 + CLOCK_READING_MAX_ROUND_TRIP_MS, 5_000), null);
  assert.equal(clockReading(1_000, 900, 5_000), null);
  assert.equal(clockReading(1_000, 1_100, undefined), null);

  const store = memoryStore();
  const fast = { offsetMs: -3_600_000, measuredAt: NOW };
  const stored = recordClock(addBench(emptyOutbox(), "client0001"), fast);
  saveOutbox(store, EMAIL, stored);
  assert.deepEqual(loadOutbox(store, EMAIL).clock, fast);
  assert.equal(parseOutbox({ sets: [] }).clock, null);

  const later = recordClock(emptyOutbox(), { offsetMs: 5, measuredAt: NOW + 1 });
  assert.equal(mergeOutboxes(later, stored).clock?.offsetMs, 5);
  assert.equal(mergeOutboxes(stored, later).clock?.offsetMs, 5);
  assert.equal(recordClock(later, fast).clock?.offsetMs, 5);
});
