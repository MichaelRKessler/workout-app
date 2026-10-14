"use client";

import { FinishedWorkout } from "@/components/WorkoutSummaryCard";
import { useOfflineLog } from "@/components/OfflineSync";
import { Toast } from "@/components/Toast";
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
import { blankPlanItem, toPendingExercise, usePlanEditor } from "@/components/workout/usePlanEditor";
import { useSetActions, type Toasted } from "@/components/workout/useSetActions";
import { useVoiceLog } from "@/components/workout/useVoiceLog";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { formatExerciseName } from "@/convex/lib/exerciseName";
import { plannedCompletedAt } from "@/convex/lib/sessionTiming";
import { EXAMPLE_EXERCISES } from "@/lib/examples";
import { useWeightUnit } from "@/components/WeightUnit";
import { formatDuration, pluralize } from "@/lib/format";
import { summarizeSessions, type WorkoutSummary } from "@/lib/workoutSummary";
import type { PersonalRecord } from "@/convex/lib/records";
import { groupSets } from "@/lib/groupSets";
import {
  hasPendingFinish,
  mergeVisibleSets,
  pendingNote,
  pendingResumedAt,
} from "@/lib/offline/outbox";
import { moveItem } from "@/convex/lib/routinePlan";
import { useBrowserTimeZone } from "@/components/useBrowserTimeZone";
import { useSessionText } from "@/components/useSessionText";
import { composerTextKey } from "@/lib/offline/storage";
import { exerciseLink } from "@/lib/exerciseLink";
import { calendarDayBounds, calendarDayKey, groupHistoryDays } from "@/lib/historyDays";
import { splitWorkoutPlan } from "@/lib/workoutPlan";
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
import { useQuery } from "convex/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { readLocal } from "@/lib/localValue";

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

/**
 * The Log tab. With no open workout it shows the start screen; the first set
 * confirmed by voice, by typing, or by hand opens one.
 */
export function LogWorkout() {
  const openSession = useQuery(api.sessions.getOpen);
  const routineList = useQuery(api.routines.list);
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
  // Kept while an exercise's progress page is open.
  const [text, setText] = useSessionText(composerTextKey(log.accountEmail));
  const [homeTyping, setHomeTyping] = useState(false);
  const [finishNote, setFinishNote] = useState("");
  const [finishOpen, setFinishOpen] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);
  const [ending, setEnding] = useState(false);
  const [finished, setFinished] = useState<{
    sessionId: string | null;
    summary: WorkoutSummary;
    records: PersonalRecord[];
    recordsPending: boolean;
    note: string | null;
    dayKey: string;
  } | null>(null);
  const [keeping, setKeeping] = useState(false);
  const knownSession = openSession !== undefined ? openSession : (snapshot?.session ?? null);

  const plan = usePlanEditor({
    openSession,
    knownSession,
    snapshotPlan: snapshot?.plan,
    routineList,
    offline,
    showToast: (message) => actions.showToast(message),
  });
  const { localPlan, activePlan, planName, editingPlan, setEditingPlan, savePlan } = plan;

  const [deviceRest, setDeviceRest] = useState(DEFAULT_REST_SECONDS);
  useEffect(() => {
    const read = () =>
      setDeviceRest(readRestSeconds(readLocal(REST_STORAGE_KEY)));
    read();
    window.addEventListener("workout-rest-default", read);
    return () => window.removeEventListener("workout-rest-default", read);
  }, []);

  const beginError = beginWorkout.error;
  const clearBeginError = beginWorkout.clearError;
  useEffect(() => {
    if (!beginError) {
      return;
    }
    showBeginError.current(beginError);
    clearBeginError();
  }, [beginError, clearBeginError]);

  const sessionSets = useMemo(() => {
    const serverSets =
      sets ?? (openSession === null ? [] : openSession === undefined ? (snapshot?.sets ?? []) : []);
    return mergeVisibleSets(serverSets, outbox, {
      kind: "open",
      sessionId: knownSession?._id ?? null,
    });
  }, [knownSession?._id, openSession, outbox, sets, snapshot?.sets]);
  const groups = useMemo(() => groupSets(sessionSets), [sessionSets]);

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
    const remembered =
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
      plan: remembered,
    });
  }, [localPlan, log, openSession, sets]);

  function openTarget() {
    return {
      sessionId: knownSession?._id ?? null,
      sessionStartedAt: knownSession?.startedAt ?? Date.now(),
    };
  }

  const actions = useSetActions({
    unit,
    sessionSets,
    lastExerciseName: groups[groups.length - 1]?.name ?? "",
    openTarget,
    // Called from a click, after voiceLog below exists.
    onOpenForm: () => voiceLog.dismissError(),
  });
  const { toast, showToast, showSaved, manual } = actions;
  const showBeginError = useRef((message: string) => showToast({ tone: "error", message }));
  showBeginError.current = (message: string) => showToast({ tone: "error", message });

  const voiceLog = useVoiceLog({
    offline,
    unit,
    text,
    setText,
    clearToast: actions.clearToast,
    save: (toSave) => {
      const target = openTarget();
      return log.saveSets({
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
    },
    onSaved: showSaved,
  });
  const { voice } = voiceLog;
  const planView = useMemo(
    () => (activePlan.length > 0 ? splitWorkoutPlan(activePlan, groups) : null),
    [activePlan, groups],
  );
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
  }, [setEditingPlan, workoutOpen]);

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
    plan.clearPlan();
    setFinished({
      sessionId: saved.sessionId ?? knownSession?._id ?? null,
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

  async function discardWorkout() {
    if (!knownSession && sessionSets.length === 0) {
      plan.clearPlan();
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
    plan.clearPlan();
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
          action: { label: "Add by hand", onClick: () => actions.openManual() },
        }
      : toast;

  if (finished) {
    return (
      <FinishedWorkout
        sessionId={finished.sessionId}
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
          repeatingId={actions.repeatingId}
          ending={ending}
          editingPlan={editingPlan}
          onEditingPlan={setEditingPlan}
          note={workoutNote}
          emptyMessage={
            offline ? "No sets yet. Add one by hand. Voice needs a connection." : undefined
          }
          idleNote={freshness.idleNote ?? undefined}
          onRepeat={(group) => void actions.repeatSet(group)}
          onEditSet={actions.openEdit}
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
                  loggingId={actions.loggingPlanId}
                  setsLoading={sets === undefined && !offline && knownSession !== null}
                  offline={offline}
                  sessionSets={sessionSets}
                  excludeSessionId={knownSession ? (knownSession._id as Id<"sessions">) : undefined}
                  onLog={(exerciseId, exerciseName, set) =>
                    void actions.logPlanSet(exerciseId, exerciseName, set)
                  }
                  onRepeat={(row) =>
                    void actions.repeatSet({ exerciseId: row.exerciseId, name: row.name, sets: row.sets })
                  }
                  repeatingId={actions.repeatingId}
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
                  onEditSet={actions.openEdit}
                  onNeedForm={(exerciseName) => actions.openManual(exerciseName)}
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
                          onRepeat={() => void actions.repeatSet(group)}
                          repeating={actions.repeatingId === group.exerciseId}
                          onEditSet={actions.openEdit}
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
            onSubmitText: () => void voiceLog.submitText(),
            parsingText: voice.status === "parsing" && voiceLog.source === "text",
            onVoice: () => void voiceLog.startVoice(),
            onManual: () => actions.openManual(),
            busy: voiceLog.busy,
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
            routines={routineList ?? plan.cachedRoutines ?? undefined}
            voiceBusy={voiceLog.busy}
            offline={offline}
            typing={homeTyping}
            repeating={beginWorkout.pending}
            onVoice={() => void voiceLog.startVoice()}
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
                onSubmitText={() => void voiceLog.submitText()}
                parsingText={voice.status === "parsing" && voiceLog.source === "text"}
                onVoice={() => void voiceLog.startVoice()}
                onManual={() => actions.openManual()}
                busy={voiceLog.busy}
                offline={offline}
                onClose={() => setHomeTyping(false)}
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
            voiceLog.dismissError();
          } else {
            actions.clearToast();
          }
        }}
      />

      {voice.status === "recording" || (voice.status === "parsing" && voiceLog.source === "voice") ? (
        <ListeningOverlay
          status={voice.status}
          analyser={voiceLog.analyser}
          onStop={voiceLog.stopVoice}
          onCancel={voiceLog.cancelVoice}
        />
      ) : null}

      <ConfirmSheet
        open={voice.status === "preview" || voice.status === "saving"}
        draft={voiceLog.draft}
        source={voiceLog.source}
        saving={voice.status === "saving"}
        notice={voiceLog.sheetNotice}
        excludeSessionId={knownSession ? (knownSession._id as Id<"sessions">) : undefined}
        onChange={voiceLog.setDraft}
        onDiscard={voiceLog.discardDraft}
        onConfirm={() => void voiceLog.confirmDraft()}
        onRecordAgain={() => void voiceLog.startVoice()}
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
          pending={actions.manualPending}
          planTargets={activePlan.map((item) => ({
            name: item.name,
            targetSets: item.targetSets,
            targetReps: item.targetReps,
          }))}
          onClose={actions.closeManual}
          onAdd={actions.addManual}
          onDelete={
            manual.mode === "edit"
              ? () => {
                  const setId = manual.setId;
                  actions.closeManual();
                  void actions.deleteSet(setId);
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
