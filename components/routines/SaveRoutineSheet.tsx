"use client";

import { Button } from "@/components/Button";
import { Sheet } from "@/components/Sheet";
import { FormEvent, useState } from "react";

export function SaveRoutineSheet({
  open,
  defaultName,
  summary,
  pending,
  error,
  onCancel,
  onSave,
}: {
  open: boolean;
  defaultName: string;
  summary: string;
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onSave: (name: string) => void;
}) {
  const [name, setName] = useState(defaultName);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pending) {
      onSave(name);
    }
  }

  return (
    <Sheet open={open} onClose={onCancel} labelledBy="save-routine-title" dismissible={!pending}>
      <form onSubmit={onSubmit}>
        <h2 id="save-routine-title" className="mt-2 text-xl font-semibold tracking-[-0.02em]">
          Save as routine
        </h2>
        <p className="mt-1.5 text-base leading-normal text-muted">
          {summary} Targets come from the sets you logged. You can edit them after saving.
        </p>
        <label htmlFor="routine-name" className="mt-4 block text-xs font-medium tracking-[0.06em] text-subtle uppercase">
          Name
        </label>
        <input
          id="routine-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={40}
          autoComplete="off"
          className="mt-2 h-12 w-full rounded-xl border border-line bg-background px-3 text-base outline-none focus:border-foreground"
        />
        {error ? (
          <p role="alert" className="mt-3 text-sm text-danger">
            {error}
          </p>
        ) : null}
        <div className="mt-6 flex gap-2.5">
          <Button variant="secondary" size="lg" className="flex-1" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" size="lg" className="flex-1" disabled={pending || name.trim().length === 0}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </Sheet>
  );
}
