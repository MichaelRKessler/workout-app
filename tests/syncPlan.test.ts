import assert from "node:assert/strict";
import test from "node:test";
import {
  SYNC_DEPTH_CAP,
  SYNC_DEPTH_MESSAGE,
  shouldSendFinishDirectly,
  syncFailurePlan,
} from "../lib/offline/syncPlan.ts";

test("finish goes to the server only when the queue is empty and the phone is online", () => {
  assert.equal(
    shouldSendFinishDirectly({ offline: false, pendingChanges: 0, hasSessionId: true }),
    true,
  );
  assert.equal(
    shouldSendFinishDirectly({ offline: true, pendingChanges: 0, hasSessionId: true }),
    false,
  );
  assert.equal(
    shouldSendFinishDirectly({ offline: false, pendingChanges: 2, hasSessionId: true }),
    false,
  );
  assert.equal(
    shouldSendFinishDirectly({ offline: false, pendingChanges: 0, hasSessionId: false }),
    false,
  );
});

test("a timeout stops the flush and a validation error splits when it can", () => {
  assert.equal(syncFailurePlan({ depth: 0, outcome: "ok", canSplit: false, validationMessage: "" }).action, "apply");
  assert.equal(
    syncFailurePlan({ depth: 0, outcome: "timeout", canSplit: false, validationMessage: "" }).action,
    "stop",
  );
  assert.equal(
    syncFailurePlan({
      depth: 1,
      outcome: "validation",
      canSplit: true,
      validationMessage: "Reps must be a whole number from 1 to 999.",
    }).action,
    "split",
  );
  assert.deepEqual(
    syncFailurePlan({
      depth: 1,
      outcome: "validation",
      canSplit: false,
      validationMessage: "Reps must be a whole number from 1 to 999.",
    }),
    { action: "reject", message: "Reps must be a whole number from 1 to 999." },
  );
  assert.equal(syncFailurePlan({ depth: 0, outcome: "error", canSplit: false, validationMessage: "" }).action, "retry");
  // Production can hide a rejected argument behind "Server Error", so a batch
  // that can be split still is; one item on its own waits instead of failing.
  assert.equal(syncFailurePlan({ depth: 0, outcome: "error", canSplit: true, validationMessage: "" }).action, "split");
  assert.deepEqual(
    syncFailurePlan({
      depth: SYNC_DEPTH_CAP + 1,
      outcome: "validation",
      canSplit: true,
      validationMessage: "ignored",
    }),
    { action: "reject", message: SYNC_DEPTH_MESSAGE },
  );
});
