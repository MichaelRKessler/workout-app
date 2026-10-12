// @vitest-environment happy-dom
import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

const push = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("convex/react", () => ({
  useMutation: () => vi.fn(),
  useQuery: () => ({ email: "lifter@example.com" }),
}));
vi.mock("@/components/OfflineSync", () => ({
  useOfflineLog: () => ({ offline: true, snapshot: null }),
}));
vi.mock("@/lib/offline/routineCache", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/offline/routineCache")>();
  return {
    ...actual,
    loadRoutineCache: () => [
      { _id: "routine1", name: "Push", exercises: [{ exerciseId: "e1", name: "Bench press" }] },
    ],
  };
});

import { useBeginWorkout } from "@/components/routines/useBeginWorkout";

afterEach(() => {
  vi.restoreAllMocks();
  push.mockClear();
  window.localStorage.clear();
});

test("an offline routine that cannot be saved shows an error instead of an empty workout", async () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("Quota exceeded", "QuotaExceededError");
  });
  const { result } = renderHook(() => useBeginWorkout());
  await act(async () => {
    await result.current.startRoutine("routine1");
  });
  expect(push).not.toHaveBeenCalled();
  expect(result.current.error).toMatch(/couldn't save the routine/);
});

test("an offline routine that saves opens the log screen", async () => {
  const { result } = renderHook(() => useBeginWorkout());
  await act(async () => {
    await result.current.startRoutine("routine1");
  });
  expect(push).toHaveBeenCalledWith("/");
  expect(result.current.error).toBeNull();
});
