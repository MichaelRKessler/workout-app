import type { SetLine } from "./groupSets";

export type VisiblePlanItem = {
  exerciseId: string;
  name: string;
  targetSets: number | null;
  targetReps: number | null;
  targetWeightLb: number | null;
  targetDurationSec: number | null;
  targetDistanceM: number | null;
  skipped: boolean;
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
