"use client";

import { PendingChanges } from "@/components/PendingChanges";
import { useConnectivity } from "@/components/useConnectivity";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { PersonalRecord } from "@/convex/lib/records";
import { isArgumentValidationError, readableError } from "@/lib/errors";
import {
  clearPendingRest,
  loadPendingRests,
  queueRest,
  savePendingRests,
  type PendingRest,
} from "@/lib/exerciseRest";
import { pluralize } from "@/lib/format";
import { holdChanges, prepareBatch, splitBatch } from "@/lib/offline/batch";
import { resolveDocumentId } from "@/lib/offline/documentId";
import { withQueueLock } from "@/lib/offline/lock";
import { mergeOutboxes } from "@/lib/offline/merge";
import { OFFLINE_BANNER } from "@/lib/offline/messages";
import {
  applySyncResult,
  batchHasWork,
  editPendingSet,
  emptyOutbox,
  enqueueBody,
  enqueueSets,
  firstSyncError,
  knownServerIds,
  nextBatch,
  parseOutbox,
  pendingChangeCount,
  pendingExerciseNames,
  queueAction,
  queueDelete,
  queueEdit,
  reconcileOutbox,
  releaseOpenSession,
  removePendingBody,
  removePendingSet,
  resolveSessionClientId,
  type Outbox,
  type PendingBody,
  type PendingEdit,
  type PendingSet,
  type Placement,
  type SetBody,
  type SyncBatch,
  type SyncResult,
} from "@/lib/offline/outbox";
import {
  clearAllErrors,
  clearItemError,
  discardPendingItem,
  listPendingItems,
} from "@/lib/offline/pendingItems";
import { RETRY_BASE_MS, nextRetryDelay } from "@/lib/offline/retry";
import {
  accountKey,
  browserStore,
  loadOutbox,
  loadSnapshot,
  OfflineStorageError,
  offlineWritesSuspended,
  peekOutboxRaw,
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

export type SaveSetInput = {
  exerciseName: string;
  reps?: number | null;
  weightLb: number;
  durationSec?: number | null;
  distanceM?: number | null;
  calories?: number | null;
  rpe?: number | null;
  setType?: SetBody["setType"];
  loggedAt?: number;
  supersetId?: string;
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
  calories?: number | null;
  rpe?: number | null;
  setType?: SetBody["setType"];
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
  /** Set when a finish call stored an end time. Null for other actions. */
  completedAt: number | null;
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
  /** Remembers an exercise rest offline and sends it outside the set batch. */
  queueExerciseRest: (name: string, restSeconds: number | null) => void;
  /** Queues a weigh-in and sends it with the rest of the outbox. */
  saveBody: (entry: Omit<PendingBody, "syncError" | "echoed">) => Promise<SyncOutcome>;
  /** Drops a weigh-in that has not been saved on the server yet. */
  discardPendingBody: (clientId: string) => void;
  accountEmail: string | null;
  storageWarning: string | null;
  pendingItems: ReturnType<typeof listPendingItems>;
  retryPending: (id: string) => void;
  retryAll: () => void;
  discardPending: (id: string) => void;
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
  const setExerciseRest = useMutation(api.exercises.setRest);
  const completeSession = useMutation(api.sessions.complete);
  const keepGoingSession = useMutation(api.sessions.keepGoing);
  const discardSession = useMutation(api.sessions.discard);

  const [outbox, setOutbox] = useState<Outbox>(emptyOutbox);
  const [snapshot, setSnapshot] = useState<WorkoutSnapshot | null>(null);
  const [flushError, setFlushError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [rests, setRests] = useState<PendingRest[]>([]);
  const [storageWarning, setStorageWarning] = useState<string | null>(null);

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
  const bodyResults = useRef(new Map<string, SyncResult["body"][number]>());
  const acceptRef = useRef(accept);
  const completeRef = useRef(completeSession);
  const keepGoingRef = useRef(keepGoingSession);
  const discardRef = useRef(discardSession);
  const setExerciseRestRef = useRef(setExerciseRest);
  const snapshotSerial = useRef("");
  const lockDepth = useRef(0);
  const retryDelayRef = useRef(RETRY_BASE_MS);
  const nextRetryAtRef = useRef(0);

  emailRef.current = email;
  offlineRef.current = offline;
  acceptRef.current = accept;
  completeRef.current = completeSession;
  keepGoingRef.current = keepGoingSession;
  discardRef.current = discardSession;
  setExerciseRestRef.current = setExerciseRest;

  const publish = useCallback((next: Outbox) => {
    const serial = JSON.stringify(next);
    outboxRef.current = next;
    if (serial === serialRef.current) {
      return;
    }
    serialRef.current = serial;
    setOutbox(next);
  }, []);

  const withLock = useCallback(async <T,>(fn: () => Promise<T>): Promise<T> => {
    if (lockDepth.current > 0) {
      return await fn();
    }
    return await withQueueLock(emailRef.current, async () => {
      lockDepth.current += 1;
      try {
        return await fn();
      } finally {
        lockDepth.current -= 1;
      }
    });
  }, []);

  const writeThrough = useCallback(
    (next: Outbox) => {
      publish(next);
      if (!loadedRef.current || offlineWritesSuspended()) {
        return;
      }
      try {
        const store = browserStore();
        if (sameStoredQueue(peekOutboxRaw(store, emailRef.current), next)) {
          setStorageWarning(null);
          return;
        }
        saveOutbox(store, emailRef.current, next);
        setStorageWarning(null);
      } catch (error) {
        if (error instanceof OfflineStorageError) {
          setStorageWarning(storageWarningText(offlineRef.current));
          return;
        }
        throw error;
      }
    },
    [publish],
  );

  const readMerged = useCallback((): Outbox => {
    try {
      return mergeOutboxes(loadOutbox(browserStore(), emailRef.current), outboxRef.current);
    } catch (error) {
      if (error instanceof OfflineStorageError) {
        setStorageWarning(storageWarningText(offlineRef.current));
        return outboxRef.current;
      }
      throw error;
    }
  }, []);

  const persist = useCallback(
    (next: Outbox) => {
      publish(next);
      if (!loadedRef.current || offlineWritesSuspended()) {
        return;
      }
      void withLock(async () => {
        writeThrough(readMerged());
      });
    },
    [publish, readMerged, withLock, writeThrough],
  );

  const ensureLoaded = useCallback(() => {
    if (loadedRef.current && hydratedEmail.current === emailRef.current) {
      return;
    }
    const emailAtLoad = emailRef.current;
    try {
      const stored = loadOutbox(browserStore(), emailAtLoad);
      const snap = loadSnapshot(browserStore(), emailAtLoad);
      serialRef.current = JSON.stringify(stored);
      outboxRef.current = stored;
      setOutbox(stored);
      snapshotSerial.current = JSON.stringify(snap);
      setSnapshot(snap);
      setRests(loadPendingRests(browserStore(), emailAtLoad));
      setStorageWarning(null);
    } catch (error) {
      if (!(error instanceof OfflineStorageError)) {
        throw error;
      }
      if (hydratedEmail.current !== emailAtLoad) {
        serialRef.current = JSON.stringify(emptyOutbox());
        outboxRef.current = emptyOutbox();
        setOutbox(emptyOutbox());
        setRests([]);
      }
      setStorageWarning(storageWarningText(offlineRef.current));
      loadedRef.current = true;
      hydratedEmail.current = emailAtLoad;
      setReady(true);
      return;
    }
    loadedRef.current = true;
    hydratedEmail.current = emailAtLoad;
    setReady(true);
    void withLock(async () => {
      if (emailRef.current !== emailAtLoad) {
        return;
      }
      writeThrough(readMerged());
    });
  }, [readMerged, withLock, writeThrough]);

  useEffect(() => {
    ensureLoaded();
  }, [email, ensureLoaded]);

  useEffect(() => {
    function onStorage(event: StorageEvent) {
      if (!queueStorageKey(event.key, emailRef.current) || !loadedRef.current) {
        return;
      }
      void withLock(async () => {
        writeThrough(readMerged());
        try {
          setRests(loadPendingRests(browserStore(), emailRef.current));
        } catch (error) {
          if (error instanceof OfflineStorageError) {
            setStorageWarning(storageWarningText(offlineRef.current));
            return;
          }
          throw error;
        }
      });
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [readMerged, withLock, writeThrough]);

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
    for (const item of result.body ?? []) {
      bodyResults.current.set(item.clientId, item);
    }
  }, []);

  const applyRaw = useCallback(
    (gen: number, result: SyncResult) => {
      if (flushSerial.current !== gen || offlineWritesSuspended()) {
        record(result);
        return;
      }
      record(result);
      const next = applySyncResult(outboxRef.current, result).outbox;
      if (lockDepth.current > 0) {
        writeThrough(next);
      } else {
        persist(next);
      }
      retryDelayRef.current = RETRY_BASE_MS;
      nextRetryAtRef.current = 0;
      setFlushError(null);
    },
    [persist, record, writeThrough],
  );

  const postBatch = useCallback(
    async (batch: SyncBatch, depth: number): Promise<"ok" | "stop"> => {
      if (depth > 16) {
        writeThrough(withSyncError(outboxRef.current, batch, "That change could not be saved"));
        return "ok";
      }
      const prepared = prepareBatch(outboxRef.current, batch);
      if (prepared.held.length > 0) {
        writeThrough(holdChanges(outboxRef.current, prepared.held));
      }
      if (!batchHasWork(prepared.batch)) {
        return "ok";
      }
      const gen = flushSerial.current + 1;
      flushSerial.current = gen;
      const invocation = acceptRef
        .current(batchPayload(prepared.batch))
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
        return "ok";
      }
      if (outcome.kind === "timeout") {
        void invocation.then((later) => {
          if (later.kind === "ok") {
            applyRaw(gen, later.raw);
          }
        });
        return "stop";
      }
      if (isValidationError(outcome.error)) {
        const parts = splitBatch(prepared.batch);
        if (!parts) {
          writeThrough(
            withSyncError(outboxRef.current, prepared.batch, readableError(outcome.error)),
          );
          return "ok";
        }
        const first = await postBatch(parts[0], depth + 1);
        const second = await postBatch(parts[1], depth + 1);
        return first === "stop" || second === "stop" ? "stop" : "ok";
      }
      nextRetryAtRef.current = Date.now() + retryDelayRef.current;
      retryDelayRef.current = nextRetryDelay(retryDelayRef.current);
      setFlushError(readableError(outcome.error));
      return "stop";
    },
    [applyRaw, writeThrough],
  );

  const sendBatch = useCallback(
    async (respectBackoff: boolean, depth = 0) => {
      if (depth > 12 || offlineRef.current || offlineWritesSuspended()) {
        return;
      }
      if (respectBackoff && Date.now() < nextRetryAtRef.current) {
        return;
      }
      await withLock(async () => {
        const merged = readMerged();
        const prepared = prepareBatch(merged, nextBatch(merged));
        const held = holdChanges(merged, prepared.held);
        writeThrough(held);
        if (!batchHasWork(prepared.batch)) {
          return;
        }
        const status = await postBatch(prepared.batch, 0);
        if (status !== "ok" || offlineRef.current) {
          return;
        }
        if (batchHasWork(nextBatch(outboxRef.current))) {
          await sendBatch(false, depth + 1);
        }
      });
    },
    [postBatch, readMerged, withLock, writeThrough],
  );

  const flush = useCallback(
    (respectBackoff = false) => {
      const run = tailRef.current.then(() => sendBatch(respectBackoff));
      tailRef.current = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
    [sendBatch],
  );

  const refreshRests = useCallback(() => {
    try {
      const pending = loadPendingRests(browserStore(), emailRef.current);
      setRests(pending);
      return pending.length;
    } catch (error) {
      if (error instanceof OfflineStorageError) {
        setStorageWarning(storageWarningText(offlineRef.current));
        return rests.length;
      }
      throw error;
    }
  }, [rests.length]);

  const flushRests = useCallback(async () => {
    let pending: PendingRest[];
    try {
      pending = loadPendingRests(browserStore(), emailRef.current);
    } catch (error) {
      if (error instanceof OfflineStorageError) {
        setStorageWarning(storageWarningText(offlineRef.current));
        return rests.length;
      }
      throw error;
    }
    if (offlineRef.current || offlineWritesSuspended()) {
      setRests(pending);
      return pending.length;
    }
    const left: PendingRest[] = [];
    for (const item of pending) {
      try {
        await setExerciseRestRef.current({ name: item.name, restSeconds: item.restSeconds });
      } catch {
        left.push(item);
      }
    }
    try {
      savePendingRests(browserStore(), emailRef.current, left);
      setStorageWarning(null);
    } catch (error) {
      if (!(error instanceof OfflineStorageError)) {
        throw error;
      }
      setStorageWarning(storageWarningText(offlineRef.current));
    }
    setRests(left);
    return left.length;
  }, [rests.length]);

  const queueExerciseRest = useCallback(
    (name: string, restSeconds: number | null) => {
      if (offlineWritesSuspended()) {
        return;
      }
      try {
        queueRest(browserStore(), emailRef.current, name, restSeconds);
        setStorageWarning(null);
      } catch (error) {
        if (error instanceof OfflineStorageError) {
          setStorageWarning(storageWarningText(offlineRef.current));
          return;
        }
        throw error;
      }
      refreshRests();
    },
    [refreshRests],
  );

  const readPending = useCallback(() => {
    ensureLoaded();
    return pendingChangeCount(outboxRef.current) + refreshRests();
  }, [ensureLoaded, refreshRests]);

  const syncPending = useCallback(async () => {
    ensureLoaded();
    const restsWaiting = refreshRests();
    if (pendingChangeCount(outboxRef.current) === 0 && restsWaiting === 0) {
      return 0;
    }
    if (offlineRef.current) {
      return pendingChangeCount(outboxRef.current) + restsWaiting;
    }
    if (pendingChangeCount(outboxRef.current) > 0) {
      await flush();
    }
    const restsLeft = await flushRests();
    return pendingChangeCount(outboxRef.current) + restsLeft;
  }, [ensureLoaded, flush, flushRests, refreshRests]);

  useEffect(() => {
    if (!autoSync || offline || !ready) {
      return;
    }
    if (pendingChangeCount(outbox) === 0 && rests.length === 0) {
      return;
    }
    if (pendingChangeCount(outbox) > 0) {
      void flush();
    }
    if (rests.length > 0) {
      void flushRests();
    }
    const timer = window.setInterval(() => {
      if (pendingChangeCount(outboxRef.current) > 0) {
        void flush(true);
      }
      void flushRests();
    }, RETRY_BASE_MS);
    return () => window.clearInterval(timer);
  }, [autoSync, flush, flushRests, offline, outbox, ready, rests.length]);

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

  const saveBody = useCallback(
    async (entry: Omit<PendingBody, "syncError" | "echoed">): Promise<SyncOutcome> => {
      ensureLoaded();
      persist(enqueueBody(outboxRef.current, entry));
      if (offlineRef.current) {
        return { ...outcome("queued", null), clientIds: [entry.clientId] };
      }
      await wait();
      const result = bodyResults.current.get(entry.clientId);
      if (result?.status === "rejected") {
        return outcome("rejected", result.message);
      }
      if (result?.status === "applied") {
        return {
          ...outcome("synced", null),
          clientIds: [entry.clientId],
          setIds: result.entryId ? [result.entryId] : [],
        };
      }
      return { ...outcome("queued", null), clientIds: [entry.clientId] };
    },
    [ensureLoaded, persist, wait],
  );

  const discardPendingBody = useCallback(
    (clientId: string) => {
      ensureLoaded();
      persist(removePendingBody(outboxRef.current, clientId));
    },
    [ensureLoaded, persist],
  );

  const saveSets = useCallback(
    async (input: SaveSetsInput): Promise<SyncOutcome> => {
      ensureLoaded();
      if (input.sets.length === 0) {
        return outcome("rejected", "Log at least one set");
      }
      const sessionClientId = resolveSessionClientId(
        outboxRef.current,
        {
          sessionId: input.sessionId,
          explicit: input.sessionClientId,
          placement: input.placement,
        },
        newClientId,
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
          calories: set.calories ?? null,
          rpe: set.rpe ?? null,
          ...(set.setType !== undefined ? { setType: set.setType } : {}),
          ...(set.supersetId ? { supersetId: set.supersetId } : {}),
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
        calories: input.calories ?? null,
        rpe: input.rpe ?? null,
        ...(input.setType !== undefined ? { setType: input.setType } : {}),
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
      const known = knownServerIds(next);
      for (const id of ids) {
        const pending = findPending(next, id, id.startsWith("pending:") ? id.slice("pending:".length) : id);
        if (pending && pending.ackedSetId === null) {
          next = removePendingSet(next, pending.clientId);
          continue;
        }
        const candidate = pending?.ackedSetId ?? (id.startsWith("pending:") ? null : id);
        const serverId = candidate ? resolveDocumentId(candidate, known) : null;
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
          if (kind === "complete" || kind === "discard") {
            persist(releaseOpenSession(outboxRef.current));
          }
          return outcome("synced", null, input.sessionId, raced.personalRecords, raced.completedAt);
        }
        if (raced.kind === "error") {
          return outcome("rejected", readableError(raced.error));
        }
      }
      const actionId = newClientId();
      const sessionClientId = resolveSessionClientId(
        outboxRef.current,
        { sessionId: input.sessionId, placement: "open" },
        newClientId,
      );
      let queued = queueAction(outboxRef.current, {
        actionId,
        sessionId: input.sessionId,
        sessionClientId,
        kind,
        note: input.note ?? null,
        requestedAt: input.requestedAt,
      });
      if (kind === "complete" || kind === "discard") {
        queued = releaseOpenSession(queued);
      }
      persist(queued);
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

  const retryPending = useCallback(
    (id: string) => {
      ensureLoaded();
      retryDelayRef.current = RETRY_BASE_MS;
      nextRetryAtRef.current = 0;
      if (id.startsWith("rest:")) {
        void flushRests();
        return;
      }
      persist(clearItemError(outboxRef.current, id));
      void flush();
    },
    [ensureLoaded, flush, flushRests, persist],
  );

  const retryAll = useCallback(() => {
    ensureLoaded();
    retryDelayRef.current = RETRY_BASE_MS;
    nextRetryAtRef.current = 0;
    persist(clearAllErrors(outboxRef.current));
    void flush();
    void flushRests();
  }, [ensureLoaded, flush, flushRests, persist]);

  const discardPending = useCallback(
    (id: string) => {
      ensureLoaded();
      if (id.startsWith("rest:")) {
        try {
          clearPendingRest(browserStore(), emailRef.current, id.slice("rest:".length));
        } catch (error) {
          if (!(error instanceof OfflineStorageError)) {
            throw error;
          }
          setStorageWarning(storageWarningText(offlineRef.current));
        }
        refreshRests();
        return;
      }
      persist(discardPendingItem(outboxRef.current, id));
    },
    [ensureLoaded, persist, refreshRests],
  );

  const pendingItems = useMemo(() => listPendingItems(outbox, rests), [outbox, rests]);

  const value = useMemo<OfflineLog>(
    () => ({
      offline,
      outbox,
      snapshot,
      pendingCount: pendingChangeCount(outbox) + rests.length,
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
      queueExerciseRest,
      saveBody,
      discardPendingBody,
      accountEmail: email,
      storageWarning,
      pendingItems,
      retryPending,
      retryAll,
      discardPending,
    }),
    [
      discardPending,
      discardPendingBody,
      editSet,
      email,
      flushError,
      offline,
      outbox,
      pendingItems,
      readPending,
      rememberWorkout,
      removeMany,
      reconcile,
      rests.length,
      retryAll,
      retryPending,
      runAction,
      saveBody,
      saveSets,
      queueExerciseRest,
      snapshot,
      storageWarning,
      syncPending,
    ],
  );

  return <OfflineContext.Provider value={value}>{children}</OfflineContext.Provider>;
}

export function OfflineBanner() {
  const log = useOfflineLog();
  const { offline, pendingCount, syncError, pendingNames, storageWarning } = log;
  const [review, setReview] = useState(false);
  if (!offline && pendingCount === 0 && !syncError && !storageWarning) {
    return null;
  }
  const showReview = pendingCount > 0 || syncError !== null || storageWarning !== null;
  return (
    <>
      <div
        role="status"
        className="sticky top-0 z-30 bg-inverse px-5 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] text-sm text-inverse-ink"
      >
        {offline ? <p>{OFFLINE_BANNER}</p> : null}
        {!offline && pendingCount > 0 ? <p>Saving {pluralize(pendingCount, "change")}…</p> : null}
        {offline && pendingNames.length > 0 ? <p>Waiting: {pendingNames.join(", ")}</p> : null}
        {storageWarning ? <p>{storageWarning}</p> : null}
        {syncError ? <p>{syncError}</p> : null}
        {showReview ? (
          <button type="button" className="mt-1 underline underline-offset-2" onClick={() => setReview(true)}>
            Review pending changes
          </button>
        ) : null}
      </div>
      <PendingChanges
        open={review}
        onClose={() => setReview(false)}
        items={log.pendingItems}
        storageWarning={storageWarning}
        onRetry={log.retryPending}
        onRetryAll={log.retryAll}
        onDiscard={log.discardPending}
      />
    </>
  );
}

function outcome(
  status: SyncOutcome["status"],
  error: string | null,
  sessionId: string | null = null,
  personalRecords: PersonalRecord[] = [],
  completedAt: number | null = null,
): SyncOutcome {
  return {
    status,
    error,
    personalRecords,
    setIds: [],
    clientIds: [],
    sessionId,
    completedAt,
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
      completedAt: null,
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
    ...(input.calories !== undefined ? { calories: input.calories } : {}),
    ...(input.rpe !== undefined ? { rpe: input.rpe } : {}),
    ...(input.setType !== undefined ? { setType: input.setType } : {}),
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

function newClientId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID().replaceAll("-", "");
  }
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

function batchPayload(batch: SyncBatch) {
  return {
    clientNow: Date.now(),
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
      ...(set.set.calories != null && set.set.calories > 0 ? { calories: set.set.calories } : {}),
      ...(set.set.rpe !== null ? { rpe: set.set.rpe } : {}),
      ...(set.set.setType !== undefined ? { setType: set.set.setType } : {}),
      ...(set.set.supersetId ? { supersetId: set.set.supersetId } : {}),
      ...(set.note ? { note: set.note } : {}),
    })),
    edits: batch.edits.map((edit) => ({
      editId: edit.editId,
      setId: edit.setId as Id<"sets">,
      weightLb: edit.weightLb,
      ...(edit.reps !== null ? { reps: edit.reps } : {}),
      ...(edit.durationSec !== null ? { durationSec: edit.durationSec } : {}),
      ...(edit.distanceM !== null ? { distanceM: edit.distanceM } : {}),
      ...(edit.calories != null && edit.calories > 0 ? { calories: edit.calories } : {}),
      ...(edit.rpe !== null ? { rpe: edit.rpe } : {}),
      ...(edit.setType !== undefined ? { setType: edit.setType } : {}),
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
    body: batch.body.map((entry) => ({
      clientId: entry.clientId,
      loggedAt: entry.loggedAt,
      ...(entry.weightLb !== null ? { weightLb: entry.weightLb } : {}),
      ...(entry.bodyFatPct !== null ? { bodyFatPct: entry.bodyFatPct } : {}),
      ...(entry.waistCm !== null ? { waistCm: entry.waistCm } : {}),
      ...(entry.chestCm !== null ? { chestCm: entry.chestCm } : {}),
      ...(entry.armCm !== null ? { armCm: entry.armCm } : {}),
      ...(entry.hipsCm !== null ? { hipsCm: entry.hipsCm } : {}),
      ...(entry.thighCm !== null ? { thighCm: entry.thighCm } : {}),
      ...(entry.note ? { note: entry.note } : {}),
    })),
  };
}

function toSyncResult(raw: {
  sets: SyncResult["sets"];
  edits: SyncResult["edits"];
  deletes: SyncResult["deletes"];
  actions: SyncResult["actions"];
  body?: SyncResult["body"];
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
    body: (raw.body ?? []).map((item) => ({
      clientId: item.clientId,
      status: item.status,
      entryId: item.entryId,
      message: item.message,
    })),
  };
}

function withSyncError(current: Outbox, batch: SyncBatch, message: string): Outbox {
  const setIds = new Set(batch.sets.map((set) => set.clientId));
  const editIds = new Set(batch.edits.map((edit) => edit.editId));
  const deleteIds = new Set(batch.deletes.map((deletion) => deletion.deleteId));
  const actionIds = new Set(batch.actions.map((action) => action.actionId));
  const bodyIds = new Set(batch.body.map((entry) => entry.clientId));
  return {
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
    body: current.body.map((entry) =>
      bodyIds.has(entry.clientId) && !entry.echoed ? { ...entry, syncError: message } : entry,
    ),
  };
}

function sameStoredQueue(raw: string | null, next: Outbox): boolean {
  if (raw === null) {
    return false;
  }
  try {
    const stored = JSON.stringify(parseOutbox(JSON.parse(raw) as unknown));
    return stored === JSON.stringify(parseOutbox(next));
  } catch {
    return false;
  }
}

function storageWarningText(offline: boolean): string {
  return offline
    ? "This phone couldn't store changes. Stay here until you're back online, or they'll be lost."
    : "This phone couldn't store changes. They're still here and will be sent, but they aren't saved on the phone.";
}

function queueStorageKey(key: string | null, email: string | null): boolean {
  if (!key) {
    return false;
  }
  const account = accountKey(email);
  return (
    key === `workout-account:${account}:outbox` ||
    key === `workout-account:${account}:pending-rest` ||
    key === `workout-account:${account}:exercise-rest` ||
    key === `workout-offline:outbox:${account}` ||
    key === "workout-offline:outbox" ||
    key === "workout-offline:pending-rest" ||
    key === "workout-offline:exercise-rest"
  );
}

function isValidationError(error: unknown): boolean {
  return isArgumentValidationError(error);
}

async function directAction(
  kind: "complete" | "discard" | "keepGoing",
  input: WorkoutActionInput,
  mutations: {
    complete: (args: {
      sessionId: Id<"sessions">;
      note?: string;
    }) => Promise<{ completedAt: number; personalRecords: PersonalRecord[] }>;
    keepGoing: (args: { sessionId: Id<"sessions"> }) => Promise<null>;
    discard: (args: { sessionId: Id<"sessions"> }) => Promise<null>;
  },
): Promise<
  | { kind: "ok"; personalRecords: PersonalRecord[]; completedAt: number | null }
  | { kind: "error"; error: unknown }
> {
  const sessionId = input.sessionId as Id<"sessions">;
  try {
    if (kind === "complete") {
      const saved = await mutations.complete({
        sessionId,
        ...(input.note !== undefined ? { note: input.note } : {}),
      });
      return { kind: "ok", personalRecords: saved.personalRecords, completedAt: saved.completedAt };
    }
    if (kind === "keepGoing") {
      await mutations.keepGoing({ sessionId });
    } else {
      await mutations.discard({ sessionId });
    }
    return { kind: "ok", personalRecords: [], completedAt: null };
  } catch (error) {
    return { kind: "error", error };
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
