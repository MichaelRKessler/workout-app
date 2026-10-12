import { accountKey } from "./storage.ts";

export function queueLockName(email: string | null): string {
  return `workout-account:${accountKey(email)}`;
}

type LockManagerLike = {
  request<T>(name: string, callback: () => Promise<T>): Promise<T>;
};

export function sendLockName(email: string | null): string {
  return `${queueLockName(email)}:send`;
}

async function withNamedLock<T>(
  name: string,
  fn: () => Promise<T>,
  locks: LockManagerLike | null | undefined,
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
  return await manager.request(name, fn);
}

/**
 * One tab at a time may read-merge-write the queue. Hold it only around
 * storage, never across a network call, so another tab's new sets are
 * written at once. Browsers without Web Locks still run the callback; the
 * merge keeps the other tab's items when a storage event arrives.
 */
export async function withQueueLock<T>(
  email: string | null,
  fn: () => Promise<T>,
  locks?: LockManagerLike | null,
): Promise<T> {
  return await withNamedLock(queueLockName(email), fn, locks);
}

/** One tab at a time may send the queue. It may wait on the network. */
export async function withSendLock<T>(
  email: string | null,
  fn: () => Promise<T>,
  locks?: LockManagerLike | null,
): Promise<T> {
  return await withNamedLock(sendLockName(email), fn, locks);
}
