import assert from "node:assert/strict";
import test from "node:test";
import { createScreenWakeLock } from "../lib/wakeLock.ts";

test("the screen lock is requested while visible and released when the workout ends", async () => {
  const releases: string[] = [];
  let next = 0;
  let visible = true;
  const controller = createScreenWakeLock({
    isVisible: () => visible,
    request: async () => {
      const id = `lock-${next}`;
      next += 1;
      return {
        release: async () => {
          releases.push(id);
        },
      };
    },
  });

  await controller.sync();
  await controller.sync();
  assert.deepEqual(releases, ["lock-0"]);
  await controller.stop();
  assert.deepEqual(releases, ["lock-0", "lock-1"]);

  visible = true;
  await controller.sync();
  assert.equal(next, 2);
});

test("a hidden page does not request a lock, and a late lock is released", async () => {
  let visible = false;
  let requested = 0;
  const controller = createScreenWakeLock({
    isVisible: () => visible,
    request: async () => {
      requested += 1;
      return { release: async () => undefined };
    },
  });
  await controller.sync();
  controller.onVisibilityChange();
  assert.equal(requested, 0);

  visible = true;
  let releaseCalls = 0;
  let resolveRequest: (lock: { release: () => Promise<void> }) => void = () => undefined;
  const late = createScreenWakeLock({
    isVisible: () => true,
    request: () =>
      new Promise((resolve) => {
        resolveRequest = resolve;
      }),
  });
  const pending = late.sync();
  const stopping = late.stop();
  resolveRequest({
    release: async () => {
      releaseCalls += 1;
    },
  });
  await pending;
  await stopping;
  assert.equal(releaseCalls, 1);
});

test("a browser without a wake lock still lets the workout continue", async () => {
  const controller = createScreenWakeLock({
    isVisible: () => true,
    request: async () => null,
  });
  await controller.sync();
  await controller.stop();
});
