import { v } from "convex/values";

/**
 * Main muscle for an exercise. An exercise can also list groups it works
 * (chin-ups: back, also biceps); see suggestSecondaryMuscles. Quads is the
 * "legs/quads" group: hamstrings and glutes stay separate so a squat and a hip
 * thrust do not look the same.
 * "other" is the fallback when a name is unrecognized, including calves.
 */
export const MUSCLE_GROUPS = [
  "chest",
  "back",
  "shoulders",
  "biceps",
  "triceps",
  "quads",
  "hamstrings",
  "glutes",
  "core",
  "cardio",
  "other",
] as const;

export type MuscleGroup = (typeof MUSCLE_GROUPS)[number];

export const MUSCLE_LABELS: Record<MuscleGroup, string> = {
  chest: "Chest",
  back: "Back",
  shoulders: "Shoulders",
  biceps: "Biceps",
  triceps: "Triceps",
  quads: "Quads",
  hamstrings: "Hamstrings",
  glutes: "Glutes",
  core: "Core",
  cardio: "Cardio",
  other: "Other",
};

export const muscleGroupValidator = v.union(
  v.literal("chest"),
  v.literal("back"),
  v.literal("shoulders"),
  v.literal("biceps"),
  v.literal("triceps"),
  v.literal("quads"),
  v.literal("hamstrings"),
  v.literal("glutes"),
  v.literal("core"),
  v.literal("cardio"),
  v.literal("other"),
);

export function isMuscleGroup(value: unknown): value is MuscleGroup {
  return typeof value === "string" && (MUSCLE_GROUPS as readonly string[]).includes(value);
}

type Check = {
  group: MuscleGroup;
  test: (name: string) => boolean;
};

function has(name: string, pattern: RegExp): boolean {
  return pattern.test(name);
}

/**
 * First match wins. Specific names (leg curl, upright row, close-grip bench)
 * are listed before the broader word they contain.
 */
const CHECKS: Check[] = [
  {
    group: "other",
    test: (name) => has(name, /\b(calves?|calf|forearms?|wrists?)\b/),
  },
  {
    group: "hamstrings",
    test: (name) =>
      has(
        name,
        /\b(hamstrings?|romanian|rdls?|stiff[- ]legs?|stiff[- ]legged|leg curls?|nordic curls?|good mornings?)\b/,
      ),
  },
  {
    group: "glutes",
    test: (name) =>
      has(
        name,
        /\b(glutes?|hip thrusts?|glute bridges?|hip bridges?|sumo deadlifts?|glute kickbacks?|donkey kicks?|hip abductions?|abductors?)\b/,
      ),
  },
  {
    group: "quads",
    test: (name) =>
      has(
        name,
        /\b(squats?|lunges?|leg press(?:es)?|leg extensions?|quads?|quadriceps|hack squats?|goblet|bulgarians?|split squats?|step[- ]?ups?|box jumps?|pistol squats?|sissy squats?)\b/,
      ),
  },
  {
    group: "triceps",
    test: (name) =>
      has(
        name,
        /\b(triceps?|skull ?crushers?|push[- ]?downs?|pushdowns?|close[- ]grips?|jm presses?|tricep extensions?|overhead extensions?|tricep kickbacks?)\b/,
      ),
  },
  {
    group: "biceps",
    test: (name) => has(name, /\b(biceps?|curls?|preacher)\b/),
  },
  {
    group: "shoulders",
    test: (name) =>
      has(
        name,
        /\b(shoulders?|overhead press(?:es)?|ohp|military press(?:es)?|lateral raises?|front raises?|rear delts?|face pulls?|arnold press(?:es)?|upright rows?|shrugs?|delts?|side raises?|push press(?:es)?|reverse flye?s?|reverse flies)\b/,
      ),
  },
  {
    group: "chest",
    test: (name) =>
      has(name, /\b(bench(?: press(?:es)?)?|chests?|pecs?|flye?s?|flies|push[- ]?ups?|press[- ]?ups?|dips?)\b/) ||
      (has(name, /\bincline\b/) && has(name, /\b(press|fly|flye|flies)\b/)),
  },
  {
    group: "back",
    test: (name) =>
      has(
        name,
        /\b(deadlifts?|rows?|pull[- ]?ups?|chin[- ]?ups?|muscle[- ]?ups?|lats?|pulldowns?|pull[- ]?downs?|pullovers?|back|hyperextensions?)\b/,
      ),
  },
  {
    group: "core",
    test: (name) =>
      has(
        name,
        /\b(planks?|crunches?|sit[- ]?ups?|abs?|cores?|leg raises?|knee raises?|hollow(?: holds?)?|dead bugs?|pallof|wood ?chops?|russian twists?|ab wheels?|rollouts?|toes to bar|v[- ]?ups?)\b/,
      ),
  },
  {
    group: "cardio",
    test: (name) =>
      has(
        name,
        /\b(runs?|running|jogs?|jogging|sprints?|cycling|cycles?|bikes?|biking|bicycles?|rowing|ergs?|ellipticals?|stair ?masters?|stair ?climbers?|jump ropes?|jumping jacks?|burpees?|cardio|hiit|walks?|walking|hikes?|hiking|swims?|swimming|treadmills?|mountain climbers?)\b/,
      ),
  },
];

/** Best guess from a common exercise name. Unknown names are "other". */
export function suggestMuscleGroup(name: string): MuscleGroup {
  const normalized = name.trim().toLowerCase().replace(/[_/]+/g, " ").replace(/\s+/g, " ");
  for (const check of CHECKS) {
    if (check.test(normalized)) {
      return check.group;
    }
  }
  return "other";
}

type AlsoCheck = {
  groups: MuscleGroup[];
  test: (name: string) => boolean;
};

/**
 * Groups a compound lift also works, beyond its main group. Every matching
 * check adds its groups, so a "pull-up" and a "deadlift row" both pick up
 * what they share. Isolation lifts match nothing.
 */
const ALSO_CHECKS: AlsoCheck[] = [
  {
    groups: ["biceps"],
    test: (name) =>
      has(name, /\b(pull[- ]?ups?|chin[- ]?ups?|muscle[- ]?ups?|pulldowns?|pull[- ]?downs?)\b/) ||
      (has(name, /\brows?\b/) && !has(name, /\bupright rows?\b/) && !has(name, /\browing\b/)),
  },
  {
    groups: ["triceps", "shoulders"],
    test: (name) =>
      has(name, /\b(bench(?: press(?:es)?)?|push[- ]?ups?|press[- ]?ups?|chest press(?:es)?)\b/) ||
      (has(name, /\bincline\b/) && has(name, /\bpress\b/)),
  },
  {
    groups: ["triceps"],
    test: (name) =>
      has(name, /\b(dips?|overhead press(?:es)?|ohp|military press(?:es)?|push press(?:es)?|arnold press(?:es)?|shoulder press(?:es)?)\b/),
  },
  {
    groups: ["chest"],
    test: (name) => has(name, /\b(close[- ]grips?|tricep dips?)\b/),
  },
  {
    groups: ["glutes"],
    test: (name) =>
      has(
        name,
        /\b(squats?|lunges?|leg press(?:es)?|split squats?|bulgarians?|step[- ]?ups?|deadlifts?|rdls?|romanian|good mornings?)\b/,
      ),
  },
  {
    groups: ["hamstrings"],
    test: (name) => has(name, /\b(deadlifts?|hip thrusts?|good mornings?)\b/),
  },
];

/** Most groups one exercise can list beyond its main one. */
export const MAX_SECONDARY_MUSCLES = 4;

/**
 * Best guess at what else a common lift works, never the main group, "other"
 * or "cardio". Chin-ups are back first and also biceps.
 */
export function suggestSecondaryMuscles(name: string, primary: MuscleGroup): MuscleGroup[] {
  const normalized = name.trim().toLowerCase().replace(/[_/]+/g, " ").replace(/\s+/g, " ");
  const found = new Set<MuscleGroup>();
  for (const check of ALSO_CHECKS) {
    if (check.test(normalized)) {
      for (const group of check.groups) {
        found.add(group);
      }
    }
  }
  return cleanSecondaryMuscles([...found], primary);
}

/**
 * Valid, distinct groups in summary order, without the main group or the
 * catch-alls, and at most MAX_SECONDARY_MUSCLES of them.
 */
export function cleanSecondaryMuscles(groups: readonly unknown[], primary: MuscleGroup): MuscleGroup[] {
  const wanted = new Set(groups.filter(isMuscleGroup));
  return MUSCLE_GROUPS.filter(
    (group) => wanted.has(group) && group !== primary && group !== "other" && group !== "cardio",
  ).slice(0, MAX_SECONDARY_MUSCLES);
}

/** A saved group wins. A missing one is suggested from the name. */
export function resolveMuscleGroup(stored: unknown, name: string): MuscleGroup {
  return isMuscleGroup(stored) ? stored : suggestMuscleGroup(name);
}

type MuscleFields = {
  name: string;
  muscleGroup?: MuscleGroup | null;
  secondaryMuscles?: readonly MuscleGroup[] | null;
};

/**
 * Groups an exercise also works. A saved list wins, even an empty one; a
 * missing list is suggested from the name. Never includes the main group.
 */
export function resolveSecondaryMuscles(exercise: MuscleFields): MuscleGroup[] {
  const primary = resolveMuscleGroup(exercise.muscleGroup, exercise.name);
  return Array.isArray(exercise.secondaryMuscles)
    ? cleanSecondaryMuscles(exercise.secondaryMuscles, primary)
    : suggestSecondaryMuscles(exercise.name, primary);
}

export function presentMuscle(exercise: MuscleFields): {
  muscleGroup: MuscleGroup;
  muscleSource: "saved" | "suggested";
  secondaryMuscles: MuscleGroup[];
  secondarySource: "saved" | "suggested";
} {
  return {
    muscleGroup: resolveMuscleGroup(exercise.muscleGroup, exercise.name),
    muscleSource: isMuscleGroup(exercise.muscleGroup) ? "saved" : "suggested",
    secondaryMuscles: resolveSecondaryMuscles(exercise),
    secondarySource: Array.isArray(exercise.secondaryMuscles) ? "saved" : "suggested",
  };
}

/** True when the exercise is filed under the group, as main or also works. */
export function worksMuscle(exercise: MuscleFields, group: MuscleGroup): boolean {
  return (
    resolveMuscleGroup(exercise.muscleGroup, exercise.name) === group ||
    resolveSecondaryMuscles(exercise).includes(group)
  );
}

/** Share of a set an "also works" group gets in the weekly muscle counts. */
export const SECONDARY_SET_SHARE = 0.5;

/**
 * Adds one exercise's working sets to the weekly muscle counts: full sets to
 * the main group, half sets to each group it also works.
 */
export function addMuscleSets(
  counts: Map<MuscleGroup, number>,
  exercise: MuscleFields,
  sets: number,
): void {
  const primary = resolveMuscleGroup(exercise.muscleGroup, exercise.name);
  counts.set(primary, (counts.get(primary) ?? 0) + sets);
  for (const group of resolveSecondaryMuscles(exercise)) {
    counts.set(group, (counts.get(group) ?? 0) + sets * SECONDARY_SET_SHARE);
  }
}

/**
 * Group to copy onto the exercise that survives a merge.
 * The survivor's explicit choice stays. An explicit group from the exercise
 * being removed is copied only when it agrees with the survivor's name, or
 * the survivor's name has no specific suggestion.
 */
export function muscleGroupToCopy(
  into: { name: string; muscleGroup?: MuscleGroup | null },
  from: { muscleGroup?: MuscleGroup | null },
): MuscleGroup | null {
  if (isMuscleGroup(into.muscleGroup) || !isMuscleGroup(from.muscleGroup)) {
    return null;
  }
  const suggested = suggestMuscleGroup(into.name);
  if (suggested === "other" || suggested === from.muscleGroup) {
    return from.muscleGroup;
  }
  return null;
}

/**
 * Saved "also works" list to copy onto the exercise that survives a merge.
 * Copied only when the survivor has none saved and both end up with the same
 * main group, so the list still makes sense.
 */
export function secondaryMusclesToCopy(
  into: MuscleFields,
  from: MuscleFields,
): MuscleGroup[] | null {
  if (Array.isArray(into.secondaryMuscles) || !Array.isArray(from.secondaryMuscles)) {
    return null;
  }
  const primary = resolveMuscleGroup(into.muscleGroup, into.name);
  if (resolveMuscleGroup(from.muscleGroup, from.name) !== primary) {
    return null;
  }
  return cleanSecondaryMuscles(from.secondaryMuscles, primary);
}

/** "Chest 12 · Back 6 · Quads 9". Empty when every count is zero. */
export function formatMuscleSummary(
  muscles: ReadonlyArray<{ group: MuscleGroup; sets: number }>,
): string {
  return muscles
    .filter((item) => item.sets > 0 && isMuscleGroup(item.group))
    .map((item) => `${MUSCLE_LABELS[item.group]} ${item.sets}`)
    .join(" · ");
}

/** Non-zero counts in the display order used by the weekly summary. */
export function muscleCounts(
  counts: ReadonlyMap<MuscleGroup, number>,
): Array<{ group: MuscleGroup; sets: number }> {
  return MUSCLE_GROUPS.flatMap((group) => {
    const sets = counts.get(group) ?? 0;
    return sets > 0 ? [{ group, sets }] : [];
  });
}
