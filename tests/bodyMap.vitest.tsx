// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { BodyMap } from "@/components/BodyMap";
import paths from "@/lib/bodyMap/paths";
import { DRAWN_GROUPS, muscleLevels, REGION_GROUP, untrainedGroups } from "@/lib/bodyMap/regions";
import { muscleFilterHref } from "@/lib/exerciseLink";

afterEach(() => {
  cleanup();
});

test("every muscle group except cardio and other has a shape on the body", () => {
  expect(DRAWN_GROUPS).toEqual([
    "chest",
    "back",
    "shoulders",
    "biceps",
    "triceps",
    "quads",
    "hamstrings",
    "glutes",
    "core",
  ]);
  const drawn = new Set(
    [paths.front, paths.back].flatMap((view) =>
      Object.keys(view.regions).map((region) => REGION_GROUP[region as keyof typeof REGION_GROUP]),
    ),
  );
  for (const group of DRAWN_GROUPS) {
    expect(drawn.has(group)).toBe(true);
  }
});

test("shading is relative to the most-trained group, and one set still shows", () => {
  const levels = muscleLevels([
    { group: "chest", sets: 12 },
    { group: "back", sets: 6 },
    { group: "biceps", sets: 1 },
    { group: "cardio", sets: 4 },
  ]);
  expect(levels.get("chest")).toBe(4);
  expect(levels.get("back")).toBe(2);
  expect(levels.get("biceps")).toBe(1);
  expect(levels.get("glutes")).toBe(0);
  expect(levels.has("cardio")).toBe(false);
  expect(muscleLevels([]).get("chest")).toBe(0);
});

test("untrained groups are the drawable ones with no sets, in summary order", () => {
  expect(
    untrainedGroups([
      { group: "chest", sets: 3 },
      { group: "core", sets: 2 },
      { group: "quads", sets: 0 },
      { group: "cardio", sets: 5 },
    ]),
  ).toEqual(["back", "shoulders", "biceps", "triceps", "quads", "hamstrings", "glutes"]);
});

test("muscle filter links keep where Back should go", () => {
  expect(muscleFilterHref(null)).toBe("/exercises");
  expect(muscleFilterHref("glutes")).toBe("/exercises?muscle=glutes");
  expect(muscleFilterHref("glutes", true)).toBe("/exercises?muscle=glutes&from=home");
  expect(muscleFilterHref(null, true)).toBe("/exercises?from=home");
});

test("tapping or pressing Enter on a muscle selects its group", async () => {
  const onSelect = vi.fn();
  render(<BodyMap muscles={[{ group: "chest", sets: 4 }]} onSelect={onSelect} />);
  const chest = await waitFor(() => screen.getByRole("button", { name: "Chest, 4 sets" }));
  fireEvent.click(chest);
  expect(onSelect).toHaveBeenLastCalledWith("chest");
  const glutes = screen.getByRole("button", { name: "Glutes, 0 sets" });
  fireEvent.keyDown(glutes, { key: "Enter" });
  expect(onSelect).toHaveBeenLastCalledWith("glutes");
  // Traps show on the front too; the back view repeats the group without a second tab stop.
  expect(screen.getAllByRole("button", { name: /^Back, / })).toHaveLength(1);
  expect(screen.getAllByRole("button")).toHaveLength(9);
});

test("a map without onSelect is a picture, not a set of buttons", async () => {
  const { container } = render(<BodyMap muscles={[{ group: "chest", sets: 4 }]} />);
  await waitFor(() => expect(container.querySelectorAll("svg")).toHaveLength(2));
  expect(screen.queryAllByRole("button")).toHaveLength(0);
  expect(screen.getByRole("img", { name: "Front" })).toBeTruthy();
});
