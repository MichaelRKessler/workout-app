/** A finish goes straight to the server only when nothing is waiting to sync first. */
export function shouldSendFinishDirectly(input: {
  offline: boolean;
  pendingChanges: number;
  hasSessionId: boolean;
}): boolean {
  return !input.offline && input.pendingChanges === 0 && input.hasSessionId;
}

/** Matches the depth guard in the sync loop. Deeper splits stop instead of looping. */
export const SYNC_DEPTH_CAP = 16;

export const SYNC_DEPTH_MESSAGE = "That change could not be saved";

export type BatchOutcome = "ok" | "timeout" | "validation" | "error";

/**
 * What the sync loop does after one batch attempt.
 * A timeout stops the flush; a success that arrives later is still applied.
 * A validation error splits the batch when it can, otherwise that item fails.
 * Any other error waits and retries.
 */
export type SyncFailurePlan =
  | { action: "apply" }
  | { action: "stop" }
  | { action: "split" }
  | { action: "reject"; message: string }
  | { action: "retry" };

export function syncFailurePlan(input: {
  depth: number;
  outcome: BatchOutcome;
  canSplit: boolean;
  validationMessage: string;
}): SyncFailurePlan {
  if (input.depth > SYNC_DEPTH_CAP) {
    return { action: "reject", message: SYNC_DEPTH_MESSAGE };
  }
  if (input.outcome === "ok") {
    return { action: "apply" };
  }
  if (input.outcome === "timeout") {
    return { action: "stop" };
  }
  if (input.outcome === "validation") {
    if (input.canSplit) {
      return { action: "split" };
    }
    return { action: "reject", message: input.validationMessage };
  }
  return { action: "retry" };
}
