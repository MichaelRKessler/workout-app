"use client";

import { MeasureFields } from "@/components/body/MeasureFields";
import { newBodyClientId, toPending } from "@/components/body/saveBodyEntry";
import { Button } from "@/components/Button";
import { useOfflineLog, type SyncOutcome } from "@/components/OfflineSync";
import { Sheet } from "@/components/Sheet";
import { useLengthUnit, useWeightUnit } from "@/components/WeightUnit";
import { formatDateInput } from "@/lib/bodyDate";
import { draftFromProposal, measuresFromDraft, type BodyDraft, type BodySave } from "@/lib/bodyDraft";
import { readableError } from "@/lib/errors";
import type { BodyProposal } from "@/lib/voice/bodyProposal";
import { useState } from "react";

/**
 * Confirms a weigh-in heard by voice or typed, from the Body tab or the main
 * log. Nothing is stored until the person saves.
 */
export function BodyConfirmSheet({
  proposal,
  onClose,
  onSaved,
}: {
  proposal: BodyProposal | null;
  onClose: () => void;
  onSaved: (outcome: SyncOutcome, save: BodySave) => void;
}) {
  const weightUnit = useWeightUnit();
  const lengthUnit = useLengthUnit();
  const { saveBody } = useOfflineLog();
  const [shown, setShown] = useState<BodyProposal | null>(null);
  const [draft, setDraft] = useState<BodyDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // A new proposal starts a fresh draft, without an effect.
  if (proposal !== shown) {
    setShown(proposal);
    setDraft(proposal ? draftFromProposal(proposal, weightUnit, lengthUnit) : null);
    setError(null);
  }

  async function save() {
    if (!draft || saving) {
      return;
    }
    const parsed = measuresFromDraft(draft, weightUnit, lengthUnit);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const outcome = await saveBody(toPending(newBodyClientId(), parsed.save));
      if (outcome.status === "rejected") {
        setError(outcome.error ?? "That entry could not be saved.");
        return;
      }
      onSaved(outcome, parsed.save);
    } catch (caught) {
      setError(readableError(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet
      open={proposal !== null && draft !== null}
      onClose={() => {
        if (!saving) {
          onClose();
        }
      }}
      labelledBy="body-confirm-title"
      dismissible={!saving}
    >
      {draft ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <h2 id="body-confirm-title" className="mt-2 text-xl font-semibold tracking-[-0.02em]">
            Save this measurement?
          </h2>
          <p className="mt-1.5 text-base leading-normal text-muted">
            Check it first. Nothing is stored until you save.
          </p>
          <MeasureFields
            idPrefix="confirm"
            draft={draft}
            maxDate={formatDateInput(Date.now())}
            weightUnit={weightUnit}
            lengthUnit={lengthUnit}
            extraOpen
            onChange={(patch) => setDraft((current) => (current ? { ...current, ...patch } : current))}
          />
          {error ? (
            <p role="alert" className="mt-3 text-sm text-danger">
              {error}
            </p>
          ) : null}
          <div className="mt-6 flex gap-2.5">
            <Button
              type="button"
              variant="secondary"
              size="lg"
              className="flex-1"
              disabled={saving}
              onClick={onClose}
            >
              Discard
            </Button>
            <Button type="submit" size="lg" className="flex-1" disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      ) : null}
    </Sheet>
  );
}
