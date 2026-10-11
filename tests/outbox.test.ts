import assert from "node:assert/strict";
import test from "node:test";
import { isOffline } from "../lib/offline/connectivity.ts";
import {
  OFFLINE_BATCH_LIMIT,
  applySyncResult,
  editPendingSet,
  emptyOutbox,
  enqueueSets,
  firstSyncError,
  mergeVisibleSets,
  nextBatch,
  parseOutbox,
  pendingChangeCount,
  queueAction,
  queueDelete,
  queueEdit,
  reconcileOutbox,
  removePendingSet,
  type Outbox,
} from "../lib/offline/outbox.ts";
import {
  clearOfflineStorage,
  loadOutbox,
  saveOutbox,
  type KeyValueStore,
} from "../lib/offline/storage.ts";
import type { SetLine } from "../lib/groupSets.ts";
import { fetchDecision, mayStoreResponse, NEVER_CACHE_PREFIXES } from "../lib/pwa/cachePolicy.ts";
import { serviceWorkerSource } from "../lib/pwa/serviceWorkerSource.ts";

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
  });
}

function serverSet(id: string, clientId: string | null, weightLb = 135): SetLine {
  return {
    _id: id,
    exerciseId: "exercise1",
    exerciseName: "Bench press",
    reps: 10,
    weightLb,
    durationSec: null,
    distanceM: null,
    rpe: null,
    loggedAt: NOW,
    clientId,
  };
}

test("enqueue stores a set once and keeps logged times unique", () => {
  const first = addBench(emptyOutbox(), "client0001");
  const second = addBench(first.outbox, "client0001", 185);
  const third = enqueueSets(second.outbox, {
    placement: "open",
    sessionId: null,
    sessionClientId: "sessionclient",
    sessionStartedAt: NOW,
    note: null,
    now: NOW,
    sets: [
      {
        clientId: "client0002",
        exerciseName: "Row",
        reps: 8,
        weightLb: 95,
        durationSec: null,
        distanceM: null,
        rpe: null,
        loggedAt: NOW,
      },
    ],
  });

  assert.deepEqual(second.clientIds, ["client0001"]);
  assert.equal(second.outbox.sets.length, 1);
  assert.equal(second.outbox.sets[0]?.set.weightLb, 135);
  assert.equal(third.outbox.sets[1]?.set.loggedAt, NOW + 1);
  assert.equal(third.outbox.openSessionClientId, "sessionclient");
});

test("editing and removing a pending set bumps the revision instead of dropping it", () => {
  const queued = addBench(emptyOutbox(), "client0001").outbox;
  const edited = editPendingSet(queued, "client0001", { weightLb: 155, reps: 8 });
  assert.equal(edited.sets[0]?.revision, 2);
  assert.equal(edited.sets[0]?.set.weightLb, 155);
  assert.equal(edited.sets[0]?.echoedRevision, null);

  const removed = removePendingSet(edited, "client0001");
  assert.equal(removed.sets[0]?.removed, true);
  assert.equal(removed.sets[0]?.revision, 3);
  assert.equal(nextBatch(removed).sets[0]?.removed, true);
});

test("a sync ack drops a removal and keeps a newer local edit", () => {
  const queued = addBench(emptyOutbox(), "client0001").outbox;
  const acked = applySyncResult(queued, {
    sets: [
      {
        clientId: "client0001",
        revision: 1,
        status: "applied",
        setId: "set1",
        sessionId: "session1",
        personalRecord: null,
        message: null,
      },
    ],
    edits: [],
    deletes: [],
    actions: [],
  });
  assert.equal(acked.outbox.sets[0]?.sessionId, "session1");
  assert.equal(acked.outbox.sets[0]?.echoedRevision, 1);

  const edited = editPendingSet(acked.outbox, "client0001", { weightLb: 185 });
  const staleAck = applySyncResult(edited, {
    sets: [
      {
        clientId: "client0001",
        revision: 1,
        status: "applied",
        setId: "set1",
        sessionId: "session1",
        personalRecord: null,
        message: null,
      },
    ],
    edits: [],
    deletes: [],
    actions: [],
  });
  assert.equal(staleAck.outbox.sets[0]?.revision, 2);
  assert.equal(staleAck.outbox.sets[0]?.set.weightLb, 185);
  assert.equal(staleAck.outbox.sets[0]?.echoedRevision, 1);
  assert.equal(nextBatch(staleAck.outbox).sets.length, 1);

  const removed = removePendingSet(staleAck.outbox, "client0001");
  const gone = applySyncResult(removed, {
    sets: [
      {
        clientId: "client0001",
        revision: removed.sets[0]?.revision ?? 0,
        status: "applied",
        setId: null,
        sessionId: "session1",
        personalRecord: null,
        message: null,
      },
    ],
    edits: [],
    deletes: [],
    actions: [],
  });
  assert.equal(gone.outbox.sets.length, 0);
});

test("a rejected set stays queued with the server message and is not retried", () => {
  const queued = addBench(emptyOutbox(), "client0001").outbox;
  const rejected = applySyncResult(queued, {
    sets: [
      {
        clientId: "client0001",
        revision: 1,
        status: "rejected",
        setId: null,
        sessionId: null,
        personalRecord: null,
        message: "Exercise name must be 1 to 80 characters",
      },
    ],
    edits: [],
    deletes: [],
    actions: [],
  });
  assert.equal(nextBatch(rejected.outbox).sets.length, 0);
  assert.equal(firstSyncError(rejected.outbox), "Exercise name must be 1 to 80 characters");
  const edited = editPendingSet(rejected.outbox, "client0001", { exerciseName: "Squat" });
  assert.equal(edited.sets[0]?.syncError, null);
  assert.equal(nextBatch(edited).sets.length, 1);
});

test("the batch sends sets before a finish and stops at the limit", () => {
  let outbox = emptyOutbox();
  for (let index = 0; index < OFFLINE_BATCH_LIMIT + 2; index += 1) {
    outbox = enqueueSets(outbox, {
      placement: "open",
      sessionId: "session1",
      sessionClientId: "sessionclient",
      sessionStartedAt: NOW,
      note: null,
      now: NOW + index,
      sets: [
        {
          clientId: `client${String(index).padStart(4, "0")}`,
          exerciseName: "Squat",
          reps: 5,
          weightLb: 200,
          durationSec: null,
          distanceM: null,
          rpe: null,
        },
      ],
    }).outbox;
  }
  outbox = queueAction(outbox, {
    actionId: "action0001",
    sessionId: "session1",
    sessionClientId: "sessionclient",
    kind: "complete",
    note: "done",
    requestedAt: NOW,
  });
  const batch = nextBatch(outbox);
  assert.equal(batch.sets.length, OFFLINE_BATCH_LIMIT);
  assert.equal(batch.actions.length, 0);
  const rest = nextBatch({
    ...outbox,
    sets: outbox.sets.map((set, index) =>
      index < OFFLINE_BATCH_LIMIT ? { ...set, echoedRevision: set.revision } : set,
    ),
  });
  assert.equal(rest.sets.length, 2);
  assert.equal(rest.actions.length, 1);
  assert.equal(rest.actions[0]?.kind, "complete");
});

test("visible sets show pending work once and hide a synced copy", () => {
  const queued = addBench(emptyOutbox(), "client0001").outbox;
  const offline = mergeVisibleSets([], queued, { kind: "open", sessionId: null });
  assert.equal(offline.length, 1);
  assert.equal(offline[0]?.pending, true);
  assert.equal(offline[0]?._id, "pending:client0001");

  const acked = applySyncResult(queued, {
    sets: [
      {
        clientId: "client0001",
        revision: 1,
        status: "applied",
        setId: "set1",
        sessionId: "session1",
        personalRecord: null,
        message: null,
      },
    ],
    edits: [],
    deletes: [],
    actions: [],
  }).outbox;
  const beforeQuery = mergeVisibleSets([], acked, { kind: "open", sessionId: "session1" });
  assert.equal(beforeQuery.length, 1);
  assert.equal(beforeQuery[0]?.pending, true);

  const server = [serverSet("set1", "client0001")];
  const echoed = reconcileOutbox(acked, server);
  const afterQuery = mergeVisibleSets(server, echoed, { kind: "open", sessionId: "session1" });
  assert.equal(afterQuery.length, 1);
  assert.equal(afterQuery[0]?.pending, false);
  assert.equal(afterQuery[0]?._id, "set1");
  assert.equal(echoed.sets.length, 0);
});

test("a newer pending edit overlays the server set without a second row", () => {
  const queued = addBench(emptyOutbox(), "client0001").outbox;
  const acked = applySyncResult(queued, {
    sets: [
      {
        clientId: "client0001",
        revision: 1,
        status: "applied",
        setId: "set1",
        sessionId: "session1",
        personalRecord: null,
        message: null,
      },
    ],
    edits: [],
    deletes: [],
    actions: [],
  }).outbox;
  const edited = editPendingSet(acked, "client0001", { weightLb: 205 });
  const merged = mergeVisibleSets([serverSet("set1", "client0001", 135)], edited, {
    kind: "open",
    sessionId: "session1",
  });
  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.weightLb, 205);
  assert.equal(merged[0]?.pending, true);
});

test("a queued delete hides the server set until the server drops it", () => {
  let outbox = queueDelete(emptyOutbox(), "delete0001", "set1");
  const hidden = mergeVisibleSets([serverSet("set1", null)], outbox, {
    kind: "session",
    sessionId: "session1",
  });
  assert.equal(hidden.length, 0);
  outbox = applySyncResult(outbox, {
    sets: [],
    edits: [],
    deletes: [{ deleteId: "delete0001", status: "applied", message: null }],
    actions: [],
  }).outbox;
  assert.equal(mergeVisibleSets([serverSet("set1", null)], outbox, {
    kind: "session",
    sessionId: "session1",
  }).length, 0);
  const reconciled = reconcileOutbox(outbox, []);
  assert.equal(reconciled.deletes.length, 0);
});

test("a saved edit replaces an older edit of the same set", () => {
  const first = queueEdit(emptyOutbox(), {
    editId: "edit000001",
    setId: "set1",
    reps: 5,
    weightLb: 135,
    durationSec: null,
    distanceM: null,
    rpe: null,
  });
  const second = queueEdit(first, {
    editId: "edit000002",
    setId: "set1",
    reps: 3,
    weightLb: 185,
    durationSec: null,
    distanceM: null,
    rpe: null,
  });
  assert.equal(second.edits.length, 1);
  assert.equal(second.edits[0]?.weightLb, 185);
  assert.equal(pendingChangeCount(second), 1);
});

test("completed placements stay off the open workout", () => {
  const queued = enqueueSets(emptyOutbox(), {
    placement: "completed",
    sessionId: null,
    sessionClientId: "pastsession",
    sessionStartedAt: NOW,
    note: null,
    now: NOW,
    sets: [
      {
        clientId: "client0009",
        exerciseName: "Run",
        reps: null,
        weightLb: 0,
        durationSec: null,
        distanceM: 5000,
        rpe: null,
      },
    ],
  }).outbox;
  assert.equal(mergeVisibleSets([], queued, { kind: "open", sessionId: null }).length, 0);
  assert.equal(pendingChangeCount(queued), 1);
});

test("a queued set type round-trips and an older payload stays working", () => {
  const queued = enqueueSets(emptyOutbox(), {
    placement: "open",
    sessionId: null,
    sessionClientId: "session0001",
    sessionStartedAt: NOW,
    note: null,
    now: NOW,
    sets: [
      {
        clientId: "warmup0001",
        exerciseName: "Bench press",
        reps: 10,
        weightLb: 95,
        durationSec: null,
        distanceM: null,
        rpe: null,
        setType: "warmup",
      },
    ],
  }).outbox;
  const store = memoryStore();
  saveOutbox(store, "lifter@example.com", queued);
  assert.equal(loadOutbox(store, "lifter@example.com").sets[0]?.set.setType, "warmup");
  const older = parseOutbox({
    sets: [
      {
        clientId: "old000001",
        revision: 1,
        placement: "open",
        sessionClientId: "session0001",
        set: {
          exerciseName: "Bench press",
          reps: 5,
          weightLb: 135,
          loggedAt: NOW,
        },
      },
    ],
  });
  assert.equal(older.sets[0]?.set.setType, undefined);
});

test("corrupt storage becomes an empty queue and a good queue round-trips", () => {
  const store = memoryStore();
  store.set("workout-offline:outbox:lifter@example.com", "{");
  assert.equal(loadOutbox(store, "Lifter@example.com").sets.length, 0);

  const queued = addBench(emptyOutbox(), "client0001").outbox;
  saveOutbox(store, "lifter@example.com", queued);
  const loaded = loadOutbox(store, "lifter@example.com");
  assert.equal(loaded.sets[0]?.clientId, "client0001");
  assert.equal(loaded.sets[0]?.set.reps, 10);
  assert.deepEqual(parseOutbox({ sets: [{ clientId: "x" }] }).sets.length, 0);

  saveOutbox(store, "other@example.com", emptyOutbox());
  clearOfflineStorage(store);
  assert.deepEqual(store.keys(), []);
});

test("connectivity follows the browser and a dropped Convex socket", () => {
  assert.equal(
    isOffline({
      browserOnline: true,
      hasEverConnected: false,
      isWebSocketConnected: false,
      connectionRetries: 0,
    }),
    false,
  );
  assert.equal(
    isOffline({
      browserOnline: false,
      hasEverConnected: true,
      isWebSocketConnected: true,
      connectionRetries: 0,
    }),
    true,
  );
  assert.equal(
    isOffline({
      browserOnline: true,
      hasEverConnected: true,
      isWebSocketConnected: false,
      connectionRetries: 0,
    }),
    true,
  );
  assert.equal(
    isOffline({
      browserOnline: true,
      hasEverConnected: false,
      isWebSocketConnected: false,
      connectionRetries: 2,
    }),
    true,
  );
  assert.equal(
    isOffline({
      browserOnline: true,
      hasEverConnected: true,
      isWebSocketConnected: true,
      connectionRetries: 4,
    }),
    false,
  );
});

test("the service worker does not cache APIs, voice, or other origins", () => {
  const origin = "https://repsandsets.vercel.app";
  const base = {
    method: "GET",
    pageOrigin: origin,
    mode: "cors",
    hasAuthorization: false,
    hasRange: false,
    isRsc: false,
    isPrefetch: false,
  };
  assert.equal(
    fetchDecision({ ...base, url: `${origin}/api/voice`, mode: "cors" }),
    "passthrough",
  );
  assert.equal(
    fetchDecision({ ...base, url: `${origin}/api/auth/signin`, mode: "navigate" }),
    "passthrough",
  );
  assert.equal(
    fetchDecision({
      ...base,
      url: "https://accounts.google.com/o/oauth2/auth",
      mode: "navigate",
    }),
    "passthrough",
  );
  assert.equal(
    fetchDecision({
      ...base,
      url: "https://honorable-tern-770.convex.cloud/api/query",
    }),
    "passthrough",
  );
  assert.equal(
    fetchDecision({ ...base, url: `${origin}/`, mode: "navigate" }),
    "network-first",
  );
  assert.equal(
    fetchDecision({ ...base, url: `${origin}/_next/static/chunk.js` }),
    "network-first",
  );
  assert.equal(
    fetchDecision({ ...base, url: `${origin}/`, mode: "navigate", method: "POST" }),
    "passthrough",
  );
  assert.equal(
    fetchDecision({ ...base, url: `${origin}/`, mode: "navigate", hasAuthorization: true }),
    "passthrough",
  );
  assert.equal(
    fetchDecision({ ...base, url: `${origin}/history`, mode: "navigate", isRsc: true }),
    "passthrough",
  );
  assert.equal(mayStoreResponse({ ok: true, type: "basic", redirected: true, status: 200 }), false);
  assert.equal(mayStoreResponse({ ok: true, type: "basic", redirected: false, status: 200 }), true);
  assert.equal(mayStoreResponse({ ok: false, type: "basic", redirected: false, status: 500 }), false);

  const source = serviceWorkerSource();
  for (const prefix of NEVER_CACHE_PREFIXES) {
    assert.ok(source.includes(prefix), prefix);
  }
  assert.match(source, /networkFirst/);
  assert.match(source, /!response\.redirected/);
  assert.match(source, /url\.origin !== self\.location\.origin/);
  assert.doesNotMatch(source, /cache-first/);
  assert.equal(source.indexOf("await fetch(request)") < source.indexOf("cache.match(request)"), true);
});
