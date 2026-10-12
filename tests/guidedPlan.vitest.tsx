// @vitest-environment happy-dom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { SetLine } from "@/lib/groupSets";

const previous = vi.hoisted(() => ({
  sets: [
    { reps: 8, weightLb: 135, durationSec: null, distanceM: null, setType: "working" },
    { reps: 8, weightLb: 135, durationSec: null, distanceM: null, setType: "working" },
    { reps: 8, weightLb: 135, durationSec: null, distanceM: null, setType: "working" },
  ],
}));

vi.mock("@/components/workout/usePreviousExercise", () => ({
  usePreviousExercise: () => ({ loading: false, sets: previous.sets, label: "Last time 3 × 8 at 135 lb" }),
}));
vi.mock("@/components/useProgression", () => ({
  useProgression: () => ({ enabled: true, incrementLb: 5 }),
}));
vi.mock("@/components/WeightUnit", () => ({
  useWeightUnit: () => "lb",
}));

import { WorkoutPlanList, type PlanRow } from "@/components/workout/WorkoutPlanList";

function row(exerciseId: string, name: string, sets: SetLine[] = [], extra: Partial<PlanRow> = {}): PlanRow {
  return {
    exerciseId,
    name,
    targetSets: 3,
    targetReps: 8,
    targetWeightLb: null,
    targetDurationSec: null,
    targetDistanceM: null,
    skipped: false,
    sets,
    supersetId: null,
    ...extra,
  };
}

function set(id: string, exerciseId: string, name: string): SetLine {
  return {
    _id: id,
    exerciseId,
    exerciseName: name,
    reps: 8,
    weightLb: 140,
    durationSec: null,
    distanceM: null,
    rpe: null,
    setType: "working",
    loggedAt: 1,
  };
}

const handlers = () => ({
  onLog: vi.fn(),
  onRepeat: vi.fn(),
  onSkip: vi.fn(),
  onMove: vi.fn(),
  onLink: vi.fn(),
  onUnlink: vi.fn(),
  onEditSet: vi.fn(),
  onNeedForm: vi.fn(),
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

const bench = [set("s1", "bench", "Bench press"), set("s2", "bench", "Bench press"), set("s3", "bench", "Bench press")];

test("guided view shows only the next exercise, with progress and what comes after", () => {
  const on = handlers();
  render(
    <WorkoutPlanList
      name="Push"
      rows={[row("bench", "Bench press", bench), row("ohp", "Overhead press"), row("dip", "Dip")]}
      loggingId={null}
      offline={false}
      sessionSets={bench}
      repeatingId={null}
      {...on}
    />,
  );
  expect(screen.getByText("Exercise 2 of 3")).toBeTruthy();
  expect(screen.getByText("3 of 9 sets")).toBeTruthy();
  expect(screen.getByRole("progressbar", { name: "Planned sets done" }).getAttribute("aria-valuenow")).toBe("3");
  expect(screen.getByRole("link", { name: "Overhead press" })).toBeTruthy();
  expect(screen.queryByRole("link", { name: "Bench press" })).toBeNull();
  expect(screen.getByText("All 3 sets reached 8 reps last time, so 5 lb more.")).toBeTruthy();
  expect(screen.getByText("Up next ·").parentElement?.textContent).toBe("Up next · Dip");

  act(() => screen.getByRole("button", { name: "Skip Overhead press" }).click());
  expect(on.onSkip).toHaveBeenCalledWith("ohp", true);
});

test("after a set, the main button logs the next one the same way", () => {
  const on = handlers();
  const one = [set("s4", "ohp", "Overhead press")];
  render(
    <WorkoutPlanList
      name={null}
      rows={[row("bench", "Bench press", bench), row("ohp", "Overhead press", one)]}
      loggingId={null}
      offline={false}
      sessionSets={[...bench, ...one]}
      repeatingId={null}
      {...on}
    />,
  );
  act(() => screen.getByRole("button", { name: /^Log set 2 of Overhead press/ }).click());
  expect(on.onRepeat).toHaveBeenCalledWith(expect.objectContaining({ exerciseId: "ohp" }));
});

test("Show full plan switches to the list and is remembered on this device", () => {
  const on = handlers();
  const props = {
    name: null,
    rows: [row("bench", "Bench press"), row("ohp", "Overhead press")],
    loggingId: null,
    offline: false,
    sessionSets: [],
    repeatingId: null,
    ...on,
  };
  const { unmount } = render(<WorkoutPlanList {...props} />);
  act(() => screen.getByRole("button", { name: "Show full plan" }).click());
  expect(screen.getByRole("link", { name: "Overhead press" })).toBeTruthy();
  expect(screen.queryByText("Exercise 1 of 2")).toBeNull();
  unmount();
  render(<WorkoutPlanList {...props} />);
  expect(screen.getByRole("button", { name: "One at a time" })).toBeTruthy();
});

test("editing the plan always shows the full list", () => {
  render(
    <WorkoutPlanList
      name={null}
      rows={[row("bench", "Bench press"), row("ohp", "Overhead press")]}
      loggingId={null}
      offline={false}
      sessionSets={[]}
      repeatingId={null}
      editing
      {...handlers()}
    />,
  );
  expect(screen.queryByRole("progressbar")).toBeNull();
  expect(screen.getByRole("button", { name: "Move Bench press up" })).toBeTruthy();
});

test("up next includes a superset partner that comes earlier in the plan", () => {
  const curl = [set("c1", "curl", "Curl")];
  render(
    <WorkoutPlanList
      name={null}
      rows={[
        row("curl", "Curl", curl, { supersetId: "s" }),
        row("push", "Pushdown", [], { supersetId: "s" }),
        row("dip", "Dip"),
      ]}
      loggingId={null}
      offline={false}
      sessionSets={curl}
      repeatingId={null}
      {...handlers()}
    />,
  );
  expect(screen.getByRole("link", { name: "Pushdown" })).toBeTruthy();
  expect(screen.getByText("Up next ·").parentElement?.textContent).toBe("Up next · Curl · Dip");
});
