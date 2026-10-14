// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { TabBarView } from "@/components/TabBar";

vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ push: vi.fn() }) }));

afterEach(() => {
  cleanup();
});

test("the bar links the four pages and marks the one you're on", () => {
  render(<TabBarView pathname="/history/day/2026-10-14" inWorkout={false} offline={false} onLog={() => {}} />);
  const nav = screen.getByRole("navigation", { name: "Main" });
  const links = Array.from(nav.querySelectorAll("a")).map((link) => [link.textContent, link.getAttribute("href")]);
  expect(links).toEqual([
    ["Home", "/"],
    ["History", "/history"],
    ["Exercises", "/exercises"],
    ["Body", "/body"],
  ]);
  expect(screen.getByRole("link", { name: "History" }).getAttribute("aria-current")).toBe("page");
  expect(screen.getByRole("link", { name: "Home" }).getAttribute("aria-current")).toBeNull();
});

test("the center button is the mic, and Home reads Workout while one is open", () => {
  const onLog = vi.fn();
  render(<TabBarView pathname="/" inWorkout offline={false} onLog={onLog} />);
  expect(screen.getByRole("link", { name: "Workout" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Log a set by voice" }));
  expect(onLog).toHaveBeenCalledOnce();
});

test("offline, the center button adds a set by hand", () => {
  render(<TabBarView pathname="/" inWorkout={false} offline onLog={() => {}} />);
  expect(screen.getByRole("button", { name: "Add a set by hand" })).toBeTruthy();
});
