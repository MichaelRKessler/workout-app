import { planProgress } from "../convex/lib/routinePlan";
import { supersetBlocks, supersetNextId } from "../convex/lib/superset";
import { pluralize } from "./format";
import type { SetLine } from "./groupSets";

export type VisiblePlanItem = {
  exerciseId: string;
  name: string;
  targetSets: number | null;
  targetReps: number | null;
  targetWeightLb: number | null;
  targetDurationSec: number | null;
  targetDistanceM: number | null;
  targetCalories?: number | null;
  skipped: boolean;
  /** Shared by adjacent exercises. Null when the exercise stands alone. */
  supersetId: string | null;
};

/** Plan order first. Exercises logged outside the plan stay after it. */
export function splitWorkoutPlan<
  T extends { exerciseId: string; name: string; sets: readonly SetLine[] },
>(
  plan: VisiblePlanItem[],
  groups: readonly T[],
): { rows: Array<VisiblePlanItem & { sets: SetLine[] }>; extras: T[] } {
  const byId = new Map(groups.map((group) => [group.exerciseId, group]));
  const planned = new Set(plan.map((item) => item.exerciseId));
  return {
    rows: plan.map((item) => {
      const group = byId.get(item.exerciseId);
      const sets = group ? [...group.sets] : [];
      return {
        ...item,
        name: group?.name ?? item.name,
        sets,
      };
    }),
    extras: groups.filter((group) => !planned.has(group.exerciseId)),
  };
}

/**
 * Where a planned workout stands, for the guided view's header. An exercise
 * without a set target counts as one set until more are logged. Skipped
 * exercises leave both totals. `position` is the 1-based place of `nextId`
 * among the exercises still on the plan, or null when nothing is next.
 */
export function guidedProgress(
  rows: ReadonlyArray<{ exerciseId: string; skipped: boolean; targetSets: number | null; sets: readonly unknown[] }>,
  nextId: string | null,
): { position: number | null; exercises: number; setsDone: number; setsPlanned: number } {
  const active = rows.filter((row) => !row.skipped);
  let setsDone = 0;
  let setsPlanned = 0;
  for (const row of active) {
    const target = row.targetSets != null && row.targetSets >= 1 ? row.targetSets : Math.max(1, row.sets.length);
    setsPlanned += target;
    setsDone += Math.min(row.sets.length, target);
  }
  const index = nextId === null ? -1 : active.findIndex((row) => row.exerciseId === nextId);
  return {
    position: index < 0 ? null : index + 1,
    exercises: active.length,
    setsDone,
    setsPlanned,
  };
}

/**
 * The exercise the guided view puts in front of you: the first one in plan
 * order that still has sets to do. Inside a superset it follows the same
 * rotation as the list's Next tag. Null once every planned set is done.
 */
export function guidedNextId(
  rows: ReadonlyArray<{
    exerciseId: string;
    skipped: boolean;
    targetSets: number | null;
    sets: readonly unknown[];
    supersetId: string | null;
  }>,
): string | null {
  for (const block of supersetBlocks([...rows])) {
    if (block.supersetId) {
      const next = supersetNextId(
        block.items.map((row) => ({
          exerciseId: row.exerciseId,
          skipped: row.skipped,
          setCount: row.sets.length,
          targetSets: row.targetSets,
          supersetId: row.supersetId,
        })),
      );
      if (next) {
        return next;
      }
      // Without set targets the rotation has no "behind" member once counts
      // match, so start with any member that has no sets yet.
      const open = block.items.find(
        (row) => !planProgress(row.sets.length, row.targetSets, row.skipped).done,
      );
      if (open) {
        return open.exerciseId;
      }
      continue;
    }
    for (const row of block.items) {
      if (!planProgress(row.sets.length, row.targetSets, row.skipped).done) {
        return row.exerciseId;
      }
    }
  }
  return null;
}

/** "3 planned exercises not started · 9 planned sets left", or null when the plan is done. */
export function planLeftNote(
  rows: ReadonlyArray<{ sets: readonly unknown[]; targetSets?: number | null; skipped?: boolean }> | undefined,
): string | null {
  if (!rows) {
    return null;
  }
  let notStarted = 0;
  let setsLeft = 0;
  for (const row of rows) {
    if (row.skipped) {
      continue;
    }
    if (row.sets.length === 0) {
      notStarted += 1;
    }
    setsLeft += Math.max((row.targetSets ?? 1) - row.sets.length, 0);
  }
  if (setsLeft === 0) {
    return null;
  }
  const parts = [];
  if (notStarted > 0) {
    parts.push(`${pluralize(notStarted, "planned exercise")} not started`);
  }
  parts.push(`${pluralize(setsLeft, "planned set")} left`);
  return parts.join(" · ");
}
