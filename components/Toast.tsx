"use client";

import { CloseIcon } from "@/components/icons";
import { useEffect, useRef } from "react";

export type ToastMessage = {
  message: string;
  tone: "info" | "error";
  action?: { label: string; onClick: () => void };
};

/**
 * A short note above the bottom controls. Give it a `key` per message so the
 * timer restarts for each one.
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

  const visible = toast !== null;
  const tone = toast?.tone;
  useEffect(() => {
    if (!visible) {
      return;
    }
    const timer = window.setTimeout(
      () => onDismissRef.current(),
      tone === "error" ? 9000 : 6000,
    );
    return () => window.clearTimeout(timer);
  }, [visible, tone]);

  return (
    <div
      aria-live="polite"
      className={`pointer-events-none fixed inset-x-0 z-30 flex justify-center px-4 ${
        raised
          ? "bottom-[calc(15rem+env(safe-area-inset-bottom))]"
          : "bottom-[calc(20px+env(safe-area-inset-bottom))]"
      }`}
    >
      {toast ? (
        <div
          role={toast.tone === "error" ? "alert" : undefined}
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
