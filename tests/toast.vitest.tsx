// @vitest-environment happy-dom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { Toast, toastDuration } from "@/components/Toast";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

test("an Undo toast stays longer than a plain note", () => {
  expect(toastDuration({ tone: "info" })).toBe(6000);
  expect(toastDuration({ tone: "info", action: { label: "Undo", onClick: () => undefined } })).toBe(10000);
  expect(toastDuration({ tone: "error" })).toBe(9000);
});

test("the toast waits while its Undo has focus, then closes after leaving", () => {
  const dismiss = vi.fn();
  render(
    <Toast
      toast={{ tone: "info", message: "Added 1 set", action: { label: "Undo", onClick: () => undefined } }}
      onDismiss={dismiss}
      raised={false}
    />,
  );
  act(() => {
    screen.getByRole("button", { name: "Undo" }).focus();
  });
  act(() => {
    vi.advanceTimersByTime(30_000);
  });
  expect(dismiss).not.toHaveBeenCalled();
  act(() => {
    screen.getByRole("button", { name: "Undo" }).blur();
  });
  act(() => {
    vi.advanceTimersByTime(10_000);
  });
  expect(dismiss).toHaveBeenCalledTimes(1);
});
