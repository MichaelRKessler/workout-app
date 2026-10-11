/**
 * Sign-out must not drop sets that are still on the phone.
 * An empty queue signs out. Anything still pending after a sync attempt
 * needs an explicit discard. This module does not touch storage.
 */

export type SignOutDecision =
  | { action: "sign-out" }
  | { action: "confirm-discard"; pendingCount: number; offline: boolean };

export async function resolveSignOut(input: {
  pendingCount: number;
  offline: boolean;
  sync: () => Promise<number>;
}): Promise<SignOutDecision> {
  if (input.pendingCount <= 0) {
    return { action: "sign-out" };
  }
  if (input.offline) {
    return {
      action: "confirm-discard",
      pendingCount: input.pendingCount,
      offline: true,
    };
  }

  try {
    const pendingCount = await input.sync();
    if (pendingCount <= 0) {
      return { action: "sign-out" };
    }
    return { action: "confirm-discard", pendingCount, offline: false };
  } catch {
    return {
      action: "confirm-discard",
      pendingCount: input.pendingCount,
      offline: false,
    };
  }
}
