"use client";

import { FinishedWorkout } from "@/components/WorkoutSummaryCard";
import { useOfflineLog, type SyncOutcome } from "@/components/OfflineSync";
import { Toast, type ToastMessage } from "@/components/Toast";
import { OpenWorkoutSheet } from "@/components/routines/OpenWorkoutSheet";
import { useBeginWorkout } from "@/components/routines/useBeginWorkout";
import { ActiveWorkout } from "@/components/workout/ActiveWorkout";
import { Composer } from "@/components/workout/Composer";
import { ConfirmSheet } from "@/components/workout/ConfirmSheet";
import { FinishSheet } from "@/components/workout/FinishSheet";
import { ExerciseRow } from "@/components/workout/ExerciseRow";
import { HomeView } from "@/components/workout/HomeView";
import { WeekSummaryLoader } from "@/components/workout/WeekSummaryLoader";
import { useWorkoutFreshness } from "@/components/workout/useWorkoutFreshness";
import { WorkoutPlanList } from "@/components/workout/WorkoutPlanList";
import { ListeningOverlay } from "@/components/workout/ListeningOverlay";
import { ManualEntrySheet } from "@/components/workout/ManualEntrySheet";
import { StaleWorkoutSheet } from "@/components/workout/StaleWorkoutSheet";
import { blobToBase64, requestProposal } from "@/components/workout/requestProposal";
import { useRecorder } from "@/components/workout/useRecorder";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { formatExerciseName } from "@/convex/lib/exerciseName";
import { plannedCompletedAt } from "@/convex/lib/sessionTiming";
import { readableError } from "@/lib/errors";
import { EXAMPLE_EXERCISES } from "@/lib/examples";
import { useWeightUnit } from "@/components/WeightUnit";
import { formatDuration, formatPersonalRecord, formatPersonalRecords, pluralize } from "@/lib/format";
import { summarizeSessions, type WorkoutSummary } from "@/lib/workoutSummary";
import type { PersonalRecord } from "@/convex/lib/records";
import { groupSets, type SetLine } from "@/lib/groupSets";
import {
  OFFLINE_TYPED_MESSAGE,
  OFFLINE_VOICE_MESSAGE,
  QUEUED_SAVE_MESSAGE,
} from "@/lib/offline/messages";
import {
  hasPendingFinish,
  mergeVisibleSets,
  pendingNote,
  pendingResumedAt,
} from "@/lib/offline/outbox";
import {
  draftToProposal,
  proposalToDraft,
  proposalToSave,
  reduceVoiceLog,
  type VoiceDraft,
} from "@/lib/voice/confirm";
import { moveItem } from "@/convex/lib/routinePlan";
import { useBrowserTimeZone } from "@/components/useBrowserTimeZone";
import { useSessionText } from "@/components/useSessionText";
import {
  PENDING_PLAN_EVENT,
  loadPendingPlan,
  loadRoutineCache,
  publishPendingPlan,
  saveRoutineCache,
  type PendingPlan,
  type PendingPlanExercise,
} from "@/lib/offline/routineCache";
import { cacheStore, composerTextKey, loadCachedAccess } from "@/lib/offline/storage";
import { exerciseLink } from "@/lib/exerciseLink";
import { setFromPrefill } from "@/lib/prefill";
import { calendarDayBounds, calendarDayKey, groupHistoryDays } from "@/lib/historyDays";
import { splitWorkoutPlan, type VisiblePlanItem } from "@/lib/workoutPlan";
import { takeToast } from "@/lib/pendingToast";
import {
  DEFAULT_REST_SECONDS,
  readRestSeconds,
  REST_STORAGE_KEY,
} from "@/lib/restTimer";
import {
  linkWithNext,
  normalizeSupersetItems,
  restAfterSet,
  restOwnerId,
  unlinkSuperset,
} from "@/convex/lib/superset";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { readLocal } from "@/lib/localValue";

type Toasted = ToastMessage & { id: number };

/**
 * The Log tab. With no open workout it shows the start screen; the first set
 * confirmed by voice, by typing, or by hand opens one.
 */
function blankPlanItem(exerciseId: string, name: string): VisiblePlanItem {
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

function toPendingExercise(item: VisiblePlanItem): PendingPlanExercise {
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

function combinedNote(existing: string | null | undefined, extra: string | null): string | null {
  if (!extra) {
    return existing ?? null;
  }
  if (!existing) {
    return extra;
  }
  if (existing.includes(extra)) {
    return existing;
  }
  return `${existing}\n${extra}`;
}

export function LogWorkout() {
  const openSession = useQuery(api.sessions.getOpen);
  const routineList = useQuery(api.routines.list);
  const setSessionPlan = useMutation(api.sessions.setPlan);
  const beginWorkout = useBeginWorkout();
  const exercises = useQuery(api.exercises.list);
  const sets = useQuery(
    api.sets.listForSession,
    openSession ? { sessionId: openSession._id } : "skip",
  );
  const history = useQuery(
    api.sessions.listHistory,
    openSession === null ? { paginationOpts: { numItems: 1, cursor: null } } : "skip",
  );
  const timeZone = useBrowserTimeZone();
  const latestStartedAt = history?.page[0]?.startedAt;
  const latestDay = useMemo(() => {
    if (!timeZone || latestStartedAt === undefined) {
      return null;
    }
    return calendarDayBounds(calendarDayKey(latestStartedAt, timeZone), timeZone);
  }, [latestStartedAt, timeZone]);
  const latestDaySessions = useQuery(
    api.sessions.listDay,
    openSession === null && latestDay
      ? { startedFrom: latestDay.start, startedUntil: latestDay.end }
      : "skip",
  );
  const log = useOfflineLog();
  const { offline, outbox, snapshot } = log;
  const lastWorkout = useMemo(() => {
    if (history === undefined || !timeZone) {
      return undefined;
    }
    const latest = history.page[0];
    if (!latest) {
      return null;
    }
    if (!offline && latestDay && latestDaySessions === undefined) {
      return undefined;
    }
    const rows =
      latestDaySessions && latestDaySessions.sessions.length > 0
        ? latestDaySessions.sessions.map((session) => ({
            id: session._id,
            startedAt: session.startedAt,
            completedAt: session.completedAt ?? session.startedAt,
            status: "completed" as const,
            volumeLb: session.volumeLb,
            exercises: session.exercises.map((exercise) => ({
              exerciseId: exercise.exerciseId,
              name: exercise.name,
              setCount: exercise.setCount,
              supersetId: exercise.supersetId,
            })),
          }))
        : [
            {
              id: latest._id,
              startedAt: latest.startedAt,
              completedAt: latest.completedAt,
              status: "completed" as const,
              volumeLb: latest.volumeLb ?? 0,
              exercises: latest.exercises.map((exercise) => ({
                exerciseId: exercise.exerciseId,
                name: exercise.name,
                setCount: exercise.setCount,
                supersetId: exercise.supersetId,
              })),
            },
          ];
    return groupHistoryDays(rows, timeZone)[0] ?? null;
  }, [history, latestDay, latestDaySessions, offline, timeZone]);

  const unit = useWeightUnit();
  const [voice, dispatch] = useReducer(reduceVoiceLog, { status: "idle" });
  const [source, setSource] = useState<"voice" | "text">("voice");
  const [draft, setDraft] = useState<VoiceDraft | null>(null);
  const [sheetNotice, setSheetNotice] = useState<string | null>(null);
  // Kept while an exercise's progress page is open.
  const [text, setText] = useSessionText(composerTextKey(log.accountEmail));
  const [homeTyping, setHomeTyping] = useState(false);
  const [editingPlan, setEditingPlan] = useState(false);
  const [manual, setManual] = useState<
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
      }
    | null
  >(null);
  const [finishNote, setFinishNote] = useState("");
  const [manualPending, setManualPending] = useState(false);
  const [finishOpen, setFinishOpen] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);
  const [ending, setEnding] = useState(false);
  const [finished, setFinished] = useState<{
    summary: WorkoutSummary;
    records: PersonalRecord[];
    recordsPending: boolean;
    note: string | null;
    dayKey: string;
  } | null>(null);
  const [keeping, setKeeping] = useState(false);
  const [toast, setToast] = useState<Toasted | null>(null);
  const [repeatingId, setRepeatingId] = useState<string | null>(null);
  const [loggingPlanId, setLoggingPlanId] = useState<string | null>(null);
  const [localPlan, setLocalPlan] = useState<PendingPlan | null>(null);
  const [cachedRoutines, setCachedRoutines] = useState<
    Array<{ _id: string; name: string }> | null
  >(null);
  const attachedPlan = useRef<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const parseAbortRef = useRef<AbortController | null>(null);

  const recorder = useRecorder({
    onAudio: (blob) => void parseAudio(blob),
    onError: (message) => dispatch({ type: "failed", message }),
  });

  const [viewerEmail, setViewerEmail] = useState<string | null>(null);

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

  useEffect(() => {
    return () => {
      parseAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (sets) {
      log.reconcile(sets);
    }
  }, [log, sets]);

  useEffect(() => {
    if (openSession === undefined) {
      return;
    }
    if (openSession && sets === undefined) {
      return;
    }
    const plan =
      openSession && openSession.plan.length > 0
        ? {
            startedAt: openSession.startedAt,
            name: openSession.planName,
            routineId: openSession.routineId,
            exercises: openSession.plan.map(toPendingExercise),
          }
        : localPlan;
    log.rememberWorkout({
      session: openSession,
      sets: sets ?? [],
      plan,
    });
  }, [localPlan, log, openSession, sets]);

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
    const exercises = localPlan.exercises.map((item) => ({
      exerciseId: item.exerciseId as Id<"exercises">,
      ...(item.targetSets != null ? { targetSets: item.targetSets } : {}),
      ...(item.targetReps != null ? { targetReps: item.targetReps } : {}),
      ...(item.targetWeightLb != null ? { targetWeightLb: item.targetWeightLb } : {}),
      ...(item.targetDurationSec != null ? { targetDurationSec: item.targetDurationSec } : {}),
      ...(item.targetDistanceM != null ? { targetDistanceM: item.targetDistanceM } : {}),
      ...(item.targetCalories != null ? { targetCalories: item.targetCalories } : {}),
      ...(item.supersetId ? { supersetId: item.supersetId } : {}),
      ...(item.skipped ? { skipped: true as const } : {}),
    }));
    void setSessionPlan({
      sessionId: openSession._id,
      ...(localPlan.name ? { planName: localPlan.name } : {}),
      ...(localPlan.routineId ? { routineId: localPlan.routineId as Id<"routines"> } : {}),
      plan: exercises,
    }).catch(() => {
      attachedPlan.current = null;
    });
  }, [localPlan, offline, openSession, setSessionPlan, viewerEmail]);

  const [deviceRest, setDeviceRest] = useState(DEFAULT_REST_SECONDS);
  useEffect(() => {
    const read = () =>
      setDeviceRest(readRestSeconds(readLocal(REST_STORAGE_KEY)));
    read();
    window.addEventListener("workout-rest-default", read);
    return () => window.removeEventListener("workout-rest-default", read);
  }, []);

  useEffect(() => {
    const pending = takeToast();
    if (pending) {
      setToast({ id: Date.now(), tone: "info", message: pending });
    }
  }, []);

  const beginError = beginWorkout.error;
  const clearBeginError = beginWorkout.clearError;
  useEffect(() => {
    if (!beginError) {
      return;
    }
    setToast({ id: Date.now(), tone: "error", message: beginError });
    clearBeginError();
  }, [beginError, clearBeginError]);

  const knownSession = openSession !== undefined ? openSession : (snapshot?.session ?? null);
  const sessionSets = useMemo(() => {
    const serverSets =
      sets ?? (openSession === null ? [] : openSession === undefined ? (snapshot?.sets ?? []) : []);
    return mergeVisibleSets(serverSets, outbox, {
      kind: "open",
      sessionId: knownSession?._id ?? null,
    });
  }, [knownSession?._id, openSession, outbox, sets, snapshot?.sets]);
  const groups = useMemo(() => groupSets(sessionSets), [sessionSets]);
  const activePlan = useMemo((): VisiblePlanItem[] => {
    if (openSession && openSession.plan.length > 0) {
      return openSession.plan;
    }
    if (localPlan) {
      return localPlan.exercises;
    }
    if (openSession === undefined && snapshot?.plan) {
      return snapshot.plan.exercises;
    }
    return [];
  }, [localPlan, openSession, snapshot?.plan]);
  const planView = useMemo(
    () => (activePlan.length > 0 ? splitWorkoutPlan(activePlan, groups) : null),
    [activePlan, groups],
  );
  const planName =
    (openSession && openSession.plan.length > 0 ? openSession.planName : null) ??
    localPlan?.name ??
    (openSession === undefined ? snapshot?.plan?.name : null) ??
    null;
  const restCue = useMemo(() => {
    if (sessionSets.length === 0 || activePlan.length === 0) {
      return { hold: false, ownerName: null as string | null, onPlan: false };
    }
    let newestId: string | null = null;
    let newestAt = -1;
    for (const set of sessionSets) {
      if (set.loggedAt >= newestAt) {
        newestAt = set.loggedAt;
        newestId = set.exerciseId;
      }
    }
    if (!newestId || !activePlan.some((item) => item.exerciseId === newestId)) {
      return { hold: false, ownerName: null, onPlan: false };
    }
    const counts = new Map(groups.map((group) => [group.exerciseId, group.sets.length]));
    const decision = restAfterSet(activePlan, counts, newestId);
    const rests = new Map(
      activePlan.map((item) => [
        item.exerciseId,
        exercises?.exercises.find((exercise) => exercise._id === item.exerciseId)?.restSeconds ?? null,
      ]),
    );
    const ownerId = restOwnerId(decision.exerciseIds, rests, newestId, deviceRest);
    const owner = activePlan.find((item) => item.exerciseId === ownerId);
    return { hold: !decision.start, ownerName: owner?.name ?? null, onPlan: true };
  }, [activePlan, deviceRest, exercises?.exercises, groups, sessionSets]);
  const newestSetId = useMemo(() => {
    let newest: (typeof sessionSets)[number] | undefined;
    for (const set of sessionSets) {
      if (!newest || set.loggedAt >= newest.loggedAt) {
        newest = set;
      }
    }
    return newest?._id;
  }, [sessionSets]);

  const library = useMemo(() => {
    const names: string[] = [];
    const seen = new Set<string>();
    const add = (name: string) => {
      const key = formatExerciseName(name)?.normalizedName;
      if (key && !seen.has(key)) {
        seen.add(key);
        names.push(name);
      }
    };
    [...groups].reverse().forEach((group) => add(group.name));
    exercises?.exercises.forEach((exercise) => add(exercise.name));
    EXAMPLE_EXERCISES.forEach(add);
    return names;
  }, [groups, exercises]);

  const workoutOpen = knownSession !== null || sessionSets.length > 0 || activePlan.length > 0;
  const viewSessionId = knownSession?._id ?? null;
  const discarding = outbox.actions.some((action) => {
    if (action.kind !== "discard" || action.echoed || action.syncError) {
      return false;
    }
    if (viewSessionId) {
      return action.sessionId === viewSessionId || action.sessionClientId === outbox.openSessionClientId;
    }
    return action.sessionClientId === outbox.openSessionClientId;
  });
  const showWorkout = !discarding && workoutOpen;
  const fallbackStartedAt = useRef(0);
  if (fallbackStartedAt.current === 0) {
    fallbackStartedAt.current = Date.now();
  }
  const startedAt =
    knownSession?.startedAt ??
    localPlan?.startedAt ??
    snapshot?.plan?.startedAt ??
    outbox.sets.find((set) => set.placement === "open" && !set.removed)?.sessionStartedAt ??
    fallbackStartedAt.current;
  const loggedLast = sessionSets.reduce((max, set) => Math.max(max, set.loggedAt), 0);
  const lastSetAt = Math.max(knownSession?.lastSetAt ?? 0, loggedLast) || null;
  const resumedAt =
    Math.max(knownSession?.resumedAt ?? 0, pendingResumedAt(outbox, viewSessionId) ?? 0) || null;
  const voiceOrManualOpen =
    voice.status === "recording" ||
    voice.status === "parsing" ||
    voice.status === "preview" ||
    voice.status === "saving" ||
    manual !== null;
  const freshness = useWorkoutFreshness({
    active: showWorkout,
    startedAt,
    lastSetAt,
    resumedAt,
    voiceOrManualOpen,
    finishOpen,
    pendingFinish: hasPendingFinish(outbox, viewSessionId),
  });
  const showStale = freshness.showStale;
  const idleTrimmed = freshness.idleTrimmed;
  const clockNow = freshness.now > 0 ? freshness.now : Date.now();
  const savedEnd =
    lastSetAt !== null
      ? plannedCompletedAt({ now: clockNow, startedAt, lastSetAt })
      : clockNow;
  useEffect(() => {
    if (workoutOpen) {
      setHomeTyping(false);
    } else {
      setEditingPlan(false);
    }
  }, [workoutOpen]);

  function showToast(message: ToastMessage) {
    setToast({ ...message, id: Date.now() });
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

  function openTarget() {
    const session = knownSession;
    return {
      sessionId: session?._id ?? null,
      sessionStartedAt: session?.startedAt ?? Date.now(),
    };
  }

  // Voice and typed parsing.

  const voiceBusy =
    voice.status === "recording" || voice.status === "parsing" || voice.status === "saving";

  async function startVoice() {
    if (offline) {
      dispatch({ type: "failed", message: OFFLINE_VOICE_MESSAGE });
      return;
    }
    if (voiceBusy) {
      return;
    }
    setToast(null);
    parseAbortRef.current?.abort();
    const started = await recorder.start();
    if (started) {
      setSource("voice");
      setDraft(null);
      setSheetNotice(null);
      dispatch({ type: "start-recording" });
    }
  }

  function stopVoice() {
    dispatch({ type: "submit-audio" });
    recorder.stop();
  }

  function cancelVoice() {
    recorder.cancel();
    parseAbortRef.current?.abort();
    dispatch({ type: "cancel" });
  }

  async function parseAudio(blob: Blob) {
    try {
      const audioBase64 = await blobToBase64(blob);
      await parse({ audioBase64, mimeType: blob.type });
    } catch (error) {
      dispatch({ type: "failed", message: readableError(error) });
    }
  }

  async function submitText() {
    const value = text.trim();
    if (offline) {
      dispatch({ type: "failed", message: OFFLINE_TYPED_MESSAGE });
      return;
    }
    if (value.length === 0 || voiceBusy) {
      return;
    }
    setToast(null);
    setSource("text");
    dispatch({ type: "submit-text" });
    if (await parse({ text: value })) {
      setText("");
    }
  }

  async function parse(body: Parameters<typeof requestProposal>[0]): Promise<boolean> {
    parseAbortRef.current?.abort();
    const controller = new AbortController();
    parseAbortRef.current = controller;
    try {
      const proposal = await requestProposal(body, controller.signal);
      if (controller.signal.aborted) {
        return false;
      }
      setDraft(proposalToDraft(proposal, unit));
      setSheetNotice(null);
      dispatch({ type: "parsed", proposal });
      return true;
    } catch (error) {
      if (!controller.signal.aborted) {
        dispatch({ type: "failed", message: readableError(error) });
      }
      return false;
    }
  }

  async function confirmDraft() {
    if (voice.status !== "preview" || !draft) {
      return;
    }
    const edited = draftToProposal(draft, unit);
    if (!edited) {
      setSheetNotice("Check each exercise and its sets. Nothing was saved.");
      return;
    }
    const toSave = proposalToSave(voice, { type: "confirm", proposal: edited });
    if (!toSave) {
      return;
    }
    dispatch({ type: "confirm", proposal: toSave });
    setSheetNotice(null);
    const target = openTarget();
    const saved = await log.saveSets({
      placement: "open",
      sessionId: target.sessionId,
      sessionStartedAt: target.sessionStartedAt,
      note: toSave.note,
      sets: toSave.exercises.flatMap((exercise) =>
          exercise.sets.map((set) => ({
          exerciseName: exercise.exerciseName,
          weightLb: set.weightLb,
          reps: set.reps,
          durationSec: set.durationSec,
          distanceM: set.distanceM,
          calories: set.calories,
          rpe: set.rpe,
          setType: set.setType,
          ...(exercise.supersetId ? { supersetId: exercise.supersetId } : {}),
        })),
      ),
    });
    if (saved.status === "rejected") {
      setDraft(proposalToDraft(toSave, unit));
      dispatch({ type: "save-failed", proposal: toSave });
      setSheetNotice(saved.error ?? "That set could not be saved");
      return;
    }
    dispatch({ type: "saved" });
    setDraft(null);
    showSaved(
      saved,
      toSave.exercises.map((exercise) => exercise.exerciseName).join(", "),
    );
  }

  function discardDraft() {
    setDraft(null);
    setSheetNotice(null);
    dispatch({ type: "discard" });
  }

  // Manual sets, repeats, removals, and finishing.

  function openManual(exerciseName?: string) {
    if (voice.status === "error") {
      dispatch({ type: "dismiss" });
    }
    setToast(null);
    setManual({
      key: Date.now(),
      mode: "add",
      exerciseName: exerciseName ?? groups[groups.length - 1]?.name ?? "",
    });
  }

  function openEdit(set: SetLine) {
    if (voice.status === "error") {
      dispatch({ type: "dismiss" });
    }
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

  async function addManual(set: {
    exerciseName: string;
    reps?: number;
    weightLb: number;
    durationSec?: number;
    distanceM?: number;
    calories?: number;
    rpe?: number;
    setType: SetLine["setType"];
  }) {
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

  async function deleteSet(setId: string) {
    if (removingId) {
      return;
    }
    const snapshot = sessionSets.find((set) => set._id === setId);
    setRemovingId(setId);
    const removed = await log.removeMany([setId]);
    setRemovingId(null);
    if (removed.status === "rejected" && removed.error) {
      showToast({ tone: "error", message: removed.error });
      return;
    }
    if (!snapshot) {
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
          ? `Removed ${snapshot.exerciseName}. ${QUEUED_SAVE_MESSAGE}`
          : `Removed ${snapshot.exerciseName}`,
      action: {
        label: "Undo",
        onClick: () => void restoreRemovedSet(snapshot, target.sessionId, target.sessionStartedAt, "open"),
      },
    });
  }

  async function restoreRemovedSet(
    set: SetLine,
    sessionId: string | null,
    sessionStartedAt: number,
    placement: "open" | "completed",
  ) {
    setToast(null);
    const saved = await log.saveSets({
      placement,
      sessionId,
      sessionStartedAt,
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

  async function keepWorkoutGoing() {
    if (!knownSession && sessionSets.length === 0) {
      return;
    }
    setKeeping(true);
    setFinishError(null);
    const saved = await log.keepGoing({
      sessionId: knownSession?._id ?? null,
      requestedAt: Date.now(),
    });
    setKeeping(false);
    if (saved.status === "rejected") {
      setFinishError(saved.error);
      return;
    }
    setFinishOpen(false);
  }

  async function finishWorkout() {
    if (!knownSession && sessionSets.length === 0) {
      return;
    }
    const snapshotSets = sessionSets;
    const snapshotStart = startedAt;
    const snapshotEnd = savedEnd;
    const trimmed = idleTrimmed;
    setEnding(true);
    setFinishError(null);
    const saved = await log.finishWorkout({
      sessionId: knownSession?._id ?? null,
      requestedAt: Date.now(),
      ...(finishOpen ? { note: finishNote } : {}),
    });
    setEnding(false);
    if (saved.status === "rejected") {
      setFinishError(saved.error);
      return;
    }
    setFinishOpen(false);
    publishPendingPlan(cacheStore(), viewerEmail, null);
    setLocalPlan(null);
    setFinished({
      summary: summarizeSessions([
        {
          startedAt: snapshotStart,
          completedAt: saved.completedAt ?? snapshotEnd,
          sets: snapshotSets,
        },
      ]),
      records: saved.personalRecords,
      recordsPending: saved.status !== "synced",
      note: trimmed ? "Idle time after your last set isn't counted." : null,
      dayKey: calendarDayKey(snapshotStart, timeZone ?? undefined),
    });
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

  async function savePlan(
    next: Array<Omit<VisiblePlanItem, "supersetId"> & { supersetId?: string | null }>,
  ) {
    const exercises = normalizeSupersetItems(next).map((item) =>
      toPendingExercise({ ...item, supersetId: item.supersetId ?? null }),
    );
    if (!knownSession) {
      const plan: PendingPlan = {
        startedAt: localPlan?.startedAt ?? snapshot?.plan?.startedAt ?? Date.now(),
        name: planName,
        routineId: localPlan?.routineId ?? snapshot?.plan?.routineId ?? null,
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

  async function discardWorkout() {
    if (!knownSession && sessionSets.length === 0) {
      publishPendingPlan(cacheStore(), viewerEmail, null);
      setLocalPlan(null);
      return;
    }
    setEnding(true);
    const saved = await log.discardWorkout({
      sessionId: knownSession?._id ?? null,
      requestedAt: Date.now(),
    });
    setEnding(false);
    if (saved.status === "rejected" && saved.error) {
      showToast({ tone: "error", message: saved.error });
      return;
    }
    publishPendingPlan(cacheStore(), viewerEmail, null);
    setLocalPlan(null);
  }

  if (!offline && (openSession === undefined || exercises === undefined)) {
    return (
      <div className="flex min-h-[70dvh] items-center justify-center">
        <p className="text-base text-muted">Loading your workout…</p>
      </div>
    );
  }

  const workoutNote = combinedNote(
    knownSession?.note,
    pendingNote(outbox, { kind: "open", sessionId: viewSessionId }),
  );

  const activeToast: Toasted | null =
    voice.status === "error"
      ? {
          id: -1,
          tone: "error",
          message: voice.message,
          action: { label: "Add by hand", onClick: openManual },
        }
      : toast;

  if (finished) {
    return (
      <FinishedWorkout
        summary={finished.summary}
        records={finished.records}
        unit={unit}
        recordsPending={finished.recordsPending}
        note={finished.note}
        dayKey={finished.dayKey}
        onDone={() => setFinished(null)}
      />
    );
  }

  return (
    <>
      {showWorkout ? (
        <ActiveWorkout
          startedAt={startedAt}
          groups={groups}
          setCount={sessionSets.length}
          newestSetId={newestSetId}
          loadingSets={sets === undefined && !offline && knownSession !== null}
          repeatingId={repeatingId}
          ending={ending}
          editingPlan={editingPlan}
          onEditingPlan={setEditingPlan}
          note={workoutNote}
          emptyMessage={
            offline ? "No sets yet. Add one by hand. Voice needs a connection." : undefined
          }
          idleNote={freshness.idleNote ?? undefined}
          onRepeat={(group) => void repeatSet(group)}
          onEditSet={openEdit}
          onFinish={() => {
            setFinishError(null);
            if (!showStale) {
              setFinishNote(workoutNote ?? "");
              setFinishOpen(true);
            }
          }}
          onDiscard={() => void discardWorkout()}
          restHold={restCue.hold}
          restExerciseName={restCue.onPlan ? restCue.ownerName : undefined}
          onLinkFree={
            planView
              ? undefined
              : (index) => {
                  const items = groups.map((group) => blankPlanItem(group.exerciseId, group.name));
                  void savePlan(linkWithNext(items, index));
                }
          }
          exerciseCount={
            planView ? planView.rows.length + planView.extras.length : undefined
          }
          planList={
            planView ? (
              <>
                <WorkoutPlanList
                  name={planName}
                  rows={planView.rows}
                  loggingId={loggingPlanId}
                  setsLoading={sets === undefined && !offline && knownSession !== null}
                  offline={offline}
                  sessionSets={sessionSets}
                  excludeSessionId={knownSession ? (knownSession._id as Id<"sessions">) : undefined}
                  onLog={(exerciseId, exerciseName, set) =>
                    void logPlanSet(exerciseId, exerciseName, set)
                  }
                  onRepeat={(row) =>
                    void repeatSet({ exerciseId: row.exerciseId, name: row.name, sets: row.sets })
                  }
                  repeatingId={repeatingId}
                  onSkip={(exerciseId, skipped) =>
                    void savePlan(
                      activePlan.map((item) =>
                        item.exerciseId === exerciseId ? { ...item, skipped } : item,
                      ),
                    )
                  }
                  onMove={(index, direction) =>
                    void savePlan(normalizeSupersetItems(moveItem(activePlan, index, direction)))
                  }
                  onLink={(index) => void savePlan(linkWithNext(activePlan, index))}
                  onUnlink={(index) => void savePlan(unlinkSuperset(activePlan, index))}
                  onEditSet={openEdit}
                  onNeedForm={(exerciseName) => openManual(exerciseName)}
                  editing={editingPlan}
                />
                {planView.extras.length > 0 ? (
                  <div className="mt-2">
                    <h2 className="pt-2 text-xs font-medium tracking-[0.06em] text-subtle uppercase">
                      Added
                    </h2>
                    <ul aria-label="Exercises added to this workout">
                      {planView.extras.map((group) => (
                        <ExerciseRow
                          key={group.exerciseId}
                          name={group.name}
                          sets={group.sets}
                          newestSetId={newestSetId}
                          exerciseHref={exerciseLink(group.exerciseId, "/") ?? undefined}
                          onRepeat={() => void repeatSet(group)}
                          repeating={repeatingId === group.exerciseId}
                          onEditSet={openEdit}
                          footer={
                            editingPlan ? (
                              <button
                                type="button"
                                onClick={() => {
                                  const appended = [
                                    ...activePlan,
                                    blankPlanItem(group.exerciseId, group.name),
                                  ];
                                  void savePlan(linkWithNext(appended, appended.length - 2));
                                }}
                                className="mb-2 ml-14 min-h-11 text-base font-medium text-muted"
                              >
                                Superset with plan
                              </button>
                            ) : null
                          }
                        />
                      ))}
                    </ul>
                  </div>
                ) : null}
              </>
            ) : undefined
          }
          composer={{
            text,
            onTextChange: setText,
            onSubmitText: () => void submitText(),
            parsingText: voice.status === "parsing" && source === "text",
            onVoice: () => void startVoice(),
            onManual: openManual,
            busy: voiceBusy,
            offline,
          }}
        />
      ) : (
        <WeekSummaryLoader>
          {(weekSummary) => (
          <>
          <HomeView
            lastWorkout={lastWorkout}
            weekSummary={weekSummary}
            routines={routineList ?? cachedRoutines ?? undefined}
            voiceBusy={voiceBusy}
            offline={offline}
            typing={homeTyping}
            repeating={beginWorkout.pending}
            onVoice={() => void startVoice()}
            onType={() => setHomeTyping(true)}
            onRepeat={(sessionIds) => void beginWorkout.repeatWorkouts(sessionIds)}
            onStartRoutine={(routineId) => void beginWorkout.startRoutine(routineId)}
          />
          {homeTyping ? (
            <div className="fixed inset-x-0 bottom-0 z-20">
              <Composer
                autoFocus
                text={text}
                onTextChange={setText}
                onSubmitText={() => void submitText()}
                parsingText={voice.status === "parsing" && source === "text"}
                onVoice={() => void startVoice()}
                onManual={() => openManual()}
                busy={voiceBusy}
                offline={offline}
              />
            </div>
          ) : null}
          </>
          )}
        </WeekSummaryLoader>
      )}

      <OpenWorkoutSheet
        open={beginWorkout.promptOpen}
        onClose={beginWorkout.closePrompt}
        onContinue={beginWorkout.continueOpen}
      />

      <Toast
        key={activeToast ? `${activeToast.id}-${activeToast.message}` : "none"}
        toast={activeToast}
        raised={showWorkout || homeTyping}
        onDismiss={() => {
          if (voice.status === "error") {
            dispatch({ type: "dismiss" });
          } else {
            setToast(null);
          }
        }}
      />

      {voice.status === "recording" || (voice.status === "parsing" && source === "voice") ? (
        <ListeningOverlay
          status={voice.status}
          analyser={recorder.analyser}
          onStop={stopVoice}
          onCancel={cancelVoice}
        />
      ) : null}

      <ConfirmSheet
        open={voice.status === "preview" || voice.status === "saving"}
        draft={draft}
        source={source}
        saving={voice.status === "saving"}
        notice={sheetNotice}
        excludeSessionId={knownSession ? (knownSession._id as Id<"sessions">) : undefined}
        onChange={setDraft}
        onDiscard={discardDraft}
        onConfirm={() => void confirmDraft()}
        onRecordAgain={() => void startVoice()}
      />

      {manual ? (
        <ManualEntrySheet
          key={manual.key}
          open
          mode={manual.mode}
          initialExercise={manual.exerciseName}
          initialSet={
            manual.mode === "edit"
              ? {
                  reps: manual.reps,
                  weightLb: manual.weightLb,
                  durationSec: manual.durationSec,
                  distanceM: manual.distanceM,
                  calories: manual.calories,
                  rpe: manual.rpe,
                  setType: manual.setType,
                }
              : undefined
          }
          library={library}
          truncatedLibrary={exercises?.truncated ?? false}
          sessionSets={sessionSets}
          excludeSessionId={knownSession ? (knownSession._id as Id<"sessions">) : undefined}
          pending={manualPending}
          planTargets={activePlan.map((item) => ({
            name: item.name,
            targetSets: item.targetSets,
            targetReps: item.targetReps,
          }))}
          onClose={() => setManual(null)}
          onAdd={addManual}
          onDelete={
            manual.mode === "edit"
              ? () => {
                  const setId = manual.setId;
                  setManual(null);
                  void deleteSet(setId);
                }
              : undefined
          }
        />
      ) : null}

      <FinishSheet
        open={finishOpen && !showStale}
        summary={`${pluralize(groups.length, "exercise")} · ${pluralize(sessionSets.length, "set")} · ${formatDuration(savedEnd - startedAt)}`}
        note={idleTrimmed ? "Idle time after your last set isn't counted." : null}
        pending={ending}
        error={finishError}
        workoutNote={finishNote}
        onWorkoutNoteChange={setFinishNote}
        onCancel={() => setFinishOpen(false)}
        onFinish={() => void finishWorkout()}
      />

      {lastSetAt !== null ? (
        <StaleWorkoutSheet
          open={showStale}
          idleMs={Math.max(0, (clockNow ?? lastSetAt) - lastSetAt)}
          finishing={ending}
          keeping={keeping}
          error={finishError}
          onKeepGoing={() => void keepWorkoutGoing()}
          onFinish={() => void finishWorkout()}
        />
      ) : null}
    </>
  );
}
