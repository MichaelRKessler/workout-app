"use client";

import { Button } from "@/components/Button";
import { KeyboardIcon, MicIcon, PlusIcon, RetryIcon } from "@/components/icons";
import { Sheet } from "@/components/Sheet";
import { useWeightUnit } from "@/components/WeightUnit";
import { ExerciseTile } from "@/components/workout/ExerciseRow";
import { usePreviousExercise } from "@/components/workout/usePreviousExercise";
import type { Id } from "@/convex/_generated/dataModel";
import type { SetKind } from "@/convex/lib/measures";
import { pluralize } from "@/lib/format";
import { SetTypePicker } from "@/components/SetTypePicker";
import { newDraftSetId, type DraftSet, type VoiceDraft } from "@/lib/voice/confirm";
import { MAX_VOICE_SETS } from "@/lib/voice/proposal";
import { cleanSupersetId, linkWithNext, supersetBlocks, unlinkSuperset } from "@/convex/lib/superset";
import {
  draftGroupLabel,
  groupIdenticalSets,
  patchSetGroup,
  resizeSetGroup,
  withDraftSetIds,
} from "@/lib/confirmGroups";
import { useState } from "react";

const fieldClass =
  "h-12 w-full min-w-0 rounded-xl border border-input bg-background text-center font-mono text-lg font-medium text-foreground outline-none focus:border-foreground disabled:opacity-60";

/** The parsed exercises, each editable, before anything is written. */
export function ConfirmSheet({
  open,
  draft,
  source,
  saving,
  notice,
  excludeSessionId,
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
  excludeSessionId?: Id<"sessions">;
  onChange: (draft: VoiceDraft) => void;
  onDiscard: () => void;
  onConfirm: () => void;
  onRecordAgain: () => void;
}) {
  const unit = useWeightUnit();
  if (!draft) {
    return null;
  }

  const count = draft.exercises.reduce((sum, exercise) => sum + exercise.sets.length, 0);

  function updateExercise(index: number, patch: Partial<VoiceDraft["exercises"][number]>) {
    if (!draft) {
      return;
    }
    onChange({
      ...draft,
      exercises: draft.exercises.map((exercise, exerciseIndex) =>
        exerciseIndex === index ? { ...exercise, ...patch } : exercise,
      ),
    });
  }

  function removeExercise(index: number) {
    if (!draft || draft.exercises.length <= 1) {
      return;
    }
    onChange({
      ...draft,
      exercises: draft.exercises.filter((_, exerciseIndex) => exerciseIndex !== index),
    });
  }

  function replaceExercises(exercises: VoiceDraft["exercises"]) {
    if (!draft) {
      return;
    }
    onChange({
      ...draft,
      exercises: exercises.map((exercise) => ({
        ...exercise,
        supersetId: cleanSupersetId(exercise.supersetId) ?? null,
      })),
    });
  }

  return (
    <Sheet
      open={open}
      onClose={onDiscard}
      labelledBy="confirm-title"
      dismissible={!saving}
      closeOnScrim={false}
    >
      <div className="flex items-center justify-between">
        <h2
          id="confirm-title"
          className="flex items-center gap-1.5 text-xs font-medium tracking-[0.06em] text-subtle uppercase"
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

      <div className="mt-3 flex flex-col gap-4">
        {confirmBlocks(draft.exercises).map((block) => (
          <div
            key={block.start}
            className={block.supersetId ? "rounded-2xl border-l-2 border-foreground pl-3" : undefined}
          >
            {block.supersetId ? (
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-medium tracking-[0.06em] text-subtle uppercase">Superset</p>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => replaceExercises(unlinkSuperset(draft.exercises, block.start))}
                  className="min-h-11 text-sm font-medium text-muted disabled:opacity-50"
                >
                  Ungroup
                </button>
              </div>
            ) : null}
            <div className="flex flex-col gap-4">
              {block.indexes.map((at) => {
                const exercise = draft.exercises[at];
                const next = draft.exercises[at + 1];
                if (!exercise) {
                  return null;
                }
                const linked =
                  cleanSupersetId(exercise.supersetId) !== undefined &&
                  cleanSupersetId(exercise.supersetId) === cleanSupersetId(next?.supersetId);
                return (
                  <div key={exercise.draftId ?? `index-${at}`}>
                    <ExerciseConfirmBlock
                      exercise={exercise}
                      index={at}
                      unit={unit}
                      saving={saving}
                      canRemoveExercise={draft.exercises.length > 1}
                      totalSets={count}
                      excludeSessionId={excludeSessionId}
                      onChange={(nextExercise) => updateExercise(at, nextExercise)}
                      onRemove={() => removeExercise(at)}
                    />
                    {at < draft.exercises.length - 1 && !linked ? (
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => replaceExercises(linkWithNext(draft.exercises, at))}
                        className="mt-2 min-h-11 text-sm font-medium text-muted disabled:opacity-50"
                      >
                        Superset with next
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <label htmlFor="confirm-note" className="mt-4 text-xs font-medium tracking-[0.06em] text-subtle uppercase">
        Note
      </label>
      <textarea
        id="confirm-note"
        value={draft.note}
        onChange={(event) => onChange({ ...draft, note: event.target.value })}
        disabled={saving}
        maxLength={500}
        rows={2}
        placeholder="Optional"
        className="mt-2 w-full resize-none rounded-xl border border-input bg-background px-3 py-2 text-base text-foreground outline-none focus:border-foreground disabled:opacity-60"
      />

      {notice ? (
        <p role="alert" className="mt-1.5 text-sm text-danger">
          {notice}
        </p>
      ) : (
        <p className="mt-1.5 text-sm text-subtle">
          Weights are in {unit}. 0 is bodyweight. Nothing is saved until you add them.
        </p>
      )}

      <div className="mt-4 flex gap-2.5">
        <Button variant="secondary" size="lg" className="flex-1" onClick={onDiscard} disabled={saving}>
          Discard
        </Button>
        <Button size="lg" className="flex-[1.6]" onClick={onConfirm} disabled={saving || count === 0}>
          {saving ? "Saving…" : `Add ${pluralize(count, "set")}`}
        </Button>
      </div>
    </Sheet>
  );
}

function ExerciseConfirmBlock({
  exercise,
  index,
  unit,
  saving,
  canRemoveExercise,
  totalSets,
  excludeSessionId,
  onChange,
  onRemove,
}: {
  exercise: VoiceDraft["exercises"][number];
  index: number;
  unit: "lb" | "kg";
  saving: boolean;
  canRemoveExercise: boolean;
  totalSets: number;
  excludeSessionId?: Id<"sessions">;
  onChange: (exercise: VoiceDraft["exercises"][number]) => void;
  onRemove: () => void;
}) {
  const history = usePreviousExercise(exercise.exerciseName, excludeSessionId);
  // The open row is remembered by its sets' ids, not its position, so editing
  // it into a match with a neighbor cannot regroup it shut.
  const [openIds, setOpenIds] = useState<ReadonlySet<string> | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [splitIds, setSplitIds] = useState<Set<string>>(() => new Set());
  const groups = groupIdenticalSets(exercise.sets, splitIds, openIds ?? undefined);

  function closeRow() {
    setOpenIds(null);
    setMoreOpen(false);
  }

  function openRow(start: number, count: number) {
    const held = withDraftSetIds(exercise.sets, start, count, newDraftSetId);
    if (held.sets !== exercise.sets) {
      replaceSets(held.sets);
    }
    setOpenIds(new Set(held.ids));
    setMoreOpen(false);
  }

  function replaceSets(sets: DraftSet[]) {
    onChange({ ...exercise, sets });
  }

  function patchGroup(start: number, count: number, patch: Partial<DraftSet>) {
    replaceSets(patchSetGroup(exercise.sets, start, count, patch));
  }

  function changeCount(start: number, count: number, nextCount: number) {
    if (nextCount > count && totalSets >= MAX_VOICE_SETS) {
      return;
    }
    const room = MAX_VOICE_SETS - totalSets;
    const capped = nextCount > count ? Math.min(nextCount, count + room) : nextCount;
    const resized = resizeSetGroup(exercise.sets, start, count, capped);
    if (capped <= count) {
      replaceSets(resized);
      return;
    }
    // New copies join the open row, or they would show as a row of their own.
    const added = withDraftSetIds(resized, start + count, capped - count, newDraftSetId);
    replaceSets(added.sets);
    setOpenIds((current) => (current ? new Set([...current, ...added.ids]) : current));
  }

  function splitGroup(start: number, count: number) {
    const split = withDraftSetIds(exercise.sets, start, count, newDraftSetId);
    replaceSets(split.sets);
    setSplitIds((current) => new Set([...current, ...split.ids]));
    closeRow();
  }

  function removeSet(setIndex: number) {
    if (exercise.sets.length <= 1) {
      return;
    }
    onChange({ ...exercise, sets: exercise.sets.filter((_, index) => index !== setIndex) });
    closeRow();
  }

  function addSet() {
    if (totalSets >= MAX_VOICE_SETS) {
      return;
    }
    const last = exercise.sets[exercise.sets.length - 1] ?? blankSet();
    onChange({ ...exercise, sets: [...exercise.sets, { ...last, draftSetId: undefined }] });
  }

  return (
    <section className="rounded-2xl border border-line bg-background p-3">
      <div className="flex items-center gap-3">
        <ExerciseTile name={exercise.exerciseName} />
        <label htmlFor={`confirm-exercise-${index}`} className="sr-only">
          Exercise {index + 1}
        </label>
        <input
          id={`confirm-exercise-${index}`}
          value={exercise.exerciseName}
          onChange={(event) => onChange({ ...exercise, exerciseName: event.target.value })}
          disabled={saving}
          autoComplete="off"
          maxLength={80}
          className="h-12 min-w-0 flex-1 border-0 border-b border-input bg-transparent p-0 text-day font-semibold tracking-[-0.02em] text-foreground outline-none focus:border-foreground disabled:opacity-60"
        />
        {canRemoveExercise ? (
          <button
            type="button"
            onClick={onRemove}
            disabled={saving}
            className="min-h-11 rounded-full px-2 text-base font-medium text-danger hover:bg-fill-2 disabled:opacity-40"
          >
            Remove
          </button>
        ) : null}
      </div>
      {/* No progress link here: leaving the page would drop the unsaved parse. */}
      {history.label ? <p className="mt-2 text-base text-muted">{history.label}</p> : null}

      <div className="mt-3 flex flex-col gap-2">
        {groups.map((group) => {
          const sample = exercise.sets[group.start];
          if (!sample) {
            return null;
          }
          const label = draftGroupLabel(group.count, sample, unit);
          const open =
            openIds !== null && sample.draftSetId !== undefined && openIds.has(sample.draftSetId);
          const more = open && moreOpen;
          return (
            <div key={group.start} className="rounded-2xl bg-surface p-2">
              <button
                type="button"
                aria-expanded={open}
                disabled={saving}
                onClick={() => (open ? closeRow() : openRow(group.start, group.count))}
                className="flex min-h-14 w-full items-center text-left text-lg font-semibold disabled:opacity-60"
              >
                {label}
              </button>
              {open ? (
                <div className="mt-2 flex flex-col gap-3">
                  <div className="grid grid-cols-2 gap-2">
                    {sample.kind === "strength" ? (
                      <Field
                        label="Reps"
                        value={sample.reps}
                        inputMode="numeric"
                        disabled={saving}
                        onChange={(reps) => patchGroup(group.start, group.count, { reps })}
                      />
                    ) : null}
                    {sample.kind !== "strength" ? (
                      <Field
                        label={sample.kind === "distance" ? "Distance" : "Time"}
                        value={sample.kind === "distance" ? sample.distance : sample.duration}
                        inputMode="text"
                        disabled={saving}
                        onChange={(value) =>
                          patchGroup(
                            group.start,
                            group.count,
                            sample.kind === "distance" ? { distance: value } : { duration: value },
                          )
                        }
                      />
                    ) : null}
                    <Field
                      label={`Weight · ${unit}`}
                      value={sample.weight}
                      inputMode="decimal"
                      disabled={saving}
                      onChange={(weight) => patchGroup(group.start, group.count, { weight, weightLb: null })}
                    />
                    {sample.kind === "distance" ? (
                      <Field
                        label="Time"
                        value={sample.duration}
                        inputMode="text"
                        disabled={saving}
                        onChange={(duration) => patchGroup(group.start, group.count, { duration })}
                      />
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      aria-label={`One fewer set of ${exercise.exerciseName}`}
                      disabled={saving || group.count <= 1}
                      onClick={() => changeCount(group.start, group.count, group.count - 1)}
                      className="min-h-11 rounded-full border border-input px-4 text-base font-semibold disabled:opacity-40"
                    >
                      −1
                    </button>
                    <span className="min-w-16 text-center text-base font-medium">
                      {group.count === 1 ? "1 set" : `${group.count} sets`}
                    </span>
                    <button
                      type="button"
                      aria-label={`One more set of ${exercise.exerciseName}`}
                      disabled={saving || totalSets >= MAX_VOICE_SETS}
                      onClick={() => changeCount(group.start, group.count, group.count + 1)}
                      className="min-h-11 rounded-full border border-input px-4 text-base font-semibold disabled:opacity-40"
                    >
                      +1
                    </button>
                    {group.count > 1 ? (
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => splitGroup(group.start, group.count)}
                        className="min-h-11 rounded-full px-3 text-base font-medium text-muted disabled:opacity-40"
                      >
                        Split
                      </button>
                    ) : exercise.sets.length > 1 ? (
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => removeSet(group.start)}
                        className="min-h-11 rounded-full px-3 text-base font-medium text-danger disabled:opacity-40"
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    aria-expanded={more}
                    disabled={saving}
                    onClick={() => setMoreOpen(!more)}
                    className="min-h-11 self-start text-base font-medium"
                  >
                    {more ? "Less" : "More"}
                  </button>
                  {more ? (
                    <div className="flex flex-col gap-3">
                      <KindSwitch
                        kind={sample.kind}
                        disabled={saving}
                        onChange={(kind) => patchGroup(group.start, group.count, { kind })}
                      />
                      <SetTypePicker
                        value={sample.setType}
                        disabled={saving}
                        onChange={(setType) => patchGroup(group.start, group.count, { setType })}
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <Field
                          label="RPE"
                          value={sample.rpe}
                          inputMode="numeric"
                          disabled={saving}
                          onChange={(rpe) => patchGroup(group.start, group.count, { rpe })}
                        />
                        <Field
                          label="Calories"
                          value={sample.calories}
                          inputMode="numeric"
                          disabled={saving}
                          onChange={(calories) => patchGroup(group.start, group.count, { calories })}
                        />
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={addSet}
        disabled={saving || totalSets >= MAX_VOICE_SETS}
        className="mt-1.5 flex min-h-11 items-center gap-2 self-start text-base font-medium disabled:opacity-50"
      >
        <PlusIcon className="size-5" strokeWidth={1.8} />
        Add a set
      </button>
    </section>
  );
}

function KindSwitch({
  kind,
  disabled,
  onChange,
}: {
  kind: SetKind;
  disabled: boolean;
  onChange: (kind: SetKind) => void;
}) {
  const options: Array<{ id: SetKind; label: string }> = [
    { id: "strength", label: "Reps" },
    { id: "timed", label: "Time" },
    { id: "distance", label: "Distance" },
  ];
  return (
    <div role="group" aria-label="How this set is measured" className="flex rounded-full border border-input p-0.5">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={kind === option.id}
          disabled={disabled}
          onClick={() => onChange(option.id)}
          className={`min-h-11 flex-1 rounded-full px-1.5 text-sm font-medium whitespace-nowrap disabled:opacity-50 ${
            kind === option.id ? "bg-inverse text-inverse-ink" : "text-muted"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function Field({
  label,
  value,
  inputMode,
  disabled,
  wide = false,
  onChange,
}: {
  label: string;
  value: string;
  inputMode: "numeric" | "decimal" | "text";
  disabled: boolean;
  wide?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className={`flex flex-col gap-1 ${wide ? "col-span-2" : ""}`}>
      <span className="text-xs font-medium tracking-[0.06em] text-subtle uppercase">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        inputMode={inputMode}
        autoComplete="off"
        disabled={disabled}
        aria-label={label}
        className={fieldClass}
      />
    </label>
  );
}

function confirmBlocks(exercises: VoiceDraft["exercises"]) {
  const blocks: Array<{ start: number; supersetId: string | null; indexes: number[] }> = [];
  let cursor = 0;
  for (const block of supersetBlocks(exercises)) {
    const indexes = block.items.map((_, offset) => cursor + offset);
    blocks.push({ start: cursor, supersetId: block.supersetId, indexes });
    cursor += block.items.length;
  }
  return blocks;
}

function blankSet(): DraftSet {
  return {
    kind: "strength",
    reps: "10",
    weight: "0",
    duration: "",
    distance: "",
    calories: "",
    rpe: "",
    weightLb: 0,
    setType: "working",
  };
}
