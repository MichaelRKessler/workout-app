import { v } from "convex/values";

/** Epley estimate: weight × (1 + reps / 30). Bodyweight has no estimate. */
export function epleyOneRepMax(weightLb: number, reps: number): number | null {
  if (!(weightLb > 0) || !Number.isFinite(weightLb) || !Number.isFinite(reps) || reps < 1) {
    return null;
  }
  return Math.round(weightLb * (1 + reps / 30) * 100) / 100;
}

export const personalRecordValidator = v.object({
  exerciseName: v.string(),
  kind: v.union(
    v.literal("weight"),
    v.literal("epley"),
    v.literal("both"),
    v.literal("reps"),
  ),
  reps: v.number(),
  weightLb: v.number(),
  epleyLb: v.union(v.number(), v.null()),
});

export type PersonalRecord = {
  exerciseName: string;
  kind: "weight" | "epley" | "both" | "reps";
  reps: number;
  weightLb: number;
  epleyLb: number | null;
};

type SetPoint = { reps: number; weightLb: number };

/**
 * A set is a PR when it beats this exercise's previous best.
 * Weighted sets can beat the heaviest load, the best Epley estimate, or both.
 * Bodyweight sets (0 lb) can beat the most reps. The first set of either kind counts.
 * Ties do not.
 */
export function personalRecordForSet(
  exerciseName: string,
  set: SetPoint,
  previous: SetPoint[],
): PersonalRecord | null {
  if (set.weightLb <= 0) {
    let bestReps = 0;
    for (const earlier of previous) {
      if (earlier.weightLb <= 0 && earlier.reps > bestReps) {
        bestReps = earlier.reps;
      }
    }
    if (set.reps <= bestReps) {
      return null;
    }
    return {
      exerciseName,
      kind: "reps",
      reps: set.reps,
      weightLb: 0,
      epleyLb: null,
    };
  }

  let bestWeight = 0;
  let bestEpley = 0;
  for (const earlier of previous) {
    if (earlier.weightLb > bestWeight) {
      bestWeight = earlier.weightLb;
    }
    const earlierEpley = epleyOneRepMax(earlier.weightLb, earlier.reps);
    if (earlierEpley !== null && earlierEpley > bestEpley) {
      bestEpley = earlierEpley;
    }
  }

  const epleyLb = epleyOneRepMax(set.weightLb, set.reps);
  const beatWeight = set.weightLb > bestWeight;
  const beatEpley = epleyLb !== null && epleyLb > bestEpley;
  if (!beatWeight && !beatEpley) {
    return null;
  }
  return {
    exerciseName,
    kind: beatWeight && beatEpley ? "both" : beatWeight ? "weight" : "epley",
    reps: set.reps,
    weightLb: set.weightLb,
    epleyLb,
  };
}

/** The last new record in a batch, judged in the order the sets were logged. */
export function personalRecordForBatch(
  exerciseName: string,
  created: SetPoint[],
  previous: SetPoint[],
): PersonalRecord | null {
  const baseline = previous.map((set) => ({ reps: set.reps, weightLb: set.weightLb }));
  let latest: PersonalRecord | null = null;
  for (const set of created) {
    const record = personalRecordForSet(exerciseName, set, baseline);
    if (record) {
      latest = record;
    }
    baseline.push({ reps: set.reps, weightLb: set.weightLb });
  }
  return latest;
}

export type Effort = {
  setId: string;
  sessionId: string;
  reps: number;
  weightLb: number;
  epleyLb: number | null;
  loggedAt: number;
};

type EffortSet = {
  _id: string;
  sessionId: string;
  reps: number;
  weightLb: number;
  loggedAt: number;
};

function toEffort(set: EffortSet, epleyLb: number | null): Effort {
  return {
    setId: set._id,
    sessionId: set.sessionId,
    reps: set.reps,
    weightLb: set.weightLb,
    epleyLb,
    loggedAt: set.loggedAt,
  };
}

/**
 * Best efforts in a set list. Equal results keep the earlier one, except the
 * heaviest weight prefers more reps before it prefers the earlier set.
 */
export function summarizeEfforts(sets: EffortSet[]): {
  bestWeight: Effort | null;
  bestEpley: Effort | null;
  bestBodyweight: Effort | null;
} {
  let bestWeight: Effort | null = null;
  let bestEpley: Effort | null = null;
  let bestBodyweight: Effort | null = null;

  for (const set of sets) {
    if (set.weightLb <= 0) {
      const betterReps = bestBodyweight === null || set.reps > bestBodyweight.reps;
      const earlierTie =
        bestBodyweight !== null &&
        set.reps === bestBodyweight.reps &&
        set.loggedAt < bestBodyweight.loggedAt;
      if (betterReps || earlierTie) {
        bestBodyweight = toEffort(set, null);
      }
      continue;
    }

    const epleyLb = epleyOneRepMax(set.weightLb, set.reps);
    const effort = toEffort(set, epleyLb);
    if (bestWeight === null || set.weightLb > bestWeight.weightLb) {
      bestWeight = effort;
    } else if (set.weightLb === bestWeight.weightLb && set.reps > bestWeight.reps) {
      bestWeight = effort;
    } else if (
      set.weightLb === bestWeight.weightLb &&
      set.reps === bestWeight.reps &&
      set.loggedAt < bestWeight.loggedAt
    ) {
      bestWeight = effort;
    }

    if (epleyLb === null) {
      continue;
    }
    if (bestEpley === null || bestEpley.epleyLb === null || epleyLb > bestEpley.epleyLb) {
      bestEpley = effort;
    } else if (epleyLb === bestEpley.epleyLb && set.loggedAt < bestEpley.loggedAt) {
      bestEpley = effort;
    }
  }

  return { bestWeight, bestEpley, bestBodyweight };
}

export type TrendPoint = {
  sessionId: string;
  startedAt: number;
  value: number;
};

/**
 * One point per workout, oldest first. Weighted exercises chart the best Epley
 * estimate in that workout. An exercise that has never used weight charts the
 * most reps instead.
 */
export function trendFromSets(
  sets: Array<EffortSet & { sessionStartedAt: number }>,
  maxPoints: number,
): { unit: "lb" | "reps"; points: TrendPoint[] } {
  const weighted = sets.some((set) => set.weightLb > 0);
  const bySession = new Map<string, TrendPoint>();
  for (const set of sets) {
    const value = weighted ? epleyOneRepMax(set.weightLb, set.reps) : set.reps;
    if (value === null) {
      continue;
    }
    const existing = bySession.get(set.sessionId);
    if (!existing) {
      bySession.set(set.sessionId, {
        sessionId: set.sessionId,
        startedAt: set.sessionStartedAt,
        value,
      });
      continue;
    }
    if (value > existing.value) {
      existing.value = value;
    }
  }
  const points = [...bySession.values()].sort((left, right) => {
    if (left.startedAt !== right.startedAt) {
      return left.startedAt - right.startedAt;
    }
    return left.sessionId < right.sessionId ? -1 : 1;
  });
  return {
    unit: weighted ? "lb" : "reps",
    points: points.slice(-maxPoints),
  };
}

/** Reps × weight. Bodyweight sets (0 lb) add nothing. */
export function volumeLb(sets: Array<{ reps: number; weightLb: number }>): number {
  let total = 0;
  for (const set of sets) {
    if (set.weightLb > 0) {
      total += set.reps * set.weightLb;
    }
  }
  return Math.round(total * 100) / 100;
}
