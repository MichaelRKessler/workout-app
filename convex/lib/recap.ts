import { v } from "convex/values";
import { setKind } from "./measures";
import { epleyOneRepMax } from "./records";
import { countsTowardRecord, countsTowardVolume, type SetType } from "./setType";

/**
 * The end-of-workout recap: a few varied highlights, records beyond the
 * per-set PRs, and milestone badges. Everything here is judged against
 * earlier workouts only, so a past workout keeps the recap it earned.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
// 1970-01-05 was a Monday. Weeks for streaks start on Monday.
const MONDAY_EPOCH_MS = 4 * DAY_MS;

export type RecapSet = {
  sessionId: string;
  exerciseId: string;
  reps: number | null;
  weightLb: number;
  durationSec: number | null;
  distanceM: number | null;
  setType: SetType;
  loggedAt: number;
};

export type RecapSession = { _id: string; startedAt: number };

export type RecapInput = {
  sessionId: string;
  /** Completed workouts up to and including this one. */
  sessions: RecapSession[];
  /** Sets from those workouts. */
  sets: RecapSet[];
  /** Minutes east of UTC on the viewer's device, for months, weeks, and time of day. */
  utcOffsetMinutes: number;
  /** False when history was too long to read in full. Lifetime totals are skipped then. */
  complete: boolean;
};

export const comparisonValidator = v.object({
  id: v.string(),
  count: v.number(),
});

export const celebrationValidator = v.union(
  v.object({
    kind: v.literal("sessionVolume"),
    volumeLb: v.number(),
    previousLb: v.number(),
  }),
  v.object({
    kind: v.literal("exerciseVolume"),
    exerciseId: v.string(),
    volumeLb: v.number(),
    previousLb: v.number(),
  }),
  v.object({
    kind: v.literal("repsAtWeight"),
    exerciseId: v.string(),
    weightLb: v.number(),
    reps: v.number(),
    previousReps: v.number(),
  }),
  v.object({
    kind: v.literal("beatLastTime"),
    exerciseId: v.string(),
    metric: v.union(v.literal("volume"), v.literal("reps"), v.literal("sets")),
    value: v.number(),
    previous: v.number(),
  }),
);

export const highlightValidator = v.union(
  v.object({ kind: v.literal("workoutVolume"), volumeLb: v.number(), comparison: comparisonValidator }),
  v.object({
    kind: v.literal("monthVolume"),
    volumeLb: v.number(),
    workouts: v.number(),
    comparison: comparisonValidator,
  }),
  v.object({
    kind: v.literal("lifetimeVolume"),
    volumeLb: v.number(),
    comparison: comparisonValidator,
  }),
  v.object({
    kind: v.literal("strengthGain"),
    exerciseId: v.string(),
    fromLb: v.number(),
    toLb: v.number(),
    days: v.number(),
  }),
  v.object({ kind: v.literal("workoutNumber"), count: v.number() }),
  v.object({ kind: v.literal("monthWorkouts"), count: v.number() }),
  v.object({ kind: v.literal("streak"), weeks: v.number() }),
  v.object({ kind: v.literal("totalReps"), reps: v.number(), sets: v.number() }),
  v.object({
    kind: v.literal("topExercise"),
    exerciseId: v.string(),
    volumeLb: v.number(),
    share: v.number(),
  }),
  v.object({
    kind: v.literal("badgeProgress"),
    badgeId: v.string(),
    remaining: v.number(),
    unit: v.union(v.literal("lb"), v.literal("sets"), v.literal("workouts")),
  }),
);

export const badgeValidator = v.object({
  id: v.string(),
  /** Set for badges about one exercise. */
  exerciseId: v.union(v.string(), v.null()),
  earnedSessionId: v.string(),
  earnedAt: v.number(),
  /** Earned by this workout. Older badges show quietly, without a celebration. */
  isNew: v.boolean(),
});

export const recapValidator = v.object({
  celebrations: v.array(celebrationValidator),
  highlights: v.array(highlightValidator),
  badges: v.array(badgeValidator),
  /** A genuine record: something beaten that existed before, not a first attempt. */
  confetti: v.boolean(),
  /** Varies the wording on the screen. Stable for one workout. */
  seed: v.number(),
});

export type Celebration = typeof celebrationValidator.type;
export type Highlight = typeof highlightValidator.type;
export type EarnedBadge = typeof badgeValidator.type;
export type Recap = typeof recapValidator.type;

/** Things to compare weight against, lightest first. Pounds. */
export const COMPARISONS: Array<{ id: string; lb: number }> = [
  { id: "grizzly", lb: 600 },
  { id: "piano", lb: 1_000 },
  { id: "horse", lb: 1_200 },
  { id: "hippo", lb: 3_300 },
  { id: "car", lb: 4_000 },
  { id: "rhino", lb: 5_000 },
  { id: "elephant", lb: 13_000 },
  { id: "trex", lb: 15_000 },
  { id: "bus", lb: 25_000 },
  { id: "humpback", lb: 66_000 },
  { id: "blueWhale", lb: 300_000 },
  { id: "jumbo", lb: 410_000 },
  { id: "liberty", lb: 450_000 },
];

export type BadgeRule =
  | { id: string; kind: "workouts"; count: number }
  | { id: string; kind: "lifetimeVolume"; lb: number }
  | { id: string; kind: "sessionVolume"; lb: number }
  | { id: string; kind: "exerciseSets"; count: number }
  | { id: string; kind: "streak"; weeks: number }
  | { id: string; kind: "hour"; before?: number; from?: number };

export const BADGE_RULES: BadgeRule[] = [
  { id: "workouts-10", kind: "workouts", count: 10 },
  { id: "workouts-50", kind: "workouts", count: 50 },
  { id: "workouts-100", kind: "workouts", count: 100 },
  { id: "workouts-250", kind: "workouts", count: 250 },
  { id: "workouts-500", kind: "workouts", count: 500 },
  { id: "volume-100k", kind: "lifetimeVolume", lb: 100_000 },
  { id: "volume-500k", kind: "lifetimeVolume", lb: 500_000 },
  { id: "volume-1m", kind: "lifetimeVolume", lb: 1_000_000 },
  { id: "volume-5m", kind: "lifetimeVolume", lb: 5_000_000 },
  { id: "iron-elephant", kind: "sessionVolume", lb: 13_000 },
  { id: "school-bus", kind: "sessionVolume", lb: 25_000 },
  { id: "sets-100", kind: "exerciseSets", count: 100 },
  { id: "sets-500", kind: "exerciseSets", count: 500 },
  { id: "streak-4", kind: "streak", weeks: 4 },
  { id: "streak-12", kind: "streak", weeks: 12 },
  { id: "streak-26", kind: "streak", weeks: 26 },
  { id: "streak-52", kind: "streak", weeks: 52 },
  { id: "early-bird", kind: "hour", before: 6 },
  { id: "night-owl", kind: "hour", from: 22 },
];

const MAX_CELEBRATIONS = 5;
const MAX_HIGHLIGHTS = 3;

type SessionFacts = {
  id: string;
  startedAt: number;
  sets: RecapSet[];
  volumeLb: number;
  byExercise: Map<string, RecapSet[]>;
};

export function buildRecap(input: RecapInput): Recap | null {
  const sessions = orderedSessions(input);
  const index = sessions.findIndex((session) => session.id === input.sessionId);
  const current = sessions[index];
  if (index < 0 || !current) {
    return null;
  }
  const earlier = sessions.slice(0, index);
  const seed = hashSeed(input.sessionId);
  // All-time claims need all of history. A partial read could miss an older
  // best and call this workout a record when it isn't.
  const celebrations = input.complete ? findCelebrations(current, earlier) : [];
  const confetti =
    input.complete &&
    (celebrations.some((item) => item.kind !== "beatLastTime") || beatsBestLoad(current, earlier));
  const badges = input.complete ? earnBadges(sessions.slice(0, index + 1), input.utcOffsetMinutes) : [];
  const candidates = highlightCandidates(current, earlier, input, badges);
  return {
    celebrations,
    highlights: pickHighlights(candidates, seed),
    badges,
    confetti,
    seed,
  };
}

function orderedSessions(input: RecapInput): SessionFacts[] {
  const bySession = new Map<string, SessionFacts>();
  for (const session of input.sessions) {
    bySession.set(session._id, {
      id: session._id,
      startedAt: session.startedAt,
      sets: [],
      volumeLb: 0,
      byExercise: new Map(),
    });
  }
  const sets = [...input.sets].sort((left, right) => left.loggedAt - right.loggedAt);
  for (const set of sets) {
    const facts = bySession.get(set.sessionId);
    if (!facts) {
      continue;
    }
    facts.sets.push(set);
    facts.volumeLb += setVolume(set);
    const group = facts.byExercise.get(set.exerciseId);
    if (group) {
      group.push(set);
    } else {
      facts.byExercise.set(set.exerciseId, [set]);
    }
  }
  return [...bySession.values()]
    .filter((session) => session.sets.length > 0)
    .sort((left, right) =>
      left.startedAt !== right.startedAt
        ? left.startedAt - right.startedAt
        : left.id < right.id
          ? -1
          : 1,
    );
}

function setVolume(set: RecapSet): number {
  if (!countsTowardVolume(set)) {
    return 0;
  }
  const reps = set.reps ?? 0;
  return reps > 0 && set.weightLb > 0 ? reps * set.weightLb : 0;
}

function volumeOf(sets: RecapSet[]): number {
  return round(sets.reduce((sum, set) => sum + setVolume(set), 0));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function isStrengthRecordSet(set: RecapSet): boolean {
  return countsTowardRecord(set) && setKind(set) === "strength" && (set.reps ?? 0) > 0;
}

function earlierSetsFor(earlier: SessionFacts[], exerciseId: string): RecapSet[] {
  const sets: RecapSet[] = [];
  for (const session of earlier) {
    const group = session.byExercise.get(exerciseId);
    if (group) {
      sets.push(...group);
    }
  }
  return sets;
}

function findCelebrations(current: SessionFacts, earlier: SessionFacts[]): Celebration[] {
  const records: Celebration[] = [];
  const softer: Celebration[] = [];

  const earlierVolumes = earlier.map((session) => session.volumeLb).filter((volume) => volume > 0);
  if (earlierVolumes.length >= 2 && current.volumeLb > 0) {
    const best = Math.max(...earlierVolumes);
    if (current.volumeLb > best) {
      records.push({ kind: "sessionVolume", volumeLb: round(current.volumeLb), previousLb: round(best) });
    }
  }

  for (const [exerciseId, sets] of current.byExercise) {
    const previous = earlierSetsFor(earlier, exerciseId);
    if (previous.length === 0) {
      continue;
    }
    const repsRecord = repsAtWeightRecord(exerciseId, sets, previous);
    if (repsRecord) {
      records.push(repsRecord);
    }

    const volume = volumeOf(sets);
    let volumeRecord = false;
    if (volume > 0) {
      let best = 0;
      for (const session of earlier) {
        const group = session.byExercise.get(exerciseId);
        if (group) {
          best = Math.max(best, volumeOf(group));
        }
      }
      if (best > 0 && volume > best) {
        volumeRecord = true;
        records.push({ kind: "exerciseVolume", exerciseId, volumeLb: volume, previousLb: best });
      }
    }
    if (!volumeRecord) {
      const beat = beatLastTime(exerciseId, sets, earlier);
      if (beat) {
        softer.push(beat);
      }
    }
  }

  softer.sort((left, right) => gainRatio(right) - gainRatio(left));
  return [...records, ...softer].slice(0, MAX_CELEBRATIONS);
}

function gainRatio(item: Celebration): number {
  if (item.kind !== "beatLastTime" || item.previous <= 0) {
    return 0;
  }
  return item.value / item.previous;
}

/**
 * Most reps at a load. Only counts when that load was lifted before and no
 * earlier set at that load or heavier matched the reps, so a lighter day
 * after a heavy one is not a "record".
 */
function repsAtWeightRecord(
  exerciseId: string,
  sets: RecapSet[],
  previous: RecapSet[],
): Celebration | null {
  const earlier = previous.filter((set) => isStrengthRecordSet(set) && set.weightLb > 0);
  const bestHere = new Map<number, number>();
  for (const set of sets) {
    if (!isStrengthRecordSet(set) || set.weightLb <= 0) {
      continue;
    }
    bestHere.set(set.weightLb, Math.max(bestHere.get(set.weightLb) ?? 0, set.reps ?? 0));
  }
  let found: Celebration | null = null;
  for (const [weightLb, reps] of bestHere) {
    let previousAtWeight = 0;
    let matchedHeavier = false;
    for (const set of earlier) {
      const earlierReps = set.reps ?? 0;
      if (set.weightLb === weightLb) {
        previousAtWeight = Math.max(previousAtWeight, earlierReps);
      }
      if (set.weightLb >= weightLb && earlierReps >= reps) {
        matchedHeavier = true;
      }
    }
    if (previousAtWeight === 0 || matchedHeavier || reps <= previousAtWeight) {
      continue;
    }
    if (!found || (found.kind === "repsAtWeight" && weightLb > found.weightLb)) {
      found = { kind: "repsAtWeight", exerciseId, weightLb, reps, previousReps: previousAtWeight };
    }
  }
  return found;
}

/** More volume, reps, or sets than the last workout with this exercise. */
function beatLastTime(
  exerciseId: string,
  sets: RecapSet[],
  earlier: SessionFacts[],
): Celebration | null {
  let last: RecapSet[] | null = null;
  for (let index = earlier.length - 1; index >= 0; index -= 1) {
    const group = earlier[index]?.byExercise.get(exerciseId);
    if (group) {
      last = group;
      break;
    }
  }
  if (!last) {
    return null;
  }
  const volume = volumeOf(sets);
  const lastVolume = volumeOf(last);
  if (volume > 0 && lastVolume > 0) {
    return volume > lastVolume
      ? { kind: "beatLastTime", exerciseId, metric: "volume", value: volume, previous: lastVolume }
      : null;
  }
  const reps = totalReps(sets);
  const lastReps = totalReps(last);
  if (reps > 0 && lastReps > 0) {
    return reps > lastReps
      ? { kind: "beatLastTime", exerciseId, metric: "reps", value: reps, previous: lastReps }
      : null;
  }
  const count = sets.filter((set) => countsTowardVolume(set)).length;
  const lastCount = last.filter((set) => countsTowardVolume(set)).length;
  return count > lastCount && lastCount > 0
    ? { kind: "beatLastTime", exerciseId, metric: "sets", value: count, previous: lastCount }
    : null;
}

function totalReps(sets: RecapSet[]): number {
  return sets.reduce((sum, set) => sum + (countsTowardVolume(set) ? (set.reps ?? 0) : 0), 0);
}

/**
 * The per-set records already listed on the summary card count as genuine
 * when the exercise had history: a heavier load, a better estimated max, or
 * more bodyweight reps than ever before.
 */
function beatsBestLoad(current: SessionFacts, earlier: SessionFacts[]): boolean {
  for (const [exerciseId, sets] of current.byExercise) {
    const previous = earlierSetsFor(earlier, exerciseId).filter(isStrengthRecordSet);
    if (previous.length === 0) {
      continue;
    }
    const best = strengthBests(previous);
    const now = strengthBests(sets.filter(isStrengthRecordSet));
    if (best.weightLb > 0 && now.weightLb > best.weightLb) return true;
    if (best.epleyLb > 0 && now.epleyLb > best.epleyLb) return true;
    if (best.bodyweightReps > 0 && now.bodyweightReps > best.bodyweightReps) return true;
  }
  return false;
}

function strengthBests(sets: RecapSet[]) {
  let weightLb = 0;
  let epleyLb = 0;
  let bodyweightReps = 0;
  for (const set of sets) {
    const reps = set.reps ?? 0;
    if (set.weightLb <= 0) {
      bodyweightReps = Math.max(bodyweightReps, reps);
      continue;
    }
    weightLb = Math.max(weightLb, set.weightLb);
    epleyLb = Math.max(epleyLb, epleyOneRepMax(set.weightLb, reps) ?? 0);
  }
  return { weightLb, epleyLb, bodyweightReps };
}

function localParts(timestamp: number, utcOffsetMinutes: number) {
  const shifted = new Date(timestamp + utcOffsetMinutes * 60_000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    hour: shifted.getUTCHours(),
    week: Math.floor((shifted.getTime() - MONDAY_EPOCH_MS) / WEEK_MS),
  };
}

/** Consecutive weeks with a workout, ending with the week of the last workout. */
function streakThrough(weeks: Set<number>, lastWeek: number): number {
  let streak = 0;
  for (let week = lastWeek; weeks.has(week); week -= 1) {
    streak += 1;
  }
  return streak;
}

/**
 * Walks every workout in order and notes the first one that met each badge.
 * A badge is new only when this workout is the one that earned it, so badges
 * from older history appear quietly the first time anyone looks.
 */
function earnBadges(sessions: SessionFacts[], utcOffsetMinutes: number): EarnedBadge[] {
  const currentId = sessions[sessions.length - 1]?.id;
  const earned = new Map<string, EarnedBadge>();
  const weeks = new Set<number>();
  const exerciseSets = new Map<string, number>();
  let lifetime = 0;
  let workouts = 0;

  const award = (id: string, exerciseId: string | null, session: SessionFacts) => {
    const key = exerciseId ? `${id}:${exerciseId}` : id;
    if (earned.has(key)) {
      return;
    }
    earned.set(key, {
      id,
      exerciseId,
      earnedSessionId: session.id,
      earnedAt: session.startedAt,
      isNew: session.id === currentId,
    });
  };

  for (const session of sessions) {
    workouts += 1;
    lifetime += session.volumeLb;
    const local = localParts(session.startedAt, utcOffsetMinutes);
    weeks.add(local.week);
    const streak = streakThrough(weeks, local.week);
    for (const [exerciseId, sets] of session.byExercise) {
      const before = exerciseSets.get(exerciseId) ?? 0;
      exerciseSets.set(exerciseId, before + sets.filter((set) => countsTowardVolume(set)).length);
    }
    for (const rule of BADGE_RULES) {
      switch (rule.kind) {
        case "workouts":
          if (workouts >= rule.count) award(rule.id, null, session);
          break;
        case "lifetimeVolume":
          if (lifetime >= rule.lb) award(rule.id, null, session);
          break;
        case "sessionVolume":
          if (session.volumeLb >= rule.lb) award(rule.id, null, session);
          break;
        case "streak":
          if (streak >= rule.weeks) award(rule.id, null, session);
          break;
        case "hour":
          if (
            (rule.before !== undefined && local.hour < rule.before) ||
            (rule.from !== undefined && local.hour >= rule.from)
          ) {
            award(rule.id, null, session);
          }
          break;
        case "exerciseSets":
          for (const exerciseId of session.byExercise.keys()) {
            if ((exerciseSets.get(exerciseId) ?? 0) >= rule.count) {
              award(rule.id, exerciseId, session);
            }
          }
          break;
      }
    }
  }
  // Newest first, so this workout's badges lead the shelf.
  return [...earned.values()].sort((left, right) =>
    left.isNew !== right.isNew ? (left.isNew ? -1 : 1) : right.earnedAt - left.earnedAt,
  );
}

type Candidate = { highlight: Highlight; weight: number };

function highlightCandidates(
  current: SessionFacts,
  earlier: SessionFacts[],
  input: RecapInput,
  badges: EarnedBadge[],
): Candidate[] {
  const candidates: Candidate[] = [];
  const offset = input.utcOffsetMinutes;
  const local = localParts(current.startedAt, offset);
  const volume = round(current.volumeLb);

  const workoutComparison = comparisonFor(volume, hashSeed(`${current.id}:workout`));
  if (workoutComparison) {
    candidates.push({ highlight: { kind: "workoutVolume", volumeLb: volume, comparison: workoutComparison }, weight: 3 });
  }

  const monthSessions = [...earlier, current].filter((session) => {
    const parts = localParts(session.startedAt, offset);
    return parts.year === local.year && parts.month === local.month;
  });
  const monthVolume = round(monthSessions.reduce((sum, session) => sum + session.volumeLb, 0));
  const monthComparison = comparisonFor(monthVolume, hashSeed(`${current.id}:month`), true);
  if (monthComparison && monthSessions.length >= 2) {
    candidates.push({
      highlight: {
        kind: "monthVolume",
        volumeLb: monthVolume,
        workouts: monthSessions.length,
        comparison: monthComparison,
      },
      weight: 4,
    });
  }
  if (monthSessions.length >= 3) {
    candidates.push({ highlight: { kind: "monthWorkouts", count: monthSessions.length }, weight: 1 });
  }

  const workoutNumber = earlier.length + 1;
  if (input.complete && workoutNumber >= 5) {
    const round10 = workoutNumber % 10 === 0;
    candidates.push({ highlight: { kind: "workoutNumber", count: workoutNumber }, weight: round10 ? 5 : 0.5 });
  }

  if (input.complete && earlier.length >= 5) {
    const lifetime = round(earlier.reduce((sum, session) => sum + session.volumeLb, 0) + current.volumeLb);
    const comparison = comparisonFor(lifetime, hashSeed(`${current.id}:lifetime`));
    if (comparison) {
      candidates.push({ highlight: { kind: "lifetimeVolume", volumeLb: lifetime, comparison }, weight: 1.5 });
    }
  }

  const weeks = new Set([...earlier, current].map((session) => localParts(session.startedAt, offset).week));
  const streak = streakThrough(weeks, local.week);
  if (streak >= 2) {
    candidates.push({ highlight: { kind: "streak", weeks: streak }, weight: streak >= 4 ? 2.5 : 1.5 });
  }

  const gain = strengthGain(current, earlier);
  if (gain) {
    candidates.push({ highlight: gain, weight: 5 });
  }

  const reps = totalReps(current.sets);
  const workingSets = current.sets.filter((set) => countsTowardVolume(set)).length;
  if (reps >= 20) {
    candidates.push({ highlight: { kind: "totalReps", reps, sets: workingSets }, weight: 1 });
  }

  if (current.byExercise.size >= 2 && volume > 0) {
    let topId: string | null = null;
    let topVolume = 0;
    for (const [exerciseId, sets] of current.byExercise) {
      const exerciseVolume = volumeOf(sets);
      if (exerciseVolume > topVolume) {
        topVolume = exerciseVolume;
        topId = exerciseId;
      }
    }
    if (topId && topVolume > 0) {
      candidates.push({
        highlight: { kind: "topExercise", exerciseId: topId, volumeLb: topVolume, share: topVolume / volume },
        weight: 1,
      });
    }
  }

  const progress = nextBadgeProgress(current, earlier, input, badges);
  if (progress) {
    candidates.push({ highlight: progress, weight: 3 });
  }
  return candidates;
}

/**
 * Best estimated max now against the best from three weeks to three months
 * ago. Picks the exercise with the largest relative gain.
 */
function strengthGain(current: SessionFacts, earlier: SessionFacts[]): Highlight | null {
  let best: { highlight: Highlight; ratio: number } | null = null;
  for (const [exerciseId, sets] of current.byExercise) {
    const now = strengthBests(sets.filter(isStrengthRecordSet)).epleyLb;
    if (now <= 0) {
      continue;
    }
    for (const session of earlier) {
      const days = Math.round((current.startedAt - session.startedAt) / DAY_MS);
      if (days < 21 || days > 92) {
        continue;
      }
      const group = session.byExercise.get(exerciseId);
      if (!group) {
        continue;
      }
      const then = strengthBests(group.filter(isStrengthRecordSet)).epleyLb;
      const ratio = then > 0 ? now / then : 0;
      if (ratio >= 1.025 && (!best || ratio > best.ratio)) {
        best = {
          ratio,
          highlight: { kind: "strengthGain", exerciseId, fromLb: then, toLb: now, days },
        };
      }
      // Oldest qualifying workout only: earlier sessions are sorted oldest first.
      break;
    }
  }
  return best?.highlight ?? null;
}

/** The closest unearned badge, when it is within reach. */
function nextBadgeProgress(
  current: SessionFacts,
  earlier: SessionFacts[],
  input: RecapInput,
  badges: EarnedBadge[],
): Highlight | null {
  if (!input.complete) {
    return null;
  }
  const have = new Set(badges.map((badge) => (badge.exerciseId ? `${badge.id}:${badge.exerciseId}` : badge.id)));
  const all = [...earlier, current];
  const lifetime = all.reduce((sum, session) => sum + session.volumeLb, 0);
  const options: Array<{ highlight: Highlight; closeness: number }> = [];
  for (const rule of BADGE_RULES) {
    if (rule.kind === "lifetimeVolume" && !have.has(rule.id)) {
      const remaining = Math.ceil(rule.lb - lifetime);
      if (remaining > 0 && remaining <= rule.lb * 0.15) {
        options.push({
          highlight: { kind: "badgeProgress", badgeId: rule.id, remaining, unit: "lb" },
          closeness: 1 - remaining / rule.lb,
        });
      }
    }
    if (rule.kind === "workouts" && !have.has(rule.id)) {
      const remaining = rule.count - all.length;
      if (remaining > 0 && remaining <= Math.max(3, rule.count * 0.1)) {
        options.push({
          highlight: { kind: "badgeProgress", badgeId: rule.id, remaining, unit: "workouts" },
          closeness: 1 - remaining / rule.count,
        });
      }
    }
    if (rule.kind === "exerciseSets") {
      for (const exerciseId of current.byExercise.keys()) {
        if (have.has(`${rule.id}:${exerciseId}`)) {
          continue;
        }
        let count = 0;
        for (const session of all) {
          count += (session.byExercise.get(exerciseId) ?? []).filter((set) => countsTowardVolume(set)).length;
        }
        const remaining = rule.count - count;
        if (remaining > 0 && remaining <= rule.count * 0.1) {
          options.push({
            highlight: { kind: "badgeProgress", badgeId: `${rule.id}:${exerciseId}`, remaining, unit: "sets" },
            closeness: 1 - remaining / rule.count,
          });
        }
      }
    }
  }
  options.sort((left, right) => right.closeness - left.closeness);
  return options[0]?.highlight ?? null;
}

/**
 * A comparison that reads naturally: at least one of the thing and no more
 * than about twenty. Elephants get first pick for the month when they fit.
 */
export function comparisonFor(
  volumeLb: number,
  seed: number,
  preferElephant = false,
): { id: string; count: number } | null {
  const fitting = COMPARISONS.filter((item) => {
    const count = volumeLb / item.lb;
    return count >= 1 && count <= 20;
  });
  if (fitting.length === 0) {
    return null;
  }
  const elephant = fitting.find((item) => item.id === "elephant");
  const choice =
    preferElephant && elephant && seed % 2 === 0
      ? elephant
      : fitting[seed % fitting.length];
  if (!choice) {
    return null;
  }
  return { id: choice.id, count: Math.round((volumeLb / choice.lb) * 10) / 10 };
}

/** Weighted picks without repeats, so recaps vary from one workout to the next. */
function pickHighlights(candidates: Candidate[], seed: number): Highlight[] {
  const pool = [...candidates];
  const picked: Highlight[] = [];
  let state = seed || 1;
  while (pool.length > 0 && picked.length < MAX_HIGHLIGHTS) {
    state = nextRandom(state);
    const total = pool.reduce((sum, item) => sum + item.weight, 0);
    let target = (state / 0x7fffffff) * total;
    let chosen = pool.length - 1;
    for (let index = 0; index < pool.length; index += 1) {
      target -= pool[index]?.weight ?? 0;
      if (target <= 0) {
        chosen = index;
        break;
      }
    }
    const [item] = pool.splice(chosen, 1);
    if (!item) {
      break;
    }
    picked.push(item.highlight);
    // Two volume comparisons in one recap read as the same fact twice.
    if (item.highlight.kind === "workoutVolume" || item.highlight.kind === "monthVolume" || item.highlight.kind === "lifetimeVolume") {
      for (let index = pool.length - 1; index >= 0; index -= 1) {
        const kind = pool[index]?.highlight.kind;
        if (kind === "workoutVolume" || kind === "monthVolume" || kind === "lifetimeVolume") {
          const other = pool[index]?.highlight;
          const same =
            other &&
            "comparison" in other &&
            "comparison" in item.highlight &&
            other.comparison.id === item.highlight.comparison.id;
          if (same) {
            pool.splice(index, 1);
          }
        }
      }
    }
  }
  return picked;
}

function nextRandom(state: number): number {
  return (state * 48271) % 0x7fffffff;
}

export function hashSeed(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 0x7fffffff || 1;
}
