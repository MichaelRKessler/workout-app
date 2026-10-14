// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { Recap } from "@/convex/lib/recap";

let response: unknown = undefined;
const queried: unknown[] = [];

vi.mock("convex/react", () => ({
  useQuery: (_ref: unknown, args: unknown) => {
    queried.push(args);
    return args === "skip" ? undefined : response;
  },
}));

const { FinishedWorkout } = await import("@/components/WorkoutSummaryCard");

afterEach(() => {
  cleanup();
  response = undefined;
  queried.length = 0;
});

const summary = {
  totalMs: 45 * 60_000,
  activeMs: 10 * 60_000,
  restMs: 35 * 60_000,
  exerciseCount: 1,
  setCount: 3,
  warmupCount: 0,
  volumeLb: 3375,
  distanceM: 0,
  calories: 0,
};

function renderFinished(sessionId: string | null = "session1", recordsPending = false) {
  render(
    <FinishedWorkout
      sessionId={sessionId}
      summary={summary}
      records={[]}
      unit="lb"
      recordsPending={recordsPending}
      dayKey="2026-10-13"
      onDone={() => undefined}
    />,
  );
}

const recap: Recap = {
  celebrations: [{ kind: "repsAtWeight", exerciseId: "sq", weightLb: 225, reps: 7, previousReps: 5 }],
  highlights: [{ kind: "streak", weeks: 5 }],
  badges: [
    { id: "iron-elephant", exerciseId: null, earnedSessionId: "session1", earnedAt: 2, isNew: true },
    { id: "workouts-10", exerciseId: null, earnedSessionId: "older", earnedAt: 1, isNew: false },
  ],
  confetti: true,
  seed: 4,
};

test("shows records, highlights, the new badge, and the quiet badge shelf", () => {
  response = { recap, exerciseNames: { sq: "Back Squat" } };
  renderFinished();
  expect(screen.getByText("Most reps at 225 lb on Back Squat: 7 (was 5)")).toBeTruthy();
  expect(screen.getByRole("region", { name: "Highlights" }).textContent).toContain("5");
  const fresh = screen.getByRole("region", { name: "New badges" });
  expect(fresh.textContent).toContain("Iron Elephant");
  expect(fresh.textContent).not.toContain("Habit Forming");
  expect(screen.getByRole("region", { name: "Your badges" }).textContent).toContain("Habit Forming");
  expect(document.querySelector("canvas")).not.toBeNull();
});

test("no confetti without a genuine record", () => {
  response = { recap: { ...recap, confetti: false, badges: [] }, exerciseNames: {} };
  renderFinished();
  expect(document.querySelector("canvas")).toBeNull();
  expect(screen.queryByRole("region", { name: "New badges" })).toBeNull();
});

test("a workout still waiting to sync skips the recap", () => {
  renderFinished("session1", true);
  expect(queried.every((args) => args === "skip")).toBe(true);
  expect(screen.getByText("New records show in History after this workout syncs.")).toBeTruthy();
});
