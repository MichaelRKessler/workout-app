"use client";

import { Button } from "@/components/Button";
import { OpenWorkoutSheet } from "@/components/routines/OpenWorkoutSheet";
import { useBeginWorkout } from "@/components/routines/useBeginWorkout";
import { PageHeader } from "@/components/PageHeader";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { readableError } from "@/lib/errors";
import { pluralize } from "@/lib/format";
import { formatSupersetNames } from "@/convex/lib/superset";
import { moveItem } from "@/convex/lib/routinePlan";
import {
  loadRoutineCache,
  saveRoutineCache,
  type CachedRoutine,
} from "@/lib/offline/routineCache";
import { cacheStore, loadCachedAccess } from "@/lib/offline/storage";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useEffect, useState } from "react";

export function RoutineManager() {
  const live = useQuery(api.routines.list);
  const reorder = useMutation(api.routines.reorder);
  const begin = useBeginWorkout();
  const [cached, setCached] = useState<CachedRoutine[] | null>(null);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  // Moving routines is occasional, so the arrows only show in Reorder mode.
  const [reordering, setReordering] = useState(false);

  useEffect(() => {
    const email = loadCachedAccess(cacheStore())?.email ?? null;
    setCached(loadRoutineCache(cacheStore(), email));
  }, []);

  useEffect(() => {
    if (!live) {
      return;
    }
    const email = loadCachedAccess(cacheStore())?.email ?? null;
    saveRoutineCache(cacheStore(), email, live);
    setCached(live);
  }, [live]);

  const routines = live ?? cached ?? [];
  const loading = live === undefined && cached === null;

  async function move(index: number, direction: -1 | 1) {
    const next = moveItem(routines, index, direction);
    if (next === routines) {
      return;
    }
    setMoving(true);
    setOrderError(null);
    try {
      await reorder({ routineIds: next.map((routine) => routine._id as Id<"routines">) });
    } catch (caught) {
      setOrderError(readableError(caught));
    } finally {
      setMoving(false);
    }
  }

  return (
    <div className="px-5 pt-3 pb-[calc(32px+var(--page-inset))]">
      <PageHeader
        backHref="/"
        backLabel="Back to workout"
        title="Routines"
        action={
          routines.length > 1 ? (
            <button
              type="button"
              aria-pressed={reordering}
              onClick={() => setReordering((current) => !current)}
              className="min-h-11 rounded-full px-3 text-base font-semibold hover:bg-fill-2"
            >
              {reordering ? "Done" : "Reorder"}
            </button>
          ) : null
        }
      >
        <p className="mt-1.5 text-base leading-normal text-muted">Tap a name to edit it.</p>
      </PageHeader>

      <Link
        href="/routines/new"
        className="mt-5 inline-flex min-h-11 items-center rounded-full bg-inverse px-5 text-base font-semibold text-inverse-ink"
      >
        New routine
      </Link>

      {loading ? (
        <p className="mt-8 text-base text-muted">Loading routines…</p>
      ) : routines.length === 0 ? (
        <p className="mt-8 max-w-[22rem] text-base leading-normal text-muted">
          No routines yet. Create one, or save a finished workout as a routine from History.
        </p>
      ) : (
        <ul className="mt-4 flex flex-col">
          {routines.map((routine, index) => (
            <li key={routine._id} className="flex items-center justify-between gap-3 border-b border-line py-3">
              <Link href={`/routines/${routine._id}`} className="min-w-0 flex-1 hover:opacity-80">
                <span className="block truncate text-base font-semibold">{routine.name}</span>
                <span className="mt-0.5 block truncate text-sm text-muted">
                  {routine.exercises.length > 0
                    ? formatSupersetNames(routine.exercises)
                    : pluralize(routine.exerciseCount, "exercise")}
                </span>
              </Link>
              {reordering ? (
                <span className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    aria-label={`Move ${routine.name} up`}
                    disabled={moving || index === 0}
                    onClick={() => void move(index, -1)}
                    className="flex size-11 items-center justify-center rounded-full border border-line text-lg disabled:opacity-40"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${routine.name} down`}
                    disabled={moving || index === routines.length - 1}
                    onClick={() => void move(index, 1)}
                    className="flex size-11 items-center justify-center rounded-full border border-line text-lg disabled:opacity-40"
                  >
                    ↓
                  </button>
                </span>
              ) : (
                <Button disabled={begin.pending} onClick={() => void begin.startRoutine(routine._id)}>
                  Start
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {orderError || begin.error ? (
        <p role="alert" className="mt-4 text-sm text-danger">
          {orderError ?? begin.error}
        </p>
      ) : null}

      <OpenWorkoutSheet
        open={begin.promptOpen}
        onClose={begin.closePrompt}
        onContinue={begin.continueOpen}
      />
    </div>
  );
}
