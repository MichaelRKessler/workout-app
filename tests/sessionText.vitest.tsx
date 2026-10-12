// @vitest-environment happy-dom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { useSessionText } from "@/components/useSessionText";

beforeEach(() => {
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

test("typed text comes back after leaving the page", () => {
  const first = renderHook(() => useSessionText("composer"));
  act(() => first.result.current[1]("bench 5 at 225"));
  first.unmount();

  const second = renderHook(() => useSessionText("composer"));
  expect(second.result.current[0]).toBe("bench 5 at 225");
});

test("cleared text is forgotten", () => {
  const first = renderHook(() => useSessionText("composer"));
  act(() => first.result.current[1]("squat 5 at 315"));
  act(() => first.result.current[1](""));
  first.unmount();

  const second = renderHook(() => useSessionText("composer"));
  expect(second.result.current[0]).toBe("");
  expect(window.sessionStorage.getItem("composer")).toBeNull();
});

test("blocked storage still lets you type", () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("blocked", "SecurityError");
  });
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new DOMException("blocked", "SecurityError");
  });
  const view = renderHook(() => useSessionText("composer"));
  act(() => view.result.current[1]("row 10 at 135"));
  expect(view.result.current[0]).toBe("row 10 at 135");
});
