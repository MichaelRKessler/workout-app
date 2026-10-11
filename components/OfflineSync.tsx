"use client";

import { useConnectivity } from "@/components/useConnectivity";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { isClientId } from "@/convex/lib/clientIds";
import type { PersonalRecord } from "@/convex/lib/records";
import { readableError } from "@/lib/errors";
import { pluralize } from "@/lib/format";
import { OFFLINE_BANNER } from "@/lib/offline/messages";
import {
  applySyncResult,
  batchHasWork,
  editPendingSet,
  emptyOutbox,
  enqueueSets,
  firstSyncError,
  nextBatch,
  pendingChangeCount,
  pendingExerciseNames,
  queueAction,
  queueDelete,
  queueEdit,
  reconcileOutbox,
  removePendingSet,
  type Outbox,
  type PendingEdit,
  type PendingSet,
  type Placement,
  type SetBody,
  type SyncBatch,
  type SyncResult,
} from "@/lib/offline/outbox";
import {
  browserStore,
  loadOutbox,
  loadSnapshot,
  offlineWritesSuspended,
  saveOutbox,
  saveSnapshot,
  type WorkoutSnapshot,
} from "@/lib/offline/storage";
import { useMutation } from "convex/react";
import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

const SYNC_TIMEOUT_MS = 8000;
const RETRY_MS = 15000;

export type SaveSetInput = {
  exerciseName: string;
  reps?: number | null;
  weightLb: number;
  durationSec?: number | null;
  distanceM?: number | null;
  rpe?: number | null;
  loggedAt?: number;
};

export type SaveSetsInput = {
  placement: Placement;
  sessionId: string | null;
  sessionClientId?: string;
  sessionStartedAt: number;
  note: string | null;
  sets: SaveSetInput[];
};

export type EditSetInput = {
  setId: string;
  clientId?: string | null;
  reps?: number | null;
  weightLb: number;
  durationSec?: number | null;
  distanceM?: number | null;
  rpe?: number | null;
};

export type WorkoutActionInput = {
  sessionId: string | null;
  requestedAt: number;
  note?: string;
};

export type SyncOutcome = {
  status: "synced" | "queued" | "rejected";
  error: string | null;
  personalRecords: PersonalRecord[];
  setIds: string[];
  clientIds: string[];
  sessionId: string | null;
};

type OfflineLog = {
  offline: boolean;
  outbox: Outbox;
  snapshot: WorkoutSnapshot | null;
  pendingCount: number;
  syncError: string | null;
  pendingNames: string[];
  saveSets: (input: SaveSetsInput) => Promise<SyncOutcome>;
  editSet: (input: EditSetInput) => Promise<SyncOutcome>;
  removeMany: (ids: string[]) => Promise<SyncOutcome>;
  finishWorkout: (input: WorkoutActionInput) => Promise<SyncOutcome>;
  keepGoing: (input: WorkoutActionInput) => Promise<SyncOutcome>;
  discardWorkout: (input: WorkoutActionInput) => Promise<SyncOutcome>;
  rememberWorkout: (snapshot: WorkoutSnapshot) => void;
  reconcile: (serverSets: Parameters<typeof reconcileOutbox>[1]) => void;
  /** Loads the on-device queue and returns how many changes are still waiting. */
  readPending: () => number;
  /** Sends the queue now. Returns how many changes are still waiting. */
  syncPending: () => Promise<number>;
};

const OfflineContext = createContext<OfflineLog | null>(null);

export function useOfflineLog(): OfflineLog {
  const value = useContext(OfflineContext);
  if (!value) {
    throw new Error("Offline logging is only available once you're signed in");
  }
  return value;
}

export function OfflineSyncProvider({
  email,
  autoSync = true,
  children,
}: {
  email: string | null;
  /** When false, the queue stays on the phone until something calls syncPending. */
  autoSync?: boolean;
  children: ReactNode;
}) {
  const { offline } = useConnectivity();
  const accept = useMutation(api.offline.accept);
  const completeSession = useMutation(api.sessions.complete);
  const keepGoingSession = useMutation(api.sessions.keepGoing);
  const discardSession = useMutation(api.sessions.discard);

  const [outbox, setOutbox] = useState<Outbox>(emptyOutbox);
  const [snapshot, setSnapshot] = useState<WorkoutSnapshot | null>(null);
  const [flushError, setFlushError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const outboxRef = useRef(outbox);
  const serialRef = useRef("");
  const emailRef = useRef(email);
  const offlineRef = useRef(offline);
  const loadedRef = useRef(false);
  const hydratedEmail = useRef<string | null | undefined>(undefined);
  const tailRef = useRef<Promise<void>>(Promise.resolve());
  const flushSerial = useRef(0);
  const setResults = useRef(new Map<string, SyncResult["sets"][number]>());
  const editResults = useRef(new Map<string, SyncResult["edits"][number]>());
  const deleteResults = useRef(new Map<string, SyncResult["deletes"][number]>());
  const actionResults = useRef(new Map<string, SyncResult["actions"][number]>());
  const acceptRef = useRef(accept);
  const completeRef = useRef(completeSession);
  const keepGoingRef = useRef(keepGoingSession);
  const discardRef = useRef(discardSession);
  const snapshotSerial = useRef("");

  emailRef.current = email;
  offlineRef.current = offline;
  acceptRef.current = accept;
  completeRef.current = completeSession;
  keepGoingRef.current = keepGoingSession;
  discardRef.current = discardSession;

  const persist = useCallback((next: Outbox) => {
    const serial = JSON.stringify(next);
    outboxRef.current = next;
    if (serial === serialRef.current) {
      return;
    }
    serialRef.current = serial;
    setOutbox(next);
    if (loadedRef.current) {
      saveOutbox(browserStore(), emailRef.current, next);
    }
  }, []);

  const ensureLoaded = useCallback(() => {
    if (loadedRef.current && hydratedEmail.current === emailRef.current) {
      return;
    }
    const stored = loadOutbox(browserStore(), emailRef.current);
    const snap = loadSnapshot(browserStore(), emailRef.current);
    serialRef.current = JSON.stringify(stored);
    outboxRef.current = stored;
    setOutbox(stored);
    snapshotSerial.current = JSON.stringify(snap);
    setSnapshot(snap);
    loadedRef.current = true;
    hydratedEmail.current = emailRef.current;
    setReady(true);
  }, []);

  useEffect(() => {
    ensureLoaded();
  }, [email, ensureLoaded]);

  const record = useCallback((result: SyncResult) => {
    for (const item of result.sets) {
      setResults.current.set(`${item.clientId}:${item.revision}`, item);
    }
    for (const item of result.edits) {
      editResults.current.set(item.editId, item);
    }
    for (const item of result.deletes) {
      deleteResults.current.set(item.deleteId, item);
    }
    for (const item of result.actions) {
      actionResults.current.set(item.actionId, item);
    }
  }, []);

  const applyRaw = useCallback(
    (gen: number, result: SyncResult) => {
      if (flushSerial.current !== gen || offlineWritesSuspended()) {
        record(result);
        return;
      }
      record(result);
      persist(applySyncResult(outboxRef.current, result).outbox);
      setFlushError(null);
    },
    [persist, record],
  );

  const sendBatch = useCallback(async (depth = 0) => {
    if (depth > 10 || offlineRef.current || offlineWritesSuspended()) {
      return;
    }
    const batch = nextBatch(outboxRef.current);
    if (!batchHasWork(batch)) {
      return;
    }
    const gen = flushSerial.current + 1;
    flushSerial.current = gen;
    const invocation = acceptRef
      .current(batchPayload(batch))
      .then(
        (raw) => ({ kind: "ok" as const, raw: toSyncResult(raw) }),
        (error: unknown) => ({ kind: "error" as const, error }),
      );
    const outcome = await Promise.race([
      invocation,
      delay(SYNC_TIMEOUT_MS).then(() => ({ kind: "timeout" as const })),
    ]);
    if (outcome.kind === "ok") {
      applyRaw(gen, outcome.raw);
      if (batchHasWork(nextBatch(outboxRef.current)) && !offlineRef.current) {
        await sendBatch(depth + 1);
      }
      return;
    }
    if (outcome.kind === "timeout") {
      void invocation.then((later) => {
        if (later.kind === "ok") {
          applyRaw(gen, later.raw);
        }
      });
      return;
    }
    if (isValidationError(outcome.error)) {
      failBatch(outboxRef.current, batch, readableError(outcome.error), persist);
      return;
    }
    setFlushError(readableError(outcome.error));
  }, [applyRaw, persist]);

  const flush = useCallback(() => {
    const run = tailRef.current.then(() => sendBatch());
    tailRef.current = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }, [sendBatch]);

  const readPending = useCallback(() => {
    ensureLoaded();
    return pendingChangeCount(outboxRef.current);
  }, [ensureLoaded]);

  const syncPending = useCallback(async () => {
    ensureLoaded();
    if (pendingChangeCount(outboxRef.current) === 0 || offlineRef.current) {
      return pendingChangeCount(outboxRef.current);
    }
    await flush();
    return pendingChangeCount(outboxRef.current);
  }, [ensureLoaded, flush]);

  useEffect(() => {
    if (!autoSync || offline || !ready || pendingChangeCount(outbox) === 0) {
      return;
    }
    void flush();
    const timer = window.setInterval(() => {
      void flush();
    }, RETRY_MS);
    return () => window.clearInterval(timer);
  }, [autoSync, flush, offline, outbox, ready]);

  const wait = useCallback(async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), SYNC_TIMEOUT_MS);
    });
    const done = flush().then(() => "done" as const);
    const winner = await Promise.race([done, timeout]);
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    return winner;
  }, [flush]);

  const saveSets = useCallback(
    async (input: SaveSetsInput): Promise<SyncOutcome> => {
      ensureLoaded();
      if (input.sets.length === 0) {
        return outcome("rejected", "Log at least one set");
      }
      const sessionClientId = resolveSessionClientId(
        outboxRef.current,
        input.sessionId,
        input.sessionClientId,
      );
      const enqueued = enqueueSets(outboxRef.current, {
        placement: input.placement,
        sessionId: input.sessionId,
        sessionClientId,
        sessionStartedAt: input.sessionStartedAt,
        note: input.note,
        now: Date.now(),
        sets: input.sets.map((set) => ({
          clientId: newClientId(),
          exerciseName: set.exerciseName,
          reps: set.reps ?? null,
          weightLb: set.weightLb,
          durationSec: set.durationSec ?? null,
          distanceM: set.distanceM ?? null,
          rpe: set.rpe ?? null,
          ...(set.loggedAt !== undefined ? { loggedAt: set.loggedAt } : {}),
        })),
      });
      persist(enqueued.outbox);
      if (offlineRef.current) {
        return { ...outcome("queued", null), clientIds: enqueued.clientIds };
      }
      await wait();
      return interpretSets(outboxRef.current, enqueued.clientIds, setResults.current, persist);
    },
    [ensureLoaded, persist, wait],
  );

  const editSet = useCallback(
    async (input: EditSetInput): Promise<SyncOutcome> => {
      ensureLoaded();
      const patch = measurePatch(input);
      const pending = findPending(outboxRef.current, input.setId, input.clientId);
      if (pending) {
        const next = editPendingSet(outboxRef.current, pending.clientId, patch);
        persist(next);
        const revision = next.sets.find((set) => set.clientId === pending.clientId)?.revision;
        if (offlineRef.current) {
          return { ...outcome("queued", null), clientIds: [pending.clientId] };
        }
        await wait();
        return interpretSets(
          outboxRef.current,
          [pending.clientId],
          setResults.current,
          persist,
          revision,
        );
      }
      if (input.setId.startsWith("pending:")) {
        return outcome("rejected", "That set is still waiting to save");
      }
      const editId = newClientId();
      const queued: PendingEdit = {
        editId,
        setId: input.setId,
        reps: input.reps ?? null,
        weightLb: input.weightLb,
        durationSec: input.durationSec ?? null,
        distanceM: input.distanceM ?? null,
        rpe: input.rpe ?? null,
        syncError: null,
        echoed: false,
      };
      persist(queueEdit(outboxRef.current, queued));
      if (offlineRef.current) {
        return outcome("queued", null);
      }
      await wait();
      const result = editResults.current.get(editId);
      if (result?.status === "rejected") {
        persist({
          ...outboxRef.current,
          edits: outboxRef.current.edits.filter((edit) => edit.editId !== editId),
        });
        return outcome("rejected", result.message);
      }
      if (result?.status === "applied") {
        return {
          ...outcome("synced", null),
          personalRecords: result.personalRecord ? [result.personalRecord] : [],
        };
      }
      return outcome("queued", null);
    },
    [ensureLoaded, persist, wait],
  );

  const removeMany = useCallback(
    async (ids: string[]): Promise<SyncOutcome> => {
      ensureLoaded();
      let next = outboxRef.current;
      const deleteIds: string[] = [];
      for (const id of ids) {
        const pending = findPending(next, id, id.startsWith("pending:") ? id.slice("pending:".length) : id);
        if (pending && pending.ackedSetId === null) {
          next = removePendingSet(next, pending.clientId);
          continue;
        }
        const serverId = pending?.ackedSetId ?? (id.startsWith("pending:") ? null : id);
        if (!serverId) {
          continue;
        }
        const deleteId = newClientId();
        deleteIds.push(deleteId);
        next = queueDelete(next, deleteId, serverId);
      }
      persist(next);
      if (deleteIds.length === 0 || offlineRef.current) {
        return outcome(offlineRef.current && deleteIds.length > 0 ? "queued" : "synced", null);
      }
      await wait();
      const rejected = deleteIds
        .map((id) => deleteResults.current.get(id))
        .find((item) => item?.status === "rejected");
      if (rejected) {
        persist({
          ...outboxRef.current,
          deletes: outboxRef.current.deletes.filter((item) => item.deleteId !== rejected.deleteId),
        });
        return outcome("rejected", rejected.message);
      }
      const applied = deleteIds.every((id) => deleteResults.current.get(id)?.status === "applied");
      return outcome(applied ? "synced" : "queued", null);
    },
    [ensureLoaded, persist, wait],
  );

  const runAction = useCallback(
    async (
      kind: "complete" | "discard" | "keepGoing",
      input: WorkoutActionInput,
    ): Promise<SyncOutcome> => {
      ensureLoaded();
      const pending = pendingChangeCount(outboxRef.current);
      if (!offlineRef.current && pending === 0 && input.sessionId) {
        const direct = directAction(kind, input, {
          complete: completeRef.current,
          keepGoing: keepGoingRef.current,
          discard: discardRef.current,
        });
        const raced = await Promise.race([
          direct,
          delay(SYNC_TIMEOUT_MS).then(() => ({ kind: "timeout" as const })),
        ]);
        if (raced.kind === "ok") {
          return outcome("synced", null, input.sessionId);
        }
        if (raced.kind === "error") {
          return outcome("rejected", readableError(raced.error));
        }
      }
      const actionId = newClientId();
      const sessionClientId = resolveSessionClientId(outboxRef.current, input.sessionId);
      persist(
        queueAction(outboxRef.current, {
          actionId,
          sessionId: input.sessionId,
          sessionClientId,
          kind,
          note: input.note ?? null,
          requestedAt: input.requestedAt,
        }),
      );
      if (offlineRef.current) {
        return outcome("queued", null, input.sessionId);
      }
      await wait();
      const result = actionResults.current.get(actionId);
      if (result?.status === "rejected") {
        return outcome("rejected", result.message);
      }
      if (result?.status === "applied") {
        return outcome("synced", null, result.sessionId ?? input.sessionId);
      }
      return outcome("queued", null, input.sessionId);
    },
    [ensureLoaded, persist, wait],
  );

  const rememberWorkout = useCallback((next: WorkoutSnapshot) => {
    if (!loadedRef.current || offlineWritesSuspended()) {
      return;
    }
    const serial = JSON.stringify(next);
    if (serial === snapshotSerial.current) {
      return;
    }
    snapshotSerial.current = serial;
    setSnapshot(next);
    saveSnapshot(browserStore(), emailRef.current, next);
  }, []);

  const reconcile = useCallback(
    (serverSets: Parameters<typeof reconcileOutbox>[1]) => {
      ensureLoaded();
      persist(reconcileOutbox(outboxRef.current, serverSets));
    },
    [ensureLoaded, persist],
  );

  const value = useMemo<OfflineLog>(
    () => ({
      offline,
      outbox,
      snapshot,
      pendingCount: pendingChangeCount(outbox),
      syncError: firstSyncError(outbox) ?? flushError,
      pendingNames: pendingExerciseNames(outbox),
      saveSets,
      editSet,
      removeMany,
      finishWorkout: (input) => runAction("complete", input),
      keepGoing: (input) => runAction("keepGoing", input),
      discardWorkout: (input) => runAction("discard", input),
      rememberWorkout,
      reconcile,
      readPending,
      syncPending,
    }),
    [
      editSet,
      flushError,
      offline,
      outbox,
      readPending,
      rememberWorkout,
      removeMany,
      reconcile,
      runAction,
      saveSets,
      snapshot,
      syncPending,
    ],
  );

  return <OfflineContext.Provider value={value}>{children}</OfflineContext.Provider>;
}

export function OfflineBanner() {
  const { offline, pendingCount, syncError, pendingNames } = useOfflineLog();
  if (!offline && pendingCount === 0 && !syncError) {
    return null;
  }
  return (
    <div
      role="status"
      className="sticky top-0 z-30 bg-inverse px-5 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] text-sm text-inverse-ink"
    >
      {offline ? <p>{OFFLINE_BANNER}</p> : null}
      {!offline && pendingCount > 0 ? <p>Saving {pluralize(pendingCount, "change")}…</p> : null}
      {offline && pendingNames.length > 0 ? <p>Waiting: {pendingNames.join(", ")}</p> : null}
      {syncError ? <p>{syncError}</p> : null}
    </div>
  );
}

function outcome(
  status: SyncOutcome["status"],
  error: string | null,
  sessionId: string | null = null,
): SyncOutcome {
  return {
    status,
    error,
    personalRecords: [],
    setIds: [],
    clientIds: [],
    sessionId,
  };
}

function interpretSets(
  outbox: Outbox,
  clientIds: string[],
  results: Map<string, SyncResult["sets"][number]>,
  persist: (next: Outbox) => void,
  revision?: number,
): SyncOutcome {
  const matched = clientIds.map((clientId) => {
    const rev = revision ?? outbox.sets.find((set) => set.clientId === clientId)?.revision;
    return rev === undefined ? undefined : results.get(`${clientId}:${rev}`);
  });
  const rejected = matched.filter((item) => item?.status === "rejected");
  if (rejected.length === clientIds.length && rejected.every((item) => item)) {
    const drop = new Set(clientIds);
    persist({
      ...outbox,
      sets: outbox.sets.filter((set) => !drop.has(set.clientId)),
    });
    return outcome("rejected", rejected[0]?.message ?? "That set could not be saved");
  }
  if (matched.length === clientIds.length && matched.every((item) => item?.status === "applied")) {
    const applied = matched.flatMap((item) => (item ? [item] : []));
    return {
      status: "synced",
      error: null,
      personalRecords: applied.flatMap((item) => (item.personalRecord ? [item.personalRecord] : [])),
      setIds: applied.flatMap((item) => (item.setId ? [item.setId] : [])),
      clientIds,
      sessionId: applied.find((item) => item.sessionId)?.sessionId ?? null,
    };
  }
  return { ...outcome("queued", null), clientIds };
}

function measurePatch(input: EditSetInput): Partial<Omit<SetBody, "loggedAt">> {
  return {
    weightLb: input.weightLb,
    ...(input.reps !== undefined ? { reps: input.reps } : {}),
    ...(input.durationSec !== undefined ? { durationSec: input.durationSec } : {}),
    ...(input.distanceM !== undefined ? { distanceM: input.distanceM } : {}),
    ...(input.rpe !== undefined ? { rpe: input.rpe } : {}),
  };
}

function findPending(outbox: Outbox, setId: string, clientId?: string | null): PendingSet | undefined {
  return outbox.sets.find((set) => {
    if (set.removed) {
      return false;
    }
    if (clientId && set.clientId === clientId) {
      return true;
    }
    if (setId === `pending:${set.clientId}` || set.clientId === setId) {
      return true;
    }
    return set.ackedSetId === setId;
  });
}

function resolveSessionClientId(
  outbox: Outbox,
  sessionId: string | null,
  explicit?: string,
): string {
  if (explicit && isClientId(explicit)) {
    return explicit;
  }
  if (sessionId === null) {
    if (outbox.openSessionClientId && isClientId(outbox.openSessionClientId)) {
      return outbox.openSessionClientId;
    }
    return newClientId();
  }
  const existing = outbox.sets.find((set) => set.sessionId === sessionId);
  if (existing && isClientId(existing.sessionClientId)) {
    return existing.sessionClientId;
  }
  if (isClientId(sessionId)) {
    return sessionId;
  }
  return newClientId();
}

function newClientId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID().replaceAll("-", "");
  }
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

function batchPayload(batch: SyncBatch) {
  return {
    sets: batch.sets.map((set) => ({
      clientId: set.clientId,
      revision: set.revision,
      removed: set.removed,
      placement: set.placement,
      ...(set.sessionId ? { sessionId: set.sessionId as Id<"sessions"> } : {}),
      sessionClientId: set.sessionClientId,
      sessionStartedAt: set.sessionStartedAt,
      exerciseName: set.set.exerciseName,
      loggedAt: set.set.loggedAt,
      weightLb: set.set.weightLb,
      ...(set.set.reps !== null ? { reps: set.set.reps } : {}),
      ...(set.set.durationSec !== null ? { durationSec: set.set.durationSec } : {}),
      ...(set.set.distanceM !== null ? { distanceM: set.set.distanceM } : {}),
      ...(set.set.rpe !== null ? { rpe: set.set.rpe } : {}),
      ...(set.note ? { note: set.note } : {}),
    })),
    edits: batch.edits.map((edit) => ({
      editId: edit.editId,
      setId: edit.setId as Id<"sets">,
      weightLb: edit.weightLb,
      ...(edit.reps !== null ? { reps: edit.reps } : {}),
      ...(edit.durationSec !== null ? { durationSec: edit.durationSec } : {}),
      ...(edit.distanceM !== null ? { distanceM: edit.distanceM } : {}),
      ...(edit.rpe !== null ? { rpe: edit.rpe } : {}),
    })),
    deletes: batch.deletes.map((deletion) => ({
      deleteId: deletion.deleteId,
      setId: deletion.setId as Id<"sets">,
    })),
    actions: batch.actions.map((action) => ({
      actionId: action.actionId,
      kind: action.kind,
      ...(action.sessionId ? { sessionId: action.sessionId as Id<"sessions"> } : {}),
      sessionClientId: action.sessionClientId,
      requestedAt: action.requestedAt,
      ...(action.note ? { note: action.note } : {}),
    })),
  };
}

function toSyncResult(raw: {
  sets: SyncResult["sets"];
  edits: SyncResult["edits"];
  deletes: SyncResult["deletes"];
  actions: SyncResult["actions"];
}): SyncResult {
  return {
    sets: raw.sets.map((item) => ({
      clientId: item.clientId,
      revision: item.revision,
      status: item.status,
      setId: item.setId,
      sessionId: item.sessionId,
      personalRecord: item.personalRecord,
      message: item.message,
    })),
    edits: raw.edits.map((item) => ({
      editId: item.editId,
      status: item.status,
      personalRecord: item.personalRecord,
      message: item.message,
    })),
    deletes: raw.deletes.map((item) => ({
      deleteId: item.deleteId,
      status: item.status,
      message: item.message,
    })),
    actions: raw.actions.map((item) => ({
      actionId: item.actionId,
      status: item.status,
      sessionId: item.sessionId,
      message: item.message,
    })),
  };
}

function failBatch(
  current: Outbox,
  batch: SyncBatch,
  message: string,
  persist: (next: Outbox) => void,
) {
  const setIds = new Set(batch.sets.map((set) => set.clientId));
  const editIds = new Set(batch.edits.map((edit) => edit.editId));
  const deleteIds = new Set(batch.deletes.map((deletion) => deletion.deleteId));
  const actionIds = new Set(batch.actions.map((action) => action.actionId));
  persist({
    ...current,
    sets: current.sets.map((set) =>
      setIds.has(set.clientId) && set.echoedRevision !== set.revision ? { ...set, syncError: message } : set,
    ),
    edits: current.edits.map((edit) =>
      editIds.has(edit.editId) && !edit.echoed ? { ...edit, syncError: message } : edit,
    ),
    deletes: current.deletes.map((deletion) =>
      deleteIds.has(deletion.deleteId) && !deletion.echoed
        ? { ...deletion, syncError: message }
        : deletion,
    ),
    actions: current.actions.map((action) =>
      actionIds.has(action.actionId) && !action.echoed ? { ...action, syncError: message } : action,
    ),
  });
}

function isValidationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : "";
  return message.includes("ArgumentValidationError");
}

async function directAction(
  kind: "complete" | "discard" | "keepGoing",
  input: WorkoutActionInput,
  mutations: {
    complete: (args: {
      sessionId: Id<"sessions">;
      note?: string;
    }) => Promise<null>;
    keepGoing: (args: { sessionId: Id<"sessions"> }) => Promise<null>;
    discard: (args: { sessionId: Id<"sessions"> }) => Promise<null>;
  },
): Promise<{ kind: "ok" } | { kind: "error"; error: unknown }> {
  const sessionId = input.sessionId as Id<"sessions">;
  try {
    if (kind === "complete") {
      await mutations.complete({
        sessionId,
        ...(input.note !== undefined ? { note: input.note } : {}),
      });
    } else if (kind === "keepGoing") {
      await mutations.keepGoing({ sessionId });
    } else {
      await mutations.discard({ sessionId });
    }
    return { kind: "ok" };
  } catch (error) {
    return { kind: "error", error };
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
