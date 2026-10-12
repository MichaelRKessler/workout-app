"use client";

import { Button } from "@/components/Button";
import { Sheet } from "@/components/Sheet";
import type { PendingItem } from "@/lib/offline/pendingItems";
import { useState } from "react";

/**
 * Lists queued changes. Discard asks first and says what will be lost.
 * The first action keeps the change.
 */
export function PendingChanges({
  open,
  onClose,
  items,
  storageWarning,
  onRetry,
  onRetryAll,
  onDiscard,
}: {
  open: boolean;
  onClose: () => void;
  items: PendingItem[];
  storageWarning: string | null;
  onRetry: (id: string) => void;
  onRetryAll: () => void;
  onDiscard: (id: string) => void;
}) {
  const [confirming, setConfirming] = useState<PendingItem | null>(null);
  const failed = items.some((item) => item.failed);

  function close() {
    setConfirming(null);
    onClose();
  }

  return (
    <Sheet
      open={open}
      onClose={() => {
        if (confirming) {
          setConfirming(null);
          return;
        }
        close();
      }}
      labelledBy="pending-changes-title"
    >
      {confirming ? (
        <div>
          <h2 id="pending-changes-title" className="mt-2 text-xl font-semibold tracking-[-0.02em]">
            Discard this change?
          </h2>
          <p className="mt-1.5 text-base leading-normal text-muted">{confirming.lost}</p>
          <div className="mt-6 flex flex-col gap-2.5">
            <Button size="lg" className="w-full" onClick={() => setConfirming(null)}>
              Keep this change
            </Button>
            <Button
              variant="danger"
              size="lg"
              className="w-full border border-danger"
              onClick={() => {
                onDiscard(confirming.id);
                setConfirming(null);
              }}
            >
              Discard
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <h2 id="pending-changes-title" className="mt-2 text-xl font-semibold tracking-[-0.02em]">
            Pending changes
          </h2>
          <p className="mt-1.5 text-base leading-normal text-muted">
            These are still on this phone. Keeping them is the default.
          </p>
          {storageWarning ? (
            <p role="alert" className="mt-3 text-sm text-danger">
              {storageWarning}
            </p>
          ) : null}
          {items.length === 0 ? (
            <p className="mt-4 text-base text-muted">Nothing is waiting.</p>
          ) : (
            <ul className="mt-4 flex flex-col gap-3">
              {items.map((item) => (
                <li key={item.id} className="rounded-2xl border border-line px-4 py-3">
                  <p className="font-semibold">{item.title}</p>
                  <p className="text-sm text-muted">{item.detail}</p>
                  {item.error ? (
                    <p role="alert" className="mt-1 text-sm text-danger">
                      {item.error}
                    </p>
                  ) : null}
                  <div className="mt-3 flex gap-2">
                    {item.failed ? (
                      <Button size="md" variant="secondary" onClick={() => onRetry(item.id)}>
                        Retry
                      </Button>
                    ) : null}
                    <Button size="md" variant="danger" onClick={() => setConfirming(item)}>
                      Discard
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {failed ? (
            <Button size="lg" variant="secondary" className="mt-4 w-full" onClick={onRetryAll}>
              Retry all
            </Button>
          ) : null}
          <Button size="lg" variant="primary" className="mt-3 w-full" onClick={close}>
            Keep these changes
          </Button>
        </div>
      )}
    </Sheet>
  );
}
