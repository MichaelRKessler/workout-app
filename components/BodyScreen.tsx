"use client";

import { BodyConfirmSheet } from "@/components/body/BodyConfirmSheet";
import { MeasureFields } from "@/components/body/MeasureFields";
import { requestBodyProposal } from "@/components/body/requestBody";
import { newBodyClientId, toPending } from "@/components/body/saveBodyEntry";
import { Button } from "@/components/Button";
import { MicIcon } from "@/components/icons";
import { useOfflineLog } from "@/components/OfflineSync";
import { PageHeader } from "@/components/PageHeader";
import { Sheet } from "@/components/Sheet";
import { useBrowserTimeZone } from "@/components/useBrowserTimeZone";
import { useLengthUnit, useWeightUnit } from "@/components/WeightUnit";
import { ListeningOverlay } from "@/components/workout/ListeningOverlay";
import { blobToBase64 } from "@/components/workout/requestProposal";
import { TrendChart } from "@/components/workout/TrendChart";
import { useRecorder } from "@/components/workout/useRecorder";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { formatDateInput } from "@/lib/bodyDate";
import {
  draftFromStored,
  emptyBodyDraft,
  formatBodySummary,
  measuresFromDraft,
  weightHint,
  type BodyDraft,
} from "@/lib/bodyDraft";
import { readableError } from "@/lib/errors";
import { formatShortDate } from "@/lib/format";
import { OFFLINE_VOICE_MESSAGE, QUEUED_SAVE_MESSAGE } from "@/lib/offline/messages";
import type { BodyProposal } from "@/lib/voice/bodyProposal";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import Link from "next/link";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

type StoredEntry = {
  _id: Id<"bodyEntries">;
  loggedAt: number;
  weightLb: number | null;
  bodyFatPct: number | null;
  waistCm: number | null;
  chestCm: number | null;
  armCm: number | null;
  hipsCm: number | null;
  thighCm: number | null;
  note: string | null;
  clientId: string | null;
};

type VoicePhase = "idle" | "recording" | "parsing";

export function BodyScreen() {
  const weightUnit = useWeightUnit();
  const lengthUnit = useLengthUnit();
  const timeZone = useBrowserTimeZone();
  const { offline, outbox, saveBody, discardPendingBody } = useOfflineLog();
  const summary = useQuery(api.body.summary, {});
  const { results, status, loadMore } = usePaginatedQuery(api.body.list, {}, { initialNumItems: 20 });
  const updateEntry = useMutation(api.body.update);
  const removeEntry = useMutation(api.body.remove);

  const [draft, setDraft] = useState<BodyDraft | null>(null);
  const [today, setToday] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [voicePhase, setVoicePhase] = useState<VoicePhase>("idle");
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [voiceProposal, setVoiceProposal] = useState<BodyProposal | null>(null);
  const [editing, setEditing] = useState<StoredEntry | null>(null);
  const [editDraft, setEditDraft] = useState<BodyDraft | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const parseAbortRef = useRef<AbortController | null>(null);

  const recorder = useRecorder({
    onAudio: (blob) => void parseAudio(blob),
    onError: (message) => {
      setVoicePhase("idle");
      setVoiceError(message);
    },
  });

  useEffect(() => {
    const now = Date.now();
    setToday(formatDateInput(now));
    setDraft(emptyBodyDraft(now));
    return () => {
      parseAbortRef.current?.abort();
    };
  }, []);

  const pending = useMemo(() => {
    const savedIds = new Set(
      results.map((entry) => entry.clientId).filter((id): id is string => id !== null),
    );
    return outbox.body.filter((entry) => !entry.echoed && !savedIds.has(entry.clientId));
  }, [outbox.body, results]);

  const chartPoints = useMemo(() => {
    const server = (summary?.weightTrend ?? []).map((point) => ({
      sessionId: String(point.entryId),
      startedAt: point.loggedAt,
      value: point.weightLb,
      volumeLb: 0,
    }));
    const known = new Set(server.map((point) => point.sessionId));
    const waiting = pending.flatMap((entry) => {
      if (entry.weightLb === null || known.has(entry.clientId)) {
        return [];
      }
      return [
        {
          sessionId: entry.clientId,
          startedAt: entry.loggedAt,
          value: entry.weightLb,
          volumeLb: 0,
        },
      ];
    });
    return [...server, ...waiting].sort((left, right) => left.startedAt - right.startedAt);
  }, [pending, summary?.weightTrend]);

  const latest = useMemo(() => {
    const server = summary?.latest ?? null;
    const waiting = [...pending].sort((left, right) => right.loggedAt - left.loggedAt)[0] ?? null;
    if (!server) {
      return waiting;
    }
    if (!waiting || server.loggedAt >= waiting.loggedAt) {
      return server;
    }
    return waiting;
  }, [pending, summary?.latest]);

  // The newest entry may hold only a measurement, so hint from the newest weigh-in.
  const weightPlaceholder = weightHint(chartPoints.at(-1)?.value, weightUnit);

  async function saveNew(next: BodyDraft) {
    if (!draft) {
      return;
    }
    const parsed = measuresFromDraft(next, weightUnit, lengthUnit);
    if (!parsed.ok) {
      setFormError(parsed.error);
      return;
    }
    setSaving(true);
    setFormError(null);
    setNotice(null);
    try {
      const outcome = await saveBody(toPending(newBodyClientId(), parsed.save));
      if (outcome.status === "rejected") {
        setFormError(outcome.error ?? "That entry could not be saved.");
        return;
      }
      setDraft(emptyBodyDraft());
      setToday(formatDateInput(Date.now()));
      setNotice(outcome.status === "queued" ? QUEUED_SAVE_MESSAGE : "Saved.");
    } catch (caught) {
      setFormError(readableError(caught));
    } finally {
      setSaving(false);
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || saving) {
      return;
    }
    void saveNew(draft);
  }

  async function startVoice() {
    if (offline) {
      setVoiceError(OFFLINE_VOICE_MESSAGE);
      return;
    }
    setVoiceError(null);
    setNotice(null);
    const started = await recorder.start();
    if (started) {
      setVoicePhase("recording");
    }
  }

  function stopVoice() {
    setVoicePhase("parsing");
    recorder.stop();
  }

  function cancelVoice() {
    parseAbortRef.current?.abort();
    recorder.cancel();
    setVoicePhase("idle");
  }

  async function parseAudio(blob: Blob) {
    parseAbortRef.current?.abort();
    const controller = new AbortController();
    parseAbortRef.current = controller;
    setVoicePhase("parsing");
    try {
      const audioBase64 = await blobToBase64(blob);
      const proposal = await requestBodyProposal(
        { audioBase64, mimeType: blob.type },
        controller.signal,
      );
      if (controller.signal.aborted) {
        return;
      }
      setVoiceProposal(proposal);
      setVoicePhase("idle");
      setVoiceError(null);
    } catch (caught) {
      if (!controller.signal.aborted) {
        setVoicePhase("idle");
        setVoiceError(readableError(caught));
      }
    }
  }

  function openEdit(entry: StoredEntry) {
    setEditing(entry);
    setEditDraft(draftFromStored(entry, weightUnit, lengthUnit));
    setEditError(null);
    setConfirmingDelete(false);
  }

  async function saveEdit() {
    if (!editing || !editDraft || saving) {
      return;
    }
    if (offline) {
      setEditError("Editing a saved entry needs a connection.");
      return;
    }
    const parsed = measuresFromDraft(editDraft, weightUnit, lengthUnit);
    if (!parsed.ok) {
      setEditError(parsed.error);
      return;
    }
    setSaving(true);
    setEditError(null);
    try {
      await updateEntry({
        entryId: editing._id,
        loggedAt: parsed.save.loggedAt,
        ...(parsed.save.weightLb !== undefined ? { weightLb: parsed.save.weightLb } : {}),
        ...(parsed.save.bodyFatPct !== undefined ? { bodyFatPct: parsed.save.bodyFatPct } : {}),
        ...(parsed.save.waistCm !== undefined ? { waistCm: parsed.save.waistCm } : {}),
        ...(parsed.save.chestCm !== undefined ? { chestCm: parsed.save.chestCm } : {}),
        ...(parsed.save.armCm !== undefined ? { armCm: parsed.save.armCm } : {}),
        ...(parsed.save.hipsCm !== undefined ? { hipsCm: parsed.save.hipsCm } : {}),
        ...(parsed.save.thighCm !== undefined ? { thighCm: parsed.save.thighCm } : {}),
        ...(parsed.save.note !== undefined ? { note: parsed.save.note } : {}),
      });
      setEditing(null);
      setEditDraft(null);
    } catch (caught) {
      setEditError(readableError(caught));
    } finally {
      setSaving(false);
    }
  }

  async function deleteEdit() {
    if (!editing || saving) {
      return;
    }
    if (offline) {
      setEditError("Deleting a saved entry needs a connection.");
      return;
    }
    setSaving(true);
    setEditError(null);
    try {
      await removeEntry({ entryId: editing._id });
      setEditing(null);
      setEditDraft(null);
    } catch (caught) {
      setEditError(readableError(caught));
    } finally {
      setSaving(false);
    }
  }

  const unitLine =
    weightUnit === "lb" && lengthUnit === "in"
      ? "Weight in lb. Measurements in inches."
      : `Weight in ${weightUnit}. Measurements in ${lengthUnit}.`;

  return (
    <div className="px-5 pt-3 pb-[calc(32px+var(--page-inset))]">
      <PageHeader title="Body">
        <p className="mt-1.5 text-base leading-normal text-muted">
          {unitLine}{" "}
          <Link href="/settings" className="font-medium text-foreground underline">
            Change units
          </Link>
        </p>
      </PageHeader>

      {latest ? (
        <p aria-label="Latest" className="mt-4 text-base text-pretty" suppressHydrationWarning>
          <span className="font-medium">Latest · </span>
          {formatBodySummary(latest, weightUnit, lengthUnit)}
          <span className="text-muted">
            {" · "}
            {formatShortDate(latest.loggedAt)}
            {"syncError" in latest && latest.syncError ? ` · ${latest.syncError}` : ""}
            {"echoed" in latest ? " · on this phone" : ""}
          </span>
        </p>
      ) : summary === undefined ? (
        <p className="mt-8 text-base text-muted">Loading body log…</p>
      ) : (
        <p className="mt-6 max-w-[22.5rem] text-base leading-normal text-muted">
          Add a weight when you want to. Measurements are optional, and nothing here is required
          before a workout.
        </p>
      )}

      {chartPoints.length > 0 ? (
        <TrendChart
          points={chartPoints}
          recordUnit="lb"
          weightUnit={weightUnit}
          timeZone={timeZone}
          linkDays={false}
          noun="weigh-in"
          valueCaption="Weight"
          series="body"
        />
      ) : null}
      {summary?.trendTruncated ? (
        <p className="mt-2 text-sm text-subtle">Trend uses your latest 400 entries.</p>
      ) : null}

      <form onSubmit={onSubmit} className="mt-6">
        <h2 className="text-xs font-medium tracking-[0.06em] text-subtle uppercase">Add an entry</h2>
        {draft && today ? (
          <MeasureFields
            idPrefix="new"
            weightPlaceholder={weightPlaceholder}
            draft={draft}
            maxDate={today}
            weightUnit={weightUnit}
            lengthUnit={lengthUnit}
            onChange={(patch) => setDraft((current) => (current ? { ...current, ...patch } : current))}
          />
        ) : (
          <p className="mt-3 text-base text-muted">Preparing the form…</p>
        )}
        {formError ? (
          <p role="alert" className="mt-3 text-sm text-danger">
            {formError}
          </p>
        ) : null}
        {notice ? (
          <p role="status" className="mt-3 text-sm text-muted">
            {notice}
          </p>
        ) : null}
        {voiceError ? (
          <p role="alert" className="mt-3 text-sm text-danger">
            {voiceError}
          </p>
        ) : null}
        <div className="mt-4 flex gap-2.5">
          <Button type="submit" size="lg" className="flex-1" disabled={!draft || saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
          <button
            type="button"
            aria-label="Log a measurement by voice"
            disabled={offline || saving || voicePhase === "parsing"}
            onClick={() => void startVoice()}
            className="flex size-13 shrink-0 items-center justify-center rounded-full bg-inverse text-inverse-ink disabled:opacity-40"
          >
            <MicIcon className="size-6" />
          </button>
        </div>
        <p className="mt-2 text-sm text-subtle">
          {offline ? OFFLINE_VOICE_MESSAGE : `Say “weight ${weightPlaceholder ?? (weightUnit === "kg" ? "80" : "180")}”. Nothing is saved until you confirm.`}
        </p>
      </form>

      <section aria-label="History" className="mt-8">
        <h2 className="text-xs font-medium tracking-[0.06em] text-subtle uppercase">History</h2>
        {pending.length === 0 && results.length === 0 && status !== "LoadingFirstPage" ? (
          <p className="mt-3 text-base text-muted">No entries yet.</p>
        ) : null}
        {status === "LoadingFirstPage" && pending.length === 0 ? (
          <p className="mt-3 text-base text-muted">Loading history…</p>
        ) : null}
        <ul className="mt-2 flex flex-col">
          {pending.map((entry) => (
            <li key={entry.clientId} className="flex items-center justify-between gap-3 border-b border-line py-3">
              <span className="min-w-0">
                <span className="block text-base font-medium text-pretty">
                  {formatBodySummary(entry, weightUnit, lengthUnit)}
                </span>
                <span className="text-sm text-muted" suppressHydrationWarning>
                  {formatShortDate(entry.loggedAt)} · on this phone
                  {entry.syncError ? ` · ${entry.syncError}` : ""}
                </span>
              </span>
              <button
                type="button"
                onClick={() => discardPendingBody(entry.clientId)}
                className="min-h-11 shrink-0 rounded-full px-3 text-sm font-medium text-danger hover:bg-fill-2"
              >
                Discard
              </button>
            </li>
          ))}
          {results.map((entry) => (
            <li key={entry._id} className="border-b border-line">
              <button
                type="button"
                onClick={() => openEdit(entry)}
                className="flex min-h-14 w-full flex-col items-start justify-center py-3 text-left hover:bg-fill-2"
              >
                <span className="text-base font-medium text-pretty">
                  {formatBodySummary(entry, weightUnit, lengthUnit)}
                </span>
                <span className="text-sm text-muted" suppressHydrationWarning>
                  {formatShortDate(entry.loggedAt)}
                  {entry.note ? ` · ${entry.note}` : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {status === "CanLoadMore" ? (
          <Button variant="secondary" className="mt-6 w-full" onClick={() => loadMore(20)}>
            Load more
          </Button>
        ) : null}
        {status === "LoadingMore" ? (
          <p className="mt-6 text-center text-sm text-muted">Loading more…</p>
        ) : null}
      </section>

      {voicePhase === "recording" || voicePhase === "parsing" ? (
        <ListeningOverlay
          status={voicePhase}
          analyser={recorder.analyser}
          onStop={stopVoice}
          onCancel={cancelVoice}
          prompt="Say your weight, or a measurement."
          example="“Weight 232” or “waist 34 inches”"
        />
      ) : null}

      <BodyConfirmSheet
        proposal={voiceProposal}
        onClose={() => setVoiceProposal(null)}
        onSaved={(outcome) => {
          setVoiceProposal(null);
          setNotice(outcome.status === "queued" ? QUEUED_SAVE_MESSAGE : "Saved.");
        }}
      />

      <Sheet
        open={editing !== null && editDraft !== null}
        onClose={() => {
          if (!saving) {
            setEditing(null);
            setEditDraft(null);
          }
        }}
        labelledBy="body-edit-title"
        dismissible={!saving}
      >
        {editDraft && today ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void saveEdit();
            }}
          >
            <h2 id="body-edit-title" className="mt-2 text-xl font-semibold tracking-[-0.02em]">
              Edit entry
            </h2>
            <MeasureFields
              idPrefix="edit"
              draft={editDraft}
              maxDate={today}
              weightUnit={weightUnit}
              lengthUnit={lengthUnit}
              extraOpen
              onChange={(patch) =>
                setEditDraft((current) => (current ? { ...current, ...patch } : current))
              }
            />
            {editError ? (
              <p role="alert" className="mt-3 text-sm text-danger">
                {editError}
              </p>
            ) : null}
            <div className="mt-6 flex gap-2.5">
              <Button
                type="button"
                variant="secondary"
                size="lg"
                className="flex-1"
                disabled={saving}
                onClick={() => {
                  setEditing(null);
                  setEditDraft(null);
                }}
              >
                Cancel
              </Button>
              <Button type="submit" size="lg" className="flex-1" disabled={saving || offline}>
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
            {confirmingDelete ? (
              <div className="mt-3">
                <p className="text-base text-muted">Delete this entry? This cannot be undone.</p>
                <div className="mt-2 flex gap-2.5">
                  <Button
                    type="button"
                    variant="secondary"
                    size="lg"
                    className="flex-1"
                    disabled={saving}
                    onClick={() => setConfirmingDelete(false)}
                  >
                    Keep entry
                  </Button>
                  <Button
                    type="button"
                    variant="danger"
                    size="lg"
                    className="flex-1"
                    disabled={saving || offline}
                    onClick={() => void deleteEdit()}
                  >
                    {saving ? "Deleting…" : "Delete entry"}
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                type="button"
                variant="danger"
                size="lg"
                className="mt-2 w-full"
                disabled={saving || offline}
                onClick={() => setConfirmingDelete(true)}
              >
                Delete entry
              </Button>
            )}
            {offline ? (
              <p className="mt-2 text-sm text-muted">Editing or deleting a saved entry needs a connection.</p>
            ) : null}
          </form>
        ) : null}
      </Sheet>
    </div>
  );
}
