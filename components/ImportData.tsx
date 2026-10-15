"use client";

import { Button } from "@/components/Button";
import { useOfflineLog } from "@/components/OfflineSync";
import { Sheet } from "@/components/Sheet";
import { useLengthUnit, useWeightUnit } from "@/components/WeightUnit";
import { api } from "@/convex/_generated/api";
import { formatBodySummary } from "@/lib/bodyDraft";
import { readableError } from "@/lib/errors";
import { formatDayTitle, formatSetShort, pluralize } from "@/lib/format";
import { calendarDayKey } from "@/lib/historyDays";
import { readImportResponse, type ImportProposal } from "@/lib/import/proposal";
import { ImportFileError, prepareImportFiles, type ImportPart } from "@/lib/import/readFile";
import {
  importDays,
  mergeProposals,
  reviewImport,
  workoutSaves,
  type ExistingDay,
  type ImportReview,
} from "@/lib/import/review";
import { useConvex } from "convex/react";
import Link from "next/link";
import { useId, useRef, useState } from "react";

const READ_AT_ONCE = 3;
const CHECK_DAYS_PER_QUERY = 40;
const LIST_PREVIEW = 30;

type Stage =
  | { name: "pick"; error: string | null }
  | { name: "reading"; done: number; total: number }
  | { name: "review"; review: ImportReview; failedParts: number }
  | { name: "saving"; done: number; total: number }
  | { name: "done"; workouts: number; body: number; failed: number; error: string | null };

/** Settings row that opens the file import. */
export function ImportData() {
  const { offline } = useOfflineLog();
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t border-line">
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={offline}
        className="flex min-h-14 w-full items-center justify-between px-4 text-left text-base font-medium hover:bg-fill-2 disabled:opacity-60"
      >
        Import from a file
        <span className="text-sm font-normal text-muted">Any format</span>
      </button>
      {offline ? (
        <p className="border-t border-line px-4 py-3 text-sm leading-normal text-muted">
          Import needs a connection.
        </p>
      ) : null}
      {open ? <ImportSheet onClose={() => setOpen(false)} /> : null}
    </div>
  );
}

function ImportSheet({ onClose }: { onClose: () => void }) {
  const convex = useConvex();
  const weightUnit = useWeightUnit();
  const lengthUnit = useLengthUnit();
  const titleId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [stage, setStage] = useState<Stage>({ name: "pick", error: null });
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const busy = stage.name === "reading" || stage.name === "saving";

  function close() {
    abortRef.current?.abort();
    onClose();
  }

  async function read(files: File[]) {
    if (files.length === 0) {
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    let parts: ImportPart[];
    try {
      parts = await prepareImportFiles(files, { shrinkImage });
    } catch (caught) {
      setStage({
        name: "pick",
        error: caught instanceof ImportFileError ? caught.message : "That file could not be opened.",
      });
      return;
    }
    setStage({ name: "reading", done: 0, total: parts.length });
    const today = calendarDayKey(Date.now());
    // Kept in file order, so a workout split across parts keeps its sets in order.
    const proposals: Array<ImportProposal | undefined> = [];
    const errors: string[] = [];
    let done = 0;
    let next = 0;
    async function worker() {
      while (next < parts.length && !controller.signal.aborted) {
        const index = next;
        next += 1;
        const part = parts[index];
        if (!part) {
          continue;
        }
        try {
          proposals[index] = await requestPart(part, index, parts.length, today, controller.signal);
        } catch (caught) {
          if (controller.signal.aborted) {
            return;
          }
          errors.push(readableError(caught));
        }
        done += 1;
        setStage({ name: "reading", done, total: parts.length });
      }
    }
    await Promise.all(Array.from({ length: Math.min(READ_AT_ONCE, parts.length) }, worker));
    if (controller.signal.aborted) {
      return;
    }
    const answered = proposals.filter((proposal): proposal is ImportProposal => proposal !== undefined);
    if (answered.length === 0) {
      setStage({ name: "pick", error: errors[0] ?? "That file could not be read. Try another file." });
      return;
    }
    const merged = mergeProposals(answered);
    try {
      const existing = await loadExisting(merged);
      const review = reviewImport(merged, existing, Date.now());
      if (review.workouts.length === 0 && review.body.length === 0) {
        setStage({
          name: "pick",
          error: "No workouts or body measurements were found in that file.",
        });
        return;
      }
      setSkipped(new Set());
      setStage({ name: "review", review, failedParts: errors.length });
    } catch (caught) {
      setStage({ name: "pick", error: readableError(caught) });
    }
  }

  async function loadExisting(proposal: ImportProposal): Promise<Map<string, ExistingDay>> {
    const days = importDays(proposal);
    const existing = new Map<string, ExistingDay>();
    for (let start = 0; start < days.length; start += CHECK_DAYS_PER_QUERY) {
      const rows = await convex.query(api.imports.existingDays, {
        days: days.slice(start, start + CHECK_DAYS_PER_QUERY),
      });
      for (const row of rows) {
        existing.set(row.key, { exerciseKeys: new Set(row.exerciseKeys), body: row.body });
      }
    }
    return existing;
  }

  async function save(review: ImportReview) {
    const workouts = review.workouts.filter((workout) => !workout.duplicate && !skipped.has(workout.id));
    const body = review.body.filter((entry) => !entry.duplicate && !skipped.has(entry.id));
    const total = workouts.length + body.length;
    let done = 0;
    let savedWorkouts = 0;
    let savedBody = 0;
    let failed = 0;
    let error: string | null = null;
    setStage({ name: "saving", done, total });
    for (const workout of workouts) {
      try {
        for (const piece of workoutSaves(workout)) {
          await convex.mutation(api.sessions.logPast, piece);
        }
        savedWorkouts += 1;
      } catch (caught) {
        failed += 1;
        error = error ?? readableError(caught);
      }
      done += 1;
      setStage({ name: "saving", done, total });
    }
    for (const entry of body) {
      try {
        await convex.mutation(api.body.save, {
          loggedAt: entry.loggedAt,
          ...(entry.weightLb !== null ? { weightLb: entry.weightLb } : {}),
          ...(entry.bodyFatPct !== null ? { bodyFatPct: entry.bodyFatPct } : {}),
          ...(entry.waistCm !== null ? { waistCm: entry.waistCm } : {}),
          ...(entry.chestCm !== null ? { chestCm: entry.chestCm } : {}),
          ...(entry.armCm !== null ? { armCm: entry.armCm } : {}),
          ...(entry.hipsCm !== null ? { hipsCm: entry.hipsCm } : {}),
          ...(entry.thighCm !== null ? { thighCm: entry.thighCm } : {}),
          ...(entry.note ? { note: entry.note } : {}),
        });
        savedBody += 1;
      } catch (caught) {
        failed += 1;
        error = error ?? readableError(caught);
      }
      done += 1;
      setStage({ name: "saving", done, total });
    }
    setStage({ name: "done", workouts: savedWorkouts, body: savedBody, failed, error });
  }

  function toggle(id: string) {
    setSkipped((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  return (
    <Sheet open onClose={close} labelledBy={titleId} dismissible={stage.name !== "saving"} closeOnScrim={!busy}>
      <h2 id={titleId} className="text-xl font-semibold">
        Import history
      </h2>

      {stage.name === "pick" ? (
        <div className="mt-2">
          <p className="text-base leading-normal text-muted">
            Pick a file with your workouts, your body weight and measurements, or both. A spreadsheet, a CSV, another
            app&apos;s export, a PDF, or a photo of a notebook all work. You&apos;ll check everything before it&apos;s
            saved.
          </p>
          {stage.error ? (
            <p role="alert" className="mt-3 text-sm leading-normal text-danger">
              {stage.error}
            </p>
          ) : null}
          <input
            ref={inputRef}
            type="file"
            multiple
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(event) => {
              const files = [...(event.target.files ?? [])];
              event.target.value = "";
              void read(files);
            }}
          />
          <div className="mt-5 flex gap-3">
            <Button variant="secondary" onClick={close} className="flex-1">
              Cancel
            </Button>
            <Button onClick={() => inputRef.current?.click()} className="flex-1">
              Choose file
            </Button>
          </div>
        </div>
      ) : null}

      {stage.name === "reading" || stage.name === "saving" ? (
        <div className="mt-4" role="status">
          <p className="text-base">
            {stage.name === "reading"
              ? stage.total > 1
                ? `Reading your file, part ${Math.min(stage.done + 1, stage.total)} of ${stage.total}…`
                : "Reading your file…"
              : `Saving ${Math.min(stage.done + 1, stage.total)} of ${stage.total}…`}
          </p>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-fill-2">
            <div
              className="h-full rounded-full bg-inverse transition-[width]"
              style={{ width: `${stage.total === 0 ? 0 : Math.round((stage.done / stage.total) * 100)}%` }}
            />
          </div>
          {stage.name === "reading" ? (
            <Button variant="secondary" onClick={close} className="mt-5 w-full">
              Cancel
            </Button>
          ) : null}
        </div>
      ) : null}

      {stage.name === "review" ? (
        <ReviewList
          review={stage.review}
          failedParts={stage.failedParts}
          skipped={skipped}
          onToggle={toggle}
          onCancel={close}
          onSave={() => void save(stage.review)}
          weightUnit={weightUnit}
          lengthUnit={lengthUnit}
        />
      ) : null}

      {stage.name === "done" ? (
        <div className="mt-2">
          <p role="status" className="text-base leading-normal">
            {doneSentence(stage.workouts, stage.body)}
          </p>
          {stage.failed > 0 ? (
            <p role="alert" className="mt-2 text-sm leading-normal text-danger">
              {pluralize(stage.failed, "item")} could not be saved{stage.error ? `: ${stage.error}` : "."}
            </p>
          ) : null}
          <div className="mt-5 flex gap-3">
            {stage.workouts > 0 ? (
              <Link
                href="/history"
                className="inline-flex min-h-11 flex-1 items-center justify-center rounded-full border border-line px-5 font-semibold hover:bg-fill-2"
              >
                History
              </Link>
            ) : null}
            {stage.body > 0 ? (
              <Link
                href="/body"
                className="inline-flex min-h-11 flex-1 items-center justify-center rounded-full border border-line px-5 font-semibold hover:bg-fill-2"
              >
                Body
              </Link>
            ) : null}
            <Button onClick={close} className="flex-1">
              Done
            </Button>
          </div>
        </div>
      ) : null}
    </Sheet>
  );
}

function ReviewList({
  review,
  failedParts,
  skipped,
  onToggle,
  onCancel,
  onSave,
  weightUnit,
  lengthUnit,
}: {
  review: ImportReview;
  failedParts: number;
  skipped: Set<string>;
  onToggle: (id: string) => void;
  onCancel: () => void;
  onSave: () => void;
  weightUnit: ReturnType<typeof useWeightUnit>;
  lengthUnit: ReturnType<typeof useLengthUnit>;
}) {
  const [showAllWorkouts, setShowAllWorkouts] = useState(false);
  const [showAllBody, setShowAllBody] = useState(false);
  const newWorkouts = review.workouts.filter((workout) => !workout.duplicate && !skipped.has(workout.id));
  const newBody = review.body.filter((entry) => !entry.duplicate && !skipped.has(entry.id));
  const duplicateWorkouts = review.workouts.filter((workout) => workout.duplicate).length;
  const duplicateBody = review.body.filter((entry) => entry.duplicate).length;
  const duplicateExercises = review.workouts.some(
    (workout) => !workout.duplicate && workout.exercises.some((exercise) => exercise.duplicate),
  );
  const shownWorkouts = showAllWorkouts ? review.workouts : review.workouts.slice(0, LIST_PREVIEW);
  const shownBody = showAllBody ? review.body : review.body.slice(0, LIST_PREVIEW);
  const nothing = newWorkouts.length === 0 && newBody.length === 0;

  return (
    <div className="mt-1">
      <p className="text-base leading-normal">
        Found {foundSentence(review.workouts.length, review.body.length)}
        {dateRange(review)}.
      </p>
      {duplicateWorkouts > 0 || duplicateBody > 0 || duplicateExercises ? (
        <p className="mt-1 text-sm leading-normal text-muted">
          Anything already in Spotter is marked and will be skipped.
        </p>
      ) : null}
      {review.unreadable > 0 || failedParts > 0 ? (
        <p className="mt-1 text-sm leading-normal text-muted">
          {[
            review.unreadable > 0 ? `${pluralize(review.unreadable, "row")} couldn't be read and were left out.` : null,
            failedParts > 0 ? `${pluralize(failedParts, "part")} of the file couldn't be read.` : null,
          ]
            .filter(Boolean)
            .join(" ")}
        </p>
      ) : null}

      {review.workouts.length > 0 ? (
        <section aria-label="Workouts" className="mt-4">
          <h3 className="text-xs font-medium tracking-[0.06em] text-subtle uppercase">Workouts</h3>
          <ul className="mt-1 divide-y divide-line rounded-[1.25rem] border border-line">
            {shownWorkouts.map((workout) => {
              const included = !workout.duplicate && !skipped.has(workout.id);
              return (
                <li key={workout.id} className="px-4 py-3">
                  <label className={`flex items-start gap-3 ${workout.duplicate ? "" : "cursor-pointer"}`}>
                    <input
                      type="checkbox"
                      className="mt-1 size-5 shrink-0 accent-current"
                      checked={included}
                      disabled={workout.duplicate}
                      onChange={() => onToggle(workout.id)}
                    />
                    <span className={`min-w-0 flex-1 ${included ? "" : "text-muted"}`}>
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="font-medium">{formatDayTitle(workout.startedAt)}</span>
                        {workout.duplicate ? <span className="text-sm text-muted">Already logged</span> : null}
                      </span>
                      {workout.exercises.map((exercise, index) => (
                        <span key={index} className="mt-0.5 block text-sm leading-normal text-muted">
                          <span className={exercise.duplicate ? "line-through" : "text-foreground"}>
                            {exercise.exerciseName}
                          </span>{" "}
                          {exercise.sets.map((set) => formatSetShort(set, weightUnit)).join(", ")}
                          {exercise.duplicate && !workout.duplicate ? " · already logged" : ""}
                        </span>
                      ))}
                      {workout.note ? (
                        <span className="mt-0.5 block text-sm italic text-muted">{workout.note}</span>
                      ) : null}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          {review.workouts.length > shownWorkouts.length ? (
            <Button variant="ghost" onClick={() => setShowAllWorkouts(true)} className="mt-1 w-full">
              Show all {review.workouts.length} workouts
            </Button>
          ) : null}
        </section>
      ) : null}

      {review.body.length > 0 ? (
        <section aria-label="Body" className="mt-4">
          <h3 className="text-xs font-medium tracking-[0.06em] text-subtle uppercase">Body</h3>
          <ul className="mt-1 divide-y divide-line rounded-[1.25rem] border border-line">
            {shownBody.map((entry) => {
              const included = !entry.duplicate && !skipped.has(entry.id);
              return (
                <li key={entry.id} className="px-4 py-3">
                  <label className={`flex items-start gap-3 ${entry.duplicate ? "" : "cursor-pointer"}`}>
                    <input
                      type="checkbox"
                      className="mt-1 size-5 shrink-0 accent-current"
                      checked={included}
                      disabled={entry.duplicate}
                      onChange={() => onToggle(entry.id)}
                    />
                    <span className={`min-w-0 flex-1 ${included ? "" : "text-muted"}`}>
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="font-medium">{formatDayTitle(entry.loggedAt)}</span>
                        {entry.duplicate ? <span className="text-sm text-muted">Already logged</span> : null}
                      </span>
                      <span className="mt-0.5 block text-sm leading-normal text-muted">
                        {formatBodySummary(entry, weightUnit, lengthUnit)}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          {review.body.length > shownBody.length ? (
            <Button variant="ghost" onClick={() => setShowAllBody(true)} className="mt-1 w-full">
              Show all {review.body.length} entries
            </Button>
          ) : null}
        </section>
      ) : null}

      {/* The sheet's own bottom padding sits under this bar, so the list never shows below it. */}
      <div className="sticky bottom-[calc(-20px-env(safe-area-inset-bottom))] -mx-5 mt-4 -mb-[calc(20px+env(safe-area-inset-bottom))] border-t border-line bg-surface px-5 pt-3 pb-[calc(20px+env(safe-area-inset-bottom))]">
        <p className="text-sm text-muted">
          {nothing ? "Nothing new to save." : `${foundSentence(newWorkouts.length, newBody.length)} will be saved.`}
        </p>
        <div className="mt-2 flex gap-3">
          <Button variant="secondary" onClick={onCancel} className="flex-1">
            Cancel
          </Button>
          <Button onClick={onSave} disabled={nothing} className="flex-1">
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}

function foundSentence(workouts: number, body: number): string {
  const parts: string[] = [];
  if (workouts > 0) {
    parts.push(pluralize(workouts, "workout"));
  }
  if (body > 0) {
    parts.push(pluralize(body, "body entry", "body entries"));
  }
  return parts.join(" and ");
}

function doneSentence(workouts: number, body: number): string {
  if (workouts === 0 && body === 0) {
    return "Nothing was saved.";
  }
  return `Saved ${foundSentence(workouts, body)}.`;
}

function dateRange(review: ImportReview): string {
  const times = [...review.workouts.map((workout) => workout.startedAt), ...review.body.map((entry) => entry.loggedAt)];
  if (times.length < 2) {
    return "";
  }
  const first = Math.min(...times);
  const last = Math.max(...times);
  const format = (at: number) =>
    new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(at);
  return calendarDayKey(first) === calendarDayKey(last) ? "" : `, from ${format(first)} to ${format(last)}`;
}

async function requestPart(
  part: ImportPart,
  index: number,
  count: number,
  today: string,
  signal: AbortSignal,
): Promise<ImportProposal> {
  const body =
    part.kind === "text"
      ? { text: part.text, part: { index, count }, today }
      : { fileBase64: part.base64, mimeType: part.mimeType, today };
  let lastError: unknown = null;
  // One retry: a long file makes many requests, and one may hit a passing hiccup.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal,
      });
      let payload: unknown = null;
      try {
        payload = (await response.json()) as unknown;
      } catch {
        payload = null;
      }
      if (!response.ok) {
        const message =
          typeof payload === "object" && payload !== null && "error" in payload && typeof payload.error === "string"
            ? payload.error
            : "That file could not be read. Try another file.";
        if (response.status < 500) {
          throw new ImportFileError(message);
        }
        throw new Error(message);
      }
      return readImportResponse(payload);
    } catch (caught) {
      if (caught instanceof ImportFileError || signal.aborted) {
        throw caught;
      }
      lastError = caught;
    }
  }
  throw lastError;
}

/** A phone photo is often over 3 MB. A smaller JPEG is still easy to read. */
async function shrinkImage(file: Blob): Promise<{ mimeType: string; bytes: Uint8Array } | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    return blob ? { mimeType: "image/jpeg", bytes: new Uint8Array(await blob.arrayBuffer()) } : null;
  } catch {
    return null;
  }
}
