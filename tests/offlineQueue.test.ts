import assert from "node:assert/strict";
import test from "node:test";
import { loadPendingRests, queueRest } from "../lib/exerciseRest.ts";
import { holdChanges, prepareBatch, splitBatch } from "../lib/offline/batch.ts";
import { isPhoneClientId, resolveDocumentId } from "../lib/offline/documentId.ts";
import { withQueueLock } from "../lib/offline/lock.ts";
import { mergeOutboxes } from "../lib/offline/merge.ts";
import {
  discardPendingItem,
  listPendingItems,
} from "../lib/offline/pendingItems.ts";
import { RETRY_BASE_MS, RETRY_CAP_MS, nextRetryDelay } from "../lib/offline/retry.ts";
import {
  emptyOutbox,
  enqueueSets,
  nextBatch,
  queueEdit,
  releaseOpenSession,
  repairOpenSession,
  resolveSessionClientId,
  type Outbox,
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
  assert.throws(() => loadOutbox(store, "lifter@example.com"), OfflineStorageError);
  assert.match(values.get("workout-offline:outbox:lifter@example.com") ?? "", /client0001/);
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
