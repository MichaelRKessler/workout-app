// @vitest-environment happy-dom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { RestTimer } from "@/components/workout/RestTimer";

const chime = vi.hoisted(() => ({ play: vi.fn() }));

vi.mock("@/lib/restChime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/restChime")>();
  return { ...actual, playRestChime: chime.play, unlockRestAudio: () => undefined };
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-12T12:00:00Z"));
  window.localStorage.clear();
  window.sessionStorage.clear();
  chime.play.mockClear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

function startRest() {
  const view = render(<RestTimer setCount={0} loading={false} restLabel="Bench" />);
  view.rerender(<RestTimer setCount={1} loading={false} restLabel="Bench" />);
  return view;
}

test("a rest that ends on its own chimes once", () => {
  startRest();
  expect(screen.getByText("1:30")).toBeInstanceOf(HTMLElement);
  advance(91_000);
  expect(screen.getByText("Done")).toBeInstanceOf(HTMLElement);
  expect(chime.play).toHaveBeenCalledTimes(1);
});

test("Skip is silent, but +30 s afterwards counts 30 seconds and chimes", () => {
  startRest();
  act(() => {
    screen.getByRole("button", { name: "Skip" }).click();
  });
  expect(screen.getByText("Done")).toBeInstanceOf(HTMLElement);
  advance(1_000);
  expect(chime.play).not.toHaveBeenCalled();

  act(() => {
    screen.getByRole("button", { name: "+30s" }).click();
  });
  expect(screen.getByText("0:30")).toBeInstanceOf(HTMLElement);
  advance(31_000);
  expect(screen.getByText("Done")).toBeInstanceOf(HTMLElement);
  expect(chime.play).toHaveBeenCalledTimes(1);
});

test("the save button names the exercise it saves for", () => {
  const save = vi.fn();
  const view = render(<RestTimer setCount={0} loading={false} restLabel="Bench" onExerciseRest={save} />);
  view.rerender(<RestTimer setCount={1} loading={false} restLabel="Bench" onExerciseRest={save} />);
  act(() => {
    screen.getByRole("button", { name: "+30s" }).click();
  });
  act(() => {
    screen.getByRole("button", { name: "Save for Bench" }).click();
  });
  expect(save).toHaveBeenCalledWith(120);
});

function startKeyedRest(workoutKey: string) {
  const view = render(<RestTimer setCount={0} loading={false} restLabel="Bench" workoutKey={workoutKey} />);
  view.rerender(<RestTimer setCount={1} loading={false} restLabel="Bench" workoutKey={workoutKey} />);
  return view;
}

test("a rest keeps counting after leaving the workout and coming back", () => {
  const view = startKeyedRest("w1");
  advance(30_000);
  view.unmount();
  advance(10_000);

  render(<RestTimer setCount={1} loading={false} restLabel="Bench" workoutKey="w1" />);
  expect(screen.getByText("0:50")).toBeInstanceOf(HTMLElement);
  advance(51_000);
  expect(screen.getByText("Done")).toBeInstanceOf(HTMLElement);
  expect(chime.play).toHaveBeenCalledTimes(1);
});

test("a rest that ended while away shows Done without a late chime", () => {
  const view = startKeyedRest("w1");
  view.unmount();
  advance(120_000);

  render(<RestTimer setCount={1} loading={false} restLabel="Bench" workoutKey="w1" />);
  advance(1_000);
  expect(screen.getByText("Done")).toBeInstanceOf(HTMLElement);
  expect(chime.play).not.toHaveBeenCalled();
});

test("a skipped rest stays skipped after coming back", () => {
  const view = startKeyedRest("w1");
  act(() => {
    screen.getByRole("button", { name: "Skip" }).click();
  });
  view.unmount();

  render(<RestTimer setCount={1} loading={false} restLabel="Bench" workoutKey="w1" />);
  advance(1_000);
  expect(screen.getByText("Done")).toBeInstanceOf(HTMLElement);
  expect(screen.queryByRole("button", { name: "Skip" })).toBeNull();
  expect(chime.play).not.toHaveBeenCalled();
});

test("another workout does not pick up the saved rest", () => {
  const view = startKeyedRest("w1");
  view.unmount();

  render(<RestTimer setCount={0} loading={false} workoutKey="w2" />);
  expect(screen.getByText("1:30")).toBeInstanceOf(HTMLElement);
  advance(5_000);
  expect(screen.getByText("1:30")).toBeInstanceOf(HTMLElement);
});

test("a key that arrives after loading still restores the rest", () => {
  const view = startKeyedRest("w1");
  advance(20_000);
  view.unmount();

  const back = render(<RestTimer setCount={0} loading={true} workoutKey="loading" />);
  back.rerender(<RestTimer setCount={1} loading={false} restLabel="Bench" workoutKey="w1" />);
  expect(screen.getByText("1:10")).toBeInstanceOf(HTMLElement);
});

test("a superset round that holds the rest forgets the saved one", () => {
  const view = startKeyedRest("w1");
  view.rerender(<RestTimer setCount={2} loading={false} restLabel="Bench" hold workoutKey="w1" />);
  view.unmount();
  expect(window.sessionStorage.getItem("workout-rest-run")).toBeNull();
});

test("before the first set the bar says it changes the default", () => {
  render(<RestTimer setCount={0} loading={false} />);
  expect(screen.getByText("Rest · default")).toBeInstanceOf(HTMLElement);
  act(() => {
    screen.getByRole("button", { name: "+30s" }).click();
  });
  expect(window.localStorage.getItem("workout-rest-seconds")).toBe("120");
  expect(screen.getByText("Default rest 2:00")).toBeInstanceOf(HTMLElement);
});
