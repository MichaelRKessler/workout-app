"use client";

import { useOfflineLog, type SyncOutcome } from "@/components/OfflineSync";
import type { ToastMessage } from "@/components/Toast";
import type { WeightUnit } from "@/convex/lib/units";
import { formatPersonalRecord, formatPersonalRecords, pluralize } from "@/lib/format";
import type { SetLine } from "@/lib/groupSets";
import { QUEUED_SAVE_MESSAGE } from "@/lib/offline/messages";
import { takeToast } from "@/lib/pendingToast";
import type { setFromPrefill } from "@/lib/prefill";
import { useEffect, useState } from "react";

export type Toasted = ToastMessage & { id: number };

export type ManualForm =
  | { key: number; mode: "add"; exerciseName: string }
  | {
      key: number;
      mode: "edit";
      setId: string;
      exerciseName: string;
      reps: number | null;
      weightLb: number;
      durationSec: number | null;
      distanceM: number | null;
      calories: number | null;
      rpe: number | null;
      setType?: SetLine["setType"];
    };

export type ManualSet = {
  exerciseName: string;
  reps?: number;
  weightLb: number;
  durationSec?: number;
  distanceM?: number;
  calories?: number;
  rpe?: number;
  setType: SetLine["setType"];
};

type OpenTarget = { sessionId: string | null; sessionStartedAt: number };

/**
 * Saving, repeating, editing, and removing sets in the open workout, and the
 * toast that reports each one with its Undo.
 */
export function useSetActions({
  unit,
  sessionSets,
  lastExerciseName,
  openTarget,
  onOpenForm,
}: {
  unit: WeightUnit;
  sessionSets: SetLine[];
  /** The form opens on this exercise when none is given. */
  lastExerciseName: string;
  openTarget: () => OpenTarget;
  /** Runs before the add or edit form opens, so a voice error can step aside. */
  onOpenForm: () => void;
}) {
  const log = useOfflineLog();
  const [toast, setToast] = useState<Toasted | null>(null);
  const [manual, setManual] = useState<ManualForm | null>(null);
  const [manualPending, setManualPending] = useState(false);
  const [repeatingId, setRepeatingId] = useState<string | null>(null);
  const [loggingPlanId, setLoggingPlanId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  useEffect(() => {
    const pending = takeToast();
    if (pending) {
      setToast({ id: Date.now(), tone: "info", message: pending });
    }
  }, []);

  function showToast(message: ToastMessage) {
    setToast({ ...message, id: Date.now() });
  }

  function clearToast() {
    setToast(null);
  }

  function showSaved(saved: SyncOutcome, exerciseName: string) {
    if (saved.status === "queued") {
      showToast({ tone: "info", message: QUEUED_SAVE_MESSAGE });
      return;
    }
    const count = saved.setIds.length || saved.clientIds.length;
    if (count === 0) {
      return;
    }
    const added = `Added ${pluralize(count, "set")} · ${exerciseName}`;
    const record = formatPersonalRecords(saved.personalRecords, unit);
    const undoIds = saved.setIds.length > 0 ? saved.setIds : saved.clientIds;
    showToast({
      tone: "info",
      message: record ? `${record}. ${added}` : added,
      action: { label: "Undo", onClick: () => void undo(undoIds) },
    });
  }

  async function undo(ids: string[]) {
    setToast(null);
    const removed = await log.removeMany(ids);
    if (removed.status === "rejected" && removed.error) {
      showToast({ tone: "error", message: removed.error });
    }
  }

  function openManual(exerciseName?: string) {
    onOpenForm();
    setToast(null);
    setManual({
      key: Date.now(),
      mode: "add",
      // A click handler passed straight through hands over its event, not a name.
      exerciseName: typeof exerciseName === "string" ? exerciseName : lastExerciseName,
    });
  }

  function openEdit(set: SetLine) {
    onOpenForm();
    setToast(null);
    setManual({
      key: Date.now(),
      mode: "edit",
      setId: set._id,
      exerciseName: set.exerciseName,
      reps: set.reps,
      weightLb: set.weightLb,
      durationSec: set.durationSec,
      distanceM: set.distanceM,
      calories: set.calories ?? null,
      rpe: set.rpe,
      setType: set.setType,
    });
  }

  /** Returns the message to show in the form, or null once it is saved. */
  async function addManual(set: ManualSet): Promise<string | null> {
    setManualPending(true);
    try {
      const measures = {
        weightLb: set.weightLb,
        reps: set.reps ?? null,
        durationSec: set.durationSec ?? null,
        distanceM: set.distanceM ?? null,
        calories: set.calories ?? null,
        rpe: set.rpe ?? null,
        setType: set.setType ?? "working",
      };
      if (manual?.mode === "edit") {
        const saved = await log.editSet({
          setId: manual.setId,
          clientId: sessionSets.find((item) => item._id === manual.setId)?.clientId,
          ...measures,
        });
        if (saved.status === "rejected") {
          return saved.error ?? "That set could not be saved";
        }
        setManual(null);
        if (saved.status === "queued") {
          showToast({ tone: "info", message: QUEUED_SAVE_MESSAGE });
        } else if (saved.personalRecords[0]) {
          showToast({
            tone: "info",
            message: formatPersonalRecord(saved.personalRecords[0], unit),
          });
        }
        return null;
      }
      const target = openTarget();
      const saved = await log.saveSets({
        placement: "open",
        sessionId: target.sessionId,
        sessionStartedAt: target.sessionStartedAt,
        note: null,
        sets: [{ exerciseName: set.exerciseName, ...measures }],
      });
      if (saved.status === "rejected") {
        return saved.error ?? "That set could not be saved";
      }
      setManual(null);
      showSaved(saved, set.exerciseName);
      return null;
    } finally {
      setManualPending(false);
    }
  }

  async function repeatSet(group: { exerciseId: string; name: string; sets: SetLine[] }) {
    const last = group.sets[group.sets.length - 1];
    if (!last) {
      return;
    }
    setRepeatingId(group.exerciseId);
    const target = openTarget();
    const saved = await log.saveSets({
      placement: "open",
      sessionId: target.sessionId,
      sessionStartedAt: target.sessionStartedAt,
      note: null,
      sets: [
        {
          exerciseName: group.name,
          weightLb: last.weightLb,
          reps: last.reps,
          durationSec: last.durationSec,
          distanceM: last.distanceM,
          calories: last.calories ?? null,
          rpe: last.rpe,
          ...(last.setType !== undefined ? { setType: last.setType } : {}),
        },
      ],
    });
    setRepeatingId(null);
    if (saved.status === "rejected") {
      showToast({ tone: "error", message: saved.error ?? "That set could not be saved" });
      return;
    }
    showSaved(saved, group.name);
  }

  async function logPlanSet(
    exerciseId: string,
    exerciseName: string,
    set: ReturnType<typeof setFromPrefill>,
  ) {
    if (!set) {
      return;
    }
    setLoggingPlanId(exerciseId);
    const target = openTarget();
    const saved = await log.saveSets({
      placement: "open",
      sessionId: target.sessionId,
      sessionStartedAt: target.sessionStartedAt,
      note: null,
      sets: [
        {
          exerciseName,
          weightLb: set.weightLb,
          reps: set.reps,
          durationSec: set.durationSec,
          distanceM: set.distanceM,
          calories: set.calories,
          setType: set.setType,
        },
      ],
    });
    setLoggingPlanId(null);
    if (saved.status === "rejected") {
      showToast({ tone: "error", message: saved.error ?? "That set could not be saved" });
      return;
    }
    showSaved(saved, exerciseName);
  }

  async function deleteSet(setId: string) {
    if (removingId) {
      return;
    }
    const removedSet = sessionSets.find((set) => set._id === setId);
    setRemovingId(setId);
    const removed = await log.removeMany([setId]);
    setRemovingId(null);
    if (removed.status === "rejected" && removed.error) {
      showToast({ tone: "error", message: removed.error });
      return;
    }
    if (!removedSet) {
      if (removed.status === "queued") {
        showToast({ tone: "info", message: QUEUED_SAVE_MESSAGE });
      }
      return;
    }
    const target = openTarget();
    showToast({
      tone: "info",
      message:
        removed.status === "queued"
          ? `Removed ${removedSet.exerciseName}. ${QUEUED_SAVE_MESSAGE}`
          : `Removed ${removedSet.exerciseName}`,
      action: {
        label: "Undo",
        onClick: () => void restoreRemovedSet(removedSet, target),
      },
    });
  }

  async function restoreRemovedSet(set: SetLine, target: OpenTarget) {
    setToast(null);
    const saved = await log.saveSets({
      placement: "open",
      sessionId: target.sessionId,
      sessionStartedAt: target.sessionStartedAt,
      note: null,
      sets: [
        {
          exerciseName: set.exerciseName,
          weightLb: set.weightLb,
          reps: set.reps,
          durationSec: set.durationSec,
          distanceM: set.distanceM,
          calories: set.calories ?? null,
          rpe: set.rpe,
          ...(set.setType !== undefined ? { setType: set.setType } : {}),
          loggedAt: set.loggedAt,
        },
      ],
    });
    if (saved.status === "rejected") {
      showToast({ tone: "error", message: saved.error ?? "That set could not be put back" });
    }
  }

  return {
    toast,
    showToast,
    clearToast,
    showSaved,
    manual,
    manualPending,
    openManual,
    openEdit,
    closeManual: () => setManual(null),
    addManual,
    repeatingId,
    repeatSet,
    loggingPlanId,
    logPlanSet,
    deleteSet,
  };
}
