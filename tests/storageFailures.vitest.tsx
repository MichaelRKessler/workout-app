// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { RestTimer } from "@/components/workout/RestTimer";
import { readLocal, writeLocal } from "@/lib/localValue";
import { cacheStore, loadCachedAccess, saveCachedAccess } from "@/lib/offline/storage";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function blockStorage() {
  vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
    throw new DOMException("The operation is insecure.", "SecurityError");
  });
}

function fillStorage() {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("Quota exceeded", "QuotaExceededError");
  });
}

test("device settings read as defaults and skip writes when storage is blocked", () => {
  blockStorage();
  expect(readLocal("workout-rest-seconds")).toBeNull();
  expect(() => writeLocal("workout-rest-seconds", "120")).not.toThrow();
});

test("caches read as empty and skip writes when storage is blocked or full", () => {
  blockStorage();
  const blocked = cacheStore();
  expect(blocked.get("anything")).toBeNull();
  expect(blocked.keys()).toEqual([]);
  expect(() => blocked.set("anything", "1")).not.toThrow();
  expect(() => blocked.remove("anything")).not.toThrow();
  expect(loadCachedAccess(blocked)).toBeNull();
  vi.restoreAllMocks();

  fillStorage();
  const full = cacheStore();
  expect(() =>
    saveCachedAccess(full, { email: "a@example.com", name: "A", allowed: true, isAdmin: false, request: null }),
  ).not.toThrow();
});

test("the rest bar renders when storage is blocked", () => {
  blockStorage();
  const view = render(<RestTimer setCount={0} loading={false} />);
  view.rerender(<RestTimer setCount={1} loading={false} />);
  expect(screen.getByText("1:30")).toBeInstanceOf(HTMLElement);
  expect(() => screen.getByRole("button", { name: "+30s" }).click()).not.toThrow();
});
