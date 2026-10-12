import { accountKey } from "./storage.ts";

export function queueLockName(email: string | null): string {
  return `workout-account:${accountKey(email)}`;
}

type LockManagerLike = {
  request<T>(name: string, callback: () => Promise<T>): Promise<T>;
};

/**
 * One tab at a time may read-merge-write the queue or send it.
 * Browsers without Web Locks still run the callback; the merge keeps
 * the other tab's items when a storage event arrives.
 */
export async function withQueueLock<T>(
  email: string | null,
  fn: () => Promise<T>,
  locks?: LockManagerLike | null,
): Promise<T> {
  const manager =
    locks === undefined
      ? typeof navigator !== "undefined"
        ? navigator.locks
        : null
      : locks;
  if (!manager) {
    return await fn();
  }
  return await manager.request(queueLockName(email), fn);
}
