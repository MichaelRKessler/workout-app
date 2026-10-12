// @vitest-environment happy-dom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { useSessionText } from "@/components/useSessionText";
import { composerTextKey } from "@/lib/offline/storage";

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

test("text typed by one account does not come back for another in the same tab", () => {
  const first = renderHook(() => useSessionText(composerTextKey("first@example.com")));
  act(() => first.result.current[1]("bench 5 at 225"));
  first.unmount();

  const second = renderHook(() => useSessionText(composerTextKey("second@example.com")));
  expect(second.result.current[0]).toBe("");
  const back = renderHook(() => useSessionText(composerTextKey("First@Example.com")));
  expect(back.result.current[0]).toBe("bench 5 at 225");
});
