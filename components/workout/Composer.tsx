"use client";

import { ArrowUpIcon, MicIcon, PlusIcon, Spinner } from "@/components/icons";
import { MAX_WORKOUT_TEXT_LENGTH } from "@/lib/voice/proposal";
import { FormEvent } from "react";

/** The bottom bar during a workout: + for the form, a field for typed sets, and the mic. */
export function Composer({
  text,
  onTextChange,
  onSubmitText,
  parsingText,
  onVoice,
  onManual,
  busy,
  offline = false,
}: {
  text: string;
  onTextChange: (value: string) => void;
  onSubmitText: () => void;
  parsingText: boolean;
  onVoice: () => void;
  onManual: () => void;
  busy: boolean;
  offline?: boolean;
}) {
  const hasText = text.trim().length > 0;

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (hasText && !parsingText && !offline) {
      onSubmitText();
    }
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-20 bg-background px-4 pt-3 pb-[calc(16px+env(safe-area-inset-bottom))]">
      <form onSubmit={onSubmit} className="mx-auto flex max-w-lg items-center gap-2.5">
        <div className="flex h-14 min-w-0 flex-1 items-center gap-1 rounded-full border border-line bg-surface px-1.5 shadow-float focus-within:border-foreground/40">
          <button
            type="button"
            onClick={onManual}
            aria-label="Add a set by hand"
            className="flex size-11 shrink-0 items-center justify-center rounded-full bg-fill-2 text-foreground hover:bg-fill"
          >
            <PlusIcon className="size-5" />
          </button>
          <label htmlFor="composer" className="sr-only">
            Type a set
          </label>
          <input
            id="composer"
            value={text}
            onChange={(event) => onTextChange(event.target.value)}
            placeholder={offline ? "Add a set by hand" : "Type a set…"}
            autoComplete="off"
            enterKeyHint="send"
            maxLength={MAX_WORKOUT_TEXT_LENGTH}
            disabled={parsingText || offline}
            className="h-11 min-w-0 flex-1 bg-transparent px-1.5 text-base text-foreground outline-none placeholder:text-subtle disabled:opacity-60"
          />
        </div>
        {hasText || parsingText ? (
          <button
            type="submit"
            disabled={parsingText || offline}
            aria-label={parsingText ? "Reading that" : "Send"}
            className="flex size-16 shrink-0 items-center justify-center rounded-full bg-inverse text-inverse-ink shadow-lift disabled:opacity-80"
          >
            {parsingText ? <Spinner className="size-6" /> : <ArrowUpIcon className="size-7" strokeWidth={2} />}
          </button>
        ) : (
          <button
            type="button"
            onClick={onVoice}
            disabled={busy || offline}
            aria-label="Log a set by voice"
            className="flex size-16 shrink-0 items-center justify-center rounded-full bg-inverse text-inverse-ink shadow-lift disabled:opacity-60"
          >
            <MicIcon className="size-7" strokeWidth={1.7} />
          </button>
        )}
      </form>
    </div>
  );
}
