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
