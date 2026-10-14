// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

const backend = vi.hoisted(() => ({
  choice: { demoId: null as string | null } as { demoId: string | null } | null | undefined,
  setDemo: vi.fn(async () => null),
}));

vi.mock("convex/react", () => ({
  useQuery: () => backend.choice,
  useMutation: () => backend.setDemo,
}));

import { ExerciseDemo, GuidedDemo } from "@/components/ExerciseDemo";
import type { Id } from "@/convex/_generated/dataModel";

const exerciseId = "ex1" as Id<"exercises">;

afterEach(() => {
  cleanup();
  backend.choice = { demoId: null };
  backend.setDemo.mockClear();
});

test("the exercise page shows the matched demo, its steps and a video link", async () => {
  render(<ExerciseDemo exerciseId={exerciseId} name="Bench press" />);
  expect(await screen.findByText("Matched: Barbell Bench Press - Medium Grip")).toBeTruthy();
  expect(screen.getByAltText("Barbell Bench Press - Medium Grip, start position").getAttribute("src")).toMatch(
    /Barbell_Bench_Press_-_Medium_Grip\/0\.jpg$/,
  );
  expect(screen.getByText("How to do it")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Watch a video" }).getAttribute("href")).toContain("Bench%20press");
});

test("tapping the photo swaps to the end position", async () => {
  const user = userEvent.setup();
  render(<ExerciseDemo exerciseId={exerciseId} name="Squat" />);
  await user.click(await screen.findByRole("button", { name: "Show end position of Barbell Squat" }));
  expect(screen.getByRole("button", { name: "Show start position of Barbell Squat" })).toBeTruthy();
});

test("the picker saves another demo, or turns it off", async () => {
  const user = userEvent.setup();
  render(<ExerciseDemo exerciseId={exerciseId} name="Bench press" />);
  await user.click(await screen.findByRole("button", { name: "Wrong demo?" }));
  const search = screen.getByRole("searchbox", { name: "Search demos" });
  await user.clear(search);
  await user.type(search, "dumbbell bench");
  await user.click(screen.getByRole("button", { name: /^Dumbbell Bench Press dumbbell$/ }));
  expect(backend.setDemo).toHaveBeenCalledWith({ exerciseId, demoId: "Dumbbell_Bench_Press" });

  await user.click(screen.getByRole("button", { name: "Wrong demo?" }));
  await user.click(screen.getByRole("button", { name: "No demo" }));
  expect(backend.setDemo).toHaveBeenLastCalledWith({ exerciseId, demoId: "none" });
});

test("a saved choice wins over the name, and an unmatched name offers a pick", async () => {
  backend.choice = { demoId: "Dumbbell_Bench_Press" };
  const { unmount } = render(<ExerciseDemo exerciseId={exerciseId} name="Bench press" />);
  expect(await screen.findByText("Dumbbell Bench Press")).toBeTruthy();
  unmount();

  backend.choice = { demoId: null };
  render(<ExerciseDemo exerciseId={exerciseId} name="Burpees" />);
  expect(await screen.findByText("No demo found for this name.")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Pick a demo" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Watch a video" })).toBeTruthy();
});

test("the guided card keeps the demo folded until asked", async () => {
  const user = userEvent.setup();
  render(<GuidedDemo exerciseId="ex1" name="Pull-ups" />);
  expect(screen.queryByRole("img")).toBeNull();
  await user.click(screen.getByRole("button", { name: "Show demo" }));
  await waitFor(() => expect(screen.getByAltText("Pullups, start position")).toBeTruthy());
  expect(screen.getByRole("button", { name: "Hide demo" }).getAttribute("aria-expanded")).toBe("true");
});
