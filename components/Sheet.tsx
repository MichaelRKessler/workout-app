"use client";

import { ReactNode, useEffect, useRef } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Bottom sheet dialog. Focus moves to the panel (not into a field, so the phone
 * keyboard stays down), Tab stays inside, Escape and the scrim close it.
 */
export function Sheet({
  open,
  onClose,
  labelledBy,
  dismissible = true,
  children,
}: {
  open: boolean;
  onClose: () => void;
  labelledBy: string;
  dismissible?: boolean;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const dismissibleRef = useRef(dismissible);
  useEffect(() => {
    onCloseRef.current = onClose;
    dismissibleRef.current = dismissible;
  });

  useEffect(() => {
    if (!open) {
      return;
    }
    const previous =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.focus({ preventScroll: true });
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && dismissibleRef.current) {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) {
        return;
      }
      const items = [...panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) {
        return;
      }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = overflow;
      previous?.focus({ preventScroll: true });
    };
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center">
      <div
        aria-hidden="true"
        onClick={() => {
          if (dismissible) {
            onClose();
          }
        }}
        className="absolute inset-0 animate-[fade-in_160ms_ease-out] bg-scrim"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className="relative flex max-h-[92dvh] w-full max-w-lg animate-[sheet-in_220ms_cubic-bezier(0.2,0.8,0.2,1)] flex-col overflow-y-auto rounded-t-[28px] bg-surface px-5 pt-2 pb-[calc(20px+env(safe-area-inset-bottom))] shadow-sheet outline-none"
      >
        <div aria-hidden="true" className="mx-auto mb-2 h-[5px] w-9 shrink-0 rounded-full bg-line" />
        {children}
      </div>
    </div>
  );
}
