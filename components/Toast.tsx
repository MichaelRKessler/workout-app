"use client";

import { CloseIcon } from "@/components/icons";
import { useEffect, useRef, useState } from "react";

export type ToastMessage = {
  message: string;
  tone: "info" | "error";
  action?: { label: string; onClick: () => void };
};

/** How long a toast stays. Undo and other actions get longer to reach. */
export function toastDuration(toast: Pick<ToastMessage, "tone" | "action">): number {
  if (toast.tone === "error") {
    return 9000;
  }
  return toast.action ? 10000 : 6000;
}

/**
 * A short note above the bottom controls. Give it a `key` per message so the
 * timer restarts for each one. The timer pauses while the toast is hovered or
 * has focus, so its action can still be reached.
 */
export function Toast({
  toast,
  onDismiss,
  raised,
}: {
  toast: ToastMessage | null;
  onDismiss: () => void;
  raised: boolean;
}) {
  const onDismissRef = useRef(onDismiss);
  useEffect(() => {
    onDismissRef.current = onDismiss;
  });

  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const duration = toast ? toastDuration(toast) : null;
  useEffect(() => {
    if (duration === null || hovered || focused) {
      return;
    }
    const timer = window.setTimeout(() => onDismissRef.current(), duration);
    return () => window.clearTimeout(timer);
  }, [duration, hovered, focused]);

  return (
    <div
      aria-live="polite"
      className={`pointer-events-none fixed inset-x-0 z-30 flex justify-center px-4 ${
        raised
          ? "bottom-[calc(15rem+var(--page-inset))]"
          : "bottom-[calc(20px+var(--page-inset))]"
      }`}
    >
      {toast ? (
        <div
          role={toast.tone === "error" ? "alert" : undefined}
          onPointerEnter={() => setHovered(true)}
          onPointerLeave={() => setHovered(false)}
          onFocus={() => setFocused(true)}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
              setFocused(false);
            }
          }}
          className="pointer-events-auto flex min-h-12 w-full max-w-lg animate-[sheet-in_200ms_ease-out] items-center justify-between gap-2 rounded-2xl bg-inverse py-1 pr-1 pl-4 text-inverse-ink shadow-lift"
        >
          <p className="py-2 text-sm">{toast.message}</p>
          <div className="flex shrink-0 items-center">
            {toast.action ? (
              <button
                type="button"
                onClick={toast.action.onClick}
                className="min-h-11 rounded-xl px-3 text-sm font-semibold underline underline-offset-[3px]"
              >
                {toast.action.label}
              </button>
            ) : null}
            <button
              type="button"
              aria-label="Dismiss"
              onClick={onDismiss}
              className="flex size-11 items-center justify-center rounded-xl opacity-70 hover:opacity-100"
            >
              <CloseIcon className="size-4" strokeWidth={2} />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
