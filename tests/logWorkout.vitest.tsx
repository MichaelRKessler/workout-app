// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { emptyOutbox } from "@/lib/offline/outbox";

const NOW = Date.now();
const responses: Record<string, unknown> = {};
const saveSets = vi.fn();
const removeMany = vi.fn();
const saveBody = vi.fn();

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
  saveBody,
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
  vi.unstubAllGlobals();
});

function weighIn(extra: Record<string, unknown> = {}) {
  return {
    weightLb: 232,
    bodyFatPct: null,
    waistCm: null,
    chestCm: null,
    armCm: null,
    hipsCm: null,
    thighCm: null,
    dayOffset: 0,
    note: null,
    ...extra,
  };
}

test("typing weight 232 in the main log opens the body sheet and saves a weigh-in", async () => {
  const fetchMock = vi.fn(async () =>
    new Response(JSON.stringify({ body: weighIn(), persisted: false }), { status: 200 }),
  );
  vi.stubGlobal("fetch", fetchMock);
  saveBody.mockResolvedValue({
    status: "synced",
    error: null,
    personalRecords: [],
    setIds: [],
    clientIds: ["b1"],
    sessionId: null,
    completedAt: null,
  });
  const user = userEvent.setup();
  render(<LogWorkout />);

  await user.type(screen.getByLabelText("Type a set"), "weight 232");
  await user.click(screen.getByRole("button", { name: "Send" }));

  expect(await screen.findByText("Save this measurement?")).toBeTruthy();
  expect((screen.getByLabelText("Weight (lb)") as HTMLInputElement).value).toBe("232");
  expect(saveSets).not.toHaveBeenCalled();
  expect(saveBody).not.toHaveBeenCalled();

  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(saveBody).toHaveBeenCalledOnce());
  expect(saveBody.mock.calls[0]?.[0]).toMatchObject({ weightLb: 232, waistCm: null });
  expect(saveSets).not.toHaveBeenCalled();
  expect(await screen.findByText("Logged weigh-in · 232 lb")).toBeTruthy();
});

test("sets and a weigh-in in one note save the sets first, then ask about the weigh-in", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(
        JSON.stringify({
          proposal: {
            note: null,
            exercises: [
              {
                exerciseName: "Bench press",
                sets: [
                  {
                    reps: 5,
                    weightLb: 225,
                    durationSec: null,
                    distanceM: null,
                    calories: null,
                    rpe: null,
                    setType: "working",
                  },
                ],
              },
            ],
          },
          body: weighIn(),
          persisted: false,
        }),
        { status: 200 },
      ),
    ),
  );
  const user = userEvent.setup();
  render(<LogWorkout />);

  await user.type(screen.getByLabelText("Type a set"), "weighed 232, bench 5 at 225");
  await user.click(screen.getByRole("button", { name: "Send" }));
  expect(screen.queryByText("Save this measurement?")).toBeNull();

  const dialog = await screen.findByRole("dialog");
  await user.click(within(dialog).getByRole("button", { name: "Add 1 set" }));
  await waitFor(() => expect(saveSets).toHaveBeenCalledOnce());
  expect(await screen.findByText("Save this measurement?")).toBeTruthy();
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
