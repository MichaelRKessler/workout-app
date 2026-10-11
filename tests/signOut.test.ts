import assert from "node:assert/strict";
import test from "node:test";
import { resolveSignOut } from "../lib/offline/signOut.ts";

test("an empty queue signs out without syncing", async () => {
  let synced = false;
  const decision = await resolveSignOut({
    pendingCount: 0,
    offline: false,
    sync: async () => {
      synced = true;
      return 0;
    },
  });
  assert.deepEqual(decision, { action: "sign-out" });
  assert.equal(synced, false);
});

test("a queue that syncs signs out", async () => {
  let synced = false;
  const decision = await resolveSignOut({
    pendingCount: 2,
    offline: false,
    sync: async () => {
      synced = true;
      return 0;
    },
  });
  assert.deepEqual(decision, { action: "sign-out" });
  assert.equal(synced, true);
});

test("a queue that can't sync asks before discarding", async () => {
  const offline = await resolveSignOut({
    pendingCount: 3,
    offline: true,
    sync: async () => {
      throw new Error("sync should not run while offline");
    },
  });
  assert.deepEqual(offline, {
    action: "confirm-discard",
    pendingCount: 3,
    offline: true,
  });

  const failed = await resolveSignOut({
    pendingCount: 4,
    offline: false,
    sync: async () => {
      throw new Error("network down");
    },
  });
  assert.deepEqual(failed, {
    action: "confirm-discard",
    pendingCount: 4,
    offline: false,
  });

  const partial = await resolveSignOut({
    pendingCount: 5,
    offline: false,
    sync: async () => 1,
  });
  assert.deepEqual(partial, {
    action: "confirm-discard",
    pendingCount: 1,
    offline: false,
  });
});
