"use client";

import { Button } from "@/components/Button";
import { CloseIcon, KeyboardIcon, MicIcon, PlusIcon, RetryIcon } from "@/components/icons";
import { Sheet } from "@/components/Sheet";
import { ExerciseTile } from "@/components/workout/ExerciseRow";
import { pluralize } from "@/lib/format";
import type { VoiceDraft } from "@/lib/voice/confirm";
import { MAX_VOICE_SETS } from "@/lib/voice/proposal";

const fieldClass =
  "h-12 w-full min-w-0 rounded-xl border border-line bg-background text-center font-mono text-lg font-medium text-foreground outline-none focus:border-foreground disabled:opacity-60";

/** The parsed sets, editable, before anything is written. */
export function ConfirmSheet({
  open,
  draft,
  source,
  saving,
  notice,
  onChange,
  onDiscard,
  onConfirm,
  onRecordAgain,
}: {
  open: boolean;
  draft: VoiceDraft | null;
  source: "voice" | "text";
  saving: boolean;
  notice: string | null;
  onChange: (draft: VoiceDraft) => void;
  onDiscard: () => void;
  onConfirm: () => void;
  onRecordAgain: () => void;
}) {
  if (!draft) {
    return null;
  }

  function updateSet(index: number, patch: Partial<VoiceDraft["sets"][number]>) {
    if (!draft) {
      return;
    }
    onChange({
      ...draft,
      sets: draft.sets.map((set, setIndex) => (setIndex === index ? { ...set, ...patch } : set)),
    });
  }

  function removeSet(index: number) {
    if (!draft || draft.sets.length <= 1) {
      return;
    }
    onChange({ ...draft, sets: draft.sets.filter((_, setIndex) => setIndex !== index) });
  }

  function addSet() {
    if (!draft || draft.sets.length >= MAX_VOICE_SETS) {
      return;
    }
    const last = draft.sets[draft.sets.length - 1] ?? { reps: "10", weight: "0" };
    onChange({ ...draft, sets: [...draft.sets, { ...last }] });
  }

  const count = draft.sets.length;

  return (
    <Sheet open={open} onClose={onDiscard} labelledBy="confirm-title" dismissible={!saving}>
      <div className="flex items-center justify-between">
        <h2
          id="confirm-title"
          className="flex items-center gap-1.5 text-[11px] font-medium tracking-[0.1em] text-subtle uppercase"
        >
          {source === "voice" ? (
            <MicIcon className="size-3.5" strokeWidth={2} />
          ) : (
            <KeyboardIcon className="size-3.5" strokeWidth={2} />
          )}
          Check before saving
        </h2>
        {source === "voice" ? (
          <button
            type="button"
            onClick={onRecordAgain}
            disabled={saving}
            className="-mr-3 flex min-h-11 items-center gap-1.5 rounded-full px-3 text-sm font-medium disabled:opacity-50"
          >
            <RetryIcon className="size-4" strokeWidth={1.9} />
            Record again
          </button>
        ) : (
          <span className="min-h-11" />
        )}
      </div>

      <div className="mt-1.5 flex items-center gap-3">
        <ExerciseTile name={draft.exerciseName} />
        <label htmlFor="confirm-exercise" className="sr-only">
          Exercise
        </label>
        <input
          id="confirm-exercise"
          value={draft.exerciseName}
          onChange={(event) => onChange({ ...draft, exerciseName: event.target.value })}
          disabled={saving}
          autoComplete="off"
          maxLength={80}
          className="h-12 min-w-0 flex-1 border-0 border-b border-line bg-transparent p-0 text-[22px] font-semibold tracking-[-0.02em] text-foreground outline-none focus:border-foreground disabled:opacity-60"
        />
      </div>

      <div className="mt-5 grid grid-cols-[28px_minmax(0,1fr)_minmax(0,1fr)_44px] items-center gap-x-2.5 gap-y-2">
        <span className="text-[11px] font-medium tracking-[0.1em] text-subtle uppercase">Set</span>
        <span className="text-center text-[11px] font-medium tracking-[0.1em] text-subtle uppercase">
          Reps
        </span>
        <span className="text-center text-[11px] font-medium tracking-[0.1em] text-subtle uppercase">
          Weight · lb
        </span>
        <span />
        {draft.sets.map((set, index) => (
          <div key={index} className="contents">
            <span className="font-mono text-[15px] text-muted">{index + 1}</span>
            <input
              value={set.reps}
              onChange={(event) => updateSet(index, { reps: event.target.value })}
              inputMode="numeric"
              autoComplete="off"
              disabled={saving}
              aria-label={`Set ${index + 1} reps`}
              className={fieldClass}
            />
            <input
              value={set.weight}
              onChange={(event) => updateSet(index, { weight: event.target.value })}
              inputMode="decimal"
              autoComplete="off"
              disabled={saving}
              aria-label={`Set ${index + 1} weight in pounds`}
              className={fieldClass}
            />
            <button
              type="button"
              onClick={() => removeSet(index)}
              disabled={saving || count <= 1}
              aria-label={`Remove set ${index + 1}`}
              className="flex size-11 items-center justify-center rounded-full text-subtle hover:bg-fill-2 disabled:opacity-30"
            >
              <CloseIcon className="size-[18px]" strokeWidth={1.8} />
            </button>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={addSet}
        disabled={saving || count >= MAX_VOICE_SETS}
        className="mt-1.5 flex min-h-11 items-center gap-2 self-start text-[15px] font-medium disabled:opacity-50"
      >
        <PlusIcon className="size-[18px]" strokeWidth={1.8} />
        Add a set
      </button>

      {notice ? (
        <p role="alert" className="mt-1.5 text-sm leading-5 text-danger">
          {notice}
        </p>
      ) : (
        <p className="mt-1.5 text-[13px] text-subtle">
          Weights are in pounds, 0 is bodyweight. Nothing is saved until you add them.
        </p>
      )}

      <div className="mt-4 flex gap-2.5">
        <Button variant="secondary" size="lg" className="flex-1" onClick={onDiscard} disabled={saving}>
          Discard
        </Button>
        <Button size="lg" className="flex-[1.6]" onClick={onConfirm} disabled={saving}>
          {saving ? "Saving…" : `Add ${pluralize(count, "set")}`}
        </Button>
      </div>
    </Sheet>
  );
}
