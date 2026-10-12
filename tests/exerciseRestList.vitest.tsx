// @vitest-environment happy-dom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

const backend = vi.hoisted(() => ({
  setRest: vi.fn(async () => null),
  rests: [
    { _id: "e1", name: "Bench press", restSeconds: 120 },
    { _id: "e2", name: "Squat", restSeconds: 180 },
  ],
}));

vi.mock("convex/react", () => ({
  useMutation: () => backend.setRest,
  useQuery: (_query: unknown, args?: { name?: string }) => {
    if (args && "name" in args) {
      return backend.rests.find((rest) => rest.name === args.name)?.restSeconds ?? null;
    }
    return { rests: backend.rests, truncated: false };
  },
}));
vi.mock("@/components/OfflineSync", () => ({
  useOfflineLog: () => ({ offline: false, queueExerciseRest: vi.fn(), accountEmail: "lifter@example.com" }),
}));

import { ExerciseRestList } from "@/components/ExerciseRestList";

afterEach(() => {
  cleanup();
  backend.setRest.mockClear();
  window.localStorage.clear();
});

test("Settings lists each exercise rest, and Reset clears one back to the default", async () => {
  render(<ExerciseRestList />);
  const list = screen.getByRole("list", { name: "Exercises with their own rest" });
  expect(list.textContent).toContain("Bench press");
  expect(list.textContent).toContain("2:00");
  expect(list.textContent).toContain("3:00");

  await act(async () => {
    screen.getByRole("button", { name: "Reset rest for Squat to the default" }).click();
  });
  expect(backend.setRest).toHaveBeenCalledWith({ name: "Squat", restSeconds: null });
  expect(screen.queryByText("Squat")).toBeNull();
  expect(screen.getByText("Bench press")).toBeInstanceOf(HTMLElement);
});
