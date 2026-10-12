import type { RoutinePrefill } from "../convex/lib/routinePlan";
import type { WeightUnit } from "../convex/lib/units";
import { describeSet, formatSetShort } from "./format";
import { prefillValues, setFromPrefill, type PrefillValues } from "./prefill";

type SetNumbers = {
  reps?: number | null;
  weightLb: number;
  durationSec?: number | null;
  distanceM?: number | null;
  calories?: number | null;
  rpe?: number | null;
  setType?: PrefillValues["setType"] | null;
};

export type LoggedPlanSet = NonNullable<ReturnType<typeof setFromPrefill>>;

export type PlanLogAction = {
  set: LoggedPlanSet;
  /** Visible button text, such as "Log 5 × 225". */
  label: string;
};

export type PlanLogOffer = {
  /**
   * What the main button saves. Null when there is no target and no history:
   * the button should open the form instead of logging 10 at 0.
   */
  primary: PlanLogAction | null;
  /** A different previous set, shown beside a routine-target button. */
  lastTime: PlanLogAction | null;
};

/**
 * The first set of a planned exercise. A routine target wins, so the button
 * matches the target on the row. Last time stays one tap away when it differs.
 * Later sets in the workout still repeat the set just logged.
 */
export function planLogOffer(
  exerciseName: string,
  sessionSets: Array<{ exerciseName: string } & SetNumbers>,
  previousSets: SetNumbers[] | null,
  routineTarget: RoutinePrefill | null | undefined,
  unit: WeightUnit,
): PlanLogOffer {
  const history = prefillValues(exerciseName, sessionSets, previousSets, null);
  const historySet = history.source === "default" ? null : setFromPrefill(history);
  // A target is often reps alone ("Bench 3×5"). Its weight comes from the last
  // set, not 0, or the button would offer a bodyweight set.
  const target =
    routineTarget && routineTarget.weightLb == null && historySet
      ? { ...routineTarget, weightLb: historySet.weightLb }
      : routineTarget;
  const routine = prefillValues(exerciseName, [], null, target);
  const routineSet = routine.source === "routine" ? setFromPrefill(routine) : null;

  if (routineSet) {
    const different = historySet !== null && !sameLoggedSet(historySet, routineSet);
    return {
      primary: action(routineSet, unit, "Log"),
      lastTime: different && historySet ? action(historySet, unit, "Last time:") : null,
    };
  }
  if (historySet) {
    return { primary: action(historySet, unit, "Log"), lastTime: null };
  }
  return { primary: null, lastTime: null };
}

export function sameLoggedSet(left: LoggedPlanSet, right: LoggedPlanSet): boolean {
  return (
    (left.reps ?? null) === (right.reps ?? null) &&
    left.weightLb === right.weightLb &&
    (left.durationSec ?? null) === (right.durationSec ?? null) &&
    (left.distanceM ?? null) === (right.distanceM ?? null) &&
    (left.calories ?? null) === (right.calories ?? null)
  );
}

function action(set: LoggedPlanSet, unit: WeightUnit, prefix: string): PlanLogAction {
  const compact = formatSetShort(set, unit).replaceAll("×", " × ");
  return { set, label: `${prefix} ${compact}` };
}

/** Spoken label for the main button, including the exercise name. */
export function planLogSpeech(exerciseName: string, actionLabel: string, set: LoggedPlanSet, unit: WeightUnit): string {
  return `${actionLabel} of ${exerciseName}, ${describeSet(set, unit)}`;
}
