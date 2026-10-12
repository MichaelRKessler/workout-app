"use client";

import type { ToastMessage } from "@/components/Toast";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { normalizeSupersetItems } from "@/convex/lib/superset";
import { readableError } from "@/lib/errors";
import {
  PENDING_PLAN_EVENT,
  loadPendingPlan,
  loadRoutineCache,
  publishPendingPlan,
  saveRoutineCache,
  type CachedRoutine,
  type PendingPlan,
  type PendingPlanExercise,
} from "@/lib/offline/routineCache";
import { cacheStore, loadCachedAccess } from "@/lib/offline/storage";
import type { VisiblePlanItem } from "@/lib/workoutPlan";
import { useMutation } from "convex/react";
import { useEffect, useMemo, useRef, useState } from "react";

type OpenSession = {
  _id: string;
  startedAt: number;
  plan: VisiblePlanItem[];
  planName?: string | null;
  routineId?: string | null;
} | null;

type SnapshotPlan = {
  startedAt: number;
  name: string | null;
  routineId: string | null;
  exercises: PendingPlanExercise[];
} | null;

export function blankPlanItem(exerciseId: string, name: string): VisiblePlanItem {
  return {
    exerciseId,
    name,
    targetSets: null,
    targetReps: null,
    targetWeightLb: null,
    targetDurationSec: null,
    targetDistanceM: null,
    targetCalories: null,
    skipped: false,
    supersetId: null,
  };
}

export function toPendingExercise(item: VisiblePlanItem): PendingPlanExercise {
  return {
    exerciseId: item.exerciseId,
    name: item.name,
    targetSets: item.targetSets,
    targetReps: item.targetReps,
    targetWeightLb: item.targetWeightLb,
    targetDurationSec: item.targetDurationSec,
    targetDistanceM: item.targetDistanceM,
    targetCalories: item.targetCalories ?? null,
    restSeconds: null,
    supersetId: item.supersetId,
    skipped: item.skipped,
  };
}

function storedPlanItem(item: PendingPlanExercise) {
  return {
    exerciseId: item.exerciseId as Id<"exercises">,
    ...(item.targetSets != null ? { targetSets: item.targetSets } : {}),
    ...(item.targetReps != null ? { targetReps: item.targetReps } : {}),
    ...(item.targetWeightLb != null ? { targetWeightLb: item.targetWeightLb } : {}),
    ...(item.targetDurationSec != null ? { targetDurationSec: item.targetDurationSec } : {}),
    ...(item.targetDistanceM != null ? { targetDistanceM: item.targetDistanceM } : {}),
    ...(item.targetCalories != null ? { targetCalories: item.targetCalories } : {}),
    ...(item.supersetId ? { supersetId: item.supersetId } : {}),
    ...(item.skipped ? { skipped: true as const } : {}),
  };
}

/**
 * The open workout's plan: a routine's exercises, or a plan kept on the phone
 * until a workout exists to attach it to. Edits go to the server once the
 * workout is open, and to the phone before that.
 */
export function usePlanEditor({
  openSession,
  knownSession,
  snapshotPlan,
  routineList,
  offline,
  showToast,
}: {
  /** The server's open workout: undefined while loading, null when there is none. */
  openSession: OpenSession | undefined;
  /** The open workout from the server or, offline, from the phone. */
  knownSession: { _id: string } | null;
  snapshotPlan: SnapshotPlan | undefined;
  routineList: CachedRoutine[] | undefined;
  offline: boolean;
  showToast: (message: ToastMessage) => void;
}) {
  const setSessionPlan = useMutation(api.sessions.setPlan);
  const [viewerEmail, setViewerEmail] = useState<string | null>(null);
  const [localPlan, setLocalPlan] = useState<PendingPlan | null>(null);
  const [cachedRoutines, setCachedRoutines] = useState<CachedRoutine[] | null>(null);
  const [editingPlan, setEditingPlan] = useState(false);
  const attachedPlan = useRef<string | null>(null);

  useEffect(() => {
    setViewerEmail(loadCachedAccess(cacheStore())?.email ?? null);
  }, []);

  useEffect(() => {
    function loadPlan() {
      const email = loadCachedAccess(cacheStore())?.email ?? viewerEmail;
      setLocalPlan(loadPendingPlan(cacheStore(), email));
      setCachedRoutines(loadRoutineCache(cacheStore(), email));
    }
    loadPlan();
    window.addEventListener(PENDING_PLAN_EVENT, loadPlan);
    return () => window.removeEventListener(PENDING_PLAN_EVENT, loadPlan);
  }, [viewerEmail]);

  useEffect(() => {
    if (!routineList) {
      return;
    }
    saveRoutineCache(cacheStore(), viewerEmail, routineList);
    setCachedRoutines(routineList);
  }, [routineList, viewerEmail]);

  // A plan started on the phone attaches to the workout once one exists.
  useEffect(() => {
    if (!openSession || offline || !localPlan) {
      return;
    }
    if (openSession.plan.length > 0) {
      publishPendingPlan(cacheStore(), viewerEmail, null);
      setLocalPlan(null);
      return;
    }
    if (attachedPlan.current === openSession._id) {
      return;
    }
    attachedPlan.current = openSession._id;
    void setSessionPlan({
      sessionId: openSession._id as Id<"sessions">,
      ...(localPlan.name ? { planName: localPlan.name } : {}),
      ...(localPlan.routineId ? { routineId: localPlan.routineId as Id<"routines"> } : {}),
      plan: localPlan.exercises.map(storedPlanItem),
    }).catch(() => {
      attachedPlan.current = null;
    });
  }, [localPlan, offline, openSession, setSessionPlan, viewerEmail]);

  const activePlan = useMemo((): VisiblePlanItem[] => {
    if (openSession && openSession.plan.length > 0) {
      return openSession.plan;
    }
    if (localPlan) {
      return localPlan.exercises;
    }
    if (openSession === undefined && snapshotPlan) {
      return snapshotPlan.exercises;
    }
    return [];
  }, [localPlan, openSession, snapshotPlan]);

  const planName =
    (openSession && openSession.plan.length > 0 ? openSession.planName : null) ??
    localPlan?.name ??
    (openSession === undefined ? snapshotPlan?.name : null) ??
    null;

  async function savePlan(
    next: Array<Omit<VisiblePlanItem, "supersetId"> & { supersetId?: string | null }>,
  ) {
    const exercises = normalizeSupersetItems(next).map((item) =>
      toPendingExercise({ ...item, supersetId: item.supersetId ?? null }),
    );
    if (!knownSession) {
      const plan: PendingPlan = {
        startedAt: localPlan?.startedAt ?? snapshotPlan?.startedAt ?? Date.now(),
        name: planName,
        routineId: localPlan?.routineId ?? snapshotPlan?.routineId ?? null,
        exercises,
      };
      publishPendingPlan(cacheStore(), viewerEmail, plan);
      setLocalPlan(plan);
      return;
    }
    if (offline) {
      showToast({ tone: "info", message: "Reconnect to change this plan." });
      return;
    }
    try {
      await setSessionPlan({
        sessionId: knownSession._id as Id<"sessions">,
        plan: exercises.map(storedPlanItem),
      });
    } catch (error) {
      showToast({ tone: "error", message: readableError(error) });
    }
  }

  function clearPlan() {
    publishPendingPlan(cacheStore(), viewerEmail, null);
    setLocalPlan(null);
  }

  return {
    localPlan,
    cachedRoutines,
    activePlan,
    planName,
    editingPlan,
    setEditingPlan,
    savePlan,
    clearPlan,
  };
}
