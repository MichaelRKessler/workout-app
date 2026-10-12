// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { emptyOutbox } from "@/lib/offline/outbox";

const NOW = Date.now();
const responses: Record<string, unknown> = {};
const saveSets = vi.fn();
const removeMany = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("convex/react", () => ({
  useMutation: () => vi.fn(async () => null),
  useQuery: (ref: unknown, args?: unknown) =>
    args === "skip" ? undefined : responses[getFunctionName(ref as never)],
  usePaginatedQuery: () => ({ results: [], status: "Exhausted", loadMore: vi.fn() }),
}));
vi.mock("@/components/OfflineSync", () => ({
  useOfflineLog: () => offlineLog,
}));

const offlineLog = {
  offline: false,
  outbox: emptyOutbox(),
  snapshot: null,
  accountEmail: "lifter@example.com",
  saveSets,
  removeMany,
  editSet: vi.fn(),
  reconcile: vi.fn(),
  rememberWorkout: vi.fn(),
  keepGoing: vi.fn(),
  finishWorkout: vi.fn(),
  discardWorkout: vi.fn(),
};

import { LogWorkout } from "@/components/LogWorkout";

beforeEach(() => {
  for (const key of Object.keys(responses)) {
    delete responses[key];
  }
  responses["sessions:getOpen"] = {
    _id: "session1",
    startedAt: NOW - 10 * 60_000,
    resumedAt: null,
    lastSetAt: NOW - 60_000,
    note: null,
    planName: null,
    routineId: null,
    plan: [],
  };
  responses["routines:list"] = [];
  responses["exercises:list"] = { exercises: [], truncated: false };
  responses["sets:listForSession"] = [
    {
      _id: "set1",
      exerciseId: "bench",
      exerciseName: "Bench press",
      reps: 5,
      weightLb: 225,
      durationSec: null,
      distanceM: null,
      calories: null,
      rpe: null,
      setType: "working",
      loggedAt: NOW - 60_000,
      clientId: null,
    },
  ];
  saveSets.mockResolvedValue({
    status: "synced",
    error: null,
    personalRecords: [],
    setIds: ["set2"],
    clientIds: [],
    sessionId: "session1",
    completedAt: null,
  });
  removeMany.mockResolvedValue({
    status: "synced",
    error: null,
    personalRecords: [],
    setIds: [],
    clientIds: [],
    sessionId: "session1",
    completedAt: null,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

test("repeating a set saves it to the open workout and offers Undo", async () => {
  const user = userEvent.setup();
  render(<LogWorkout />);
  expect(await screen.findByText("Bench press")).toBeInstanceOf(HTMLElement);

  await user.click(screen.getByRole("button", { name: /^Log another set of Bench press/ }));
  await waitFor(() => expect(saveSets).toHaveBeenCalledTimes(1));
  expect(saveSets.mock.calls[0]?.[0]).toMatchObject({
    placement: "open",
    sessionId: "session1",
    sets: [{ exerciseName: "Bench press", reps: 5, weightLb: 225 }],
  });

  await user.click(await screen.findByRole("button", { name: "Undo" }));
  await waitFor(() => expect(removeMany).toHaveBeenCalledWith(["set2"]));
});

test("the + button opens the form on the last exercise, which checks input before saving", async () => {
  const user = userEvent.setup();
  render(<LogWorkout />);
  await user.click(await screen.findByRole("button", { name: "Add a set by hand" }));
  const reps = (await waitFor(() => {
    const input = document.getElementById("manual-reps");
    expect(input).not.toBeNull();
    return input;
  })) as HTMLInputElement;
  await user.clear(reps);
  await user.type(reps, "0");
  await user.click(screen.getByRole("button", { name: "Add set" }));
  expect(await screen.findByText(/Reps must be a whole number/)).toBeInstanceOf(HTMLElement);
  expect(saveSets).not.toHaveBeenCalled();

  await user.clear(reps);
  await user.type(reps, "6");
  await user.click(screen.getByRole("button", { name: "Add set" }));
  await waitFor(() => expect(saveSets).toHaveBeenCalledTimes(1));
  expect(saveSets.mock.calls[0]?.[0]).toMatchObject({
    sets: [{ exerciseName: "Bench press", reps: 6, weightLb: 225 }],
  });
});
