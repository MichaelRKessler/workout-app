import { v } from "convex/values";

/**
 * Primary muscle for an exercise. Quads is the "legs/quads" group: hamstrings
 * and glutes stay separate so a squat and a hip thrust do not look the same.
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

/** A saved group wins. A missing one is suggested from the name. */
export function resolveMuscleGroup(stored: unknown, name: string): MuscleGroup {
  return isMuscleGroup(stored) ? stored : suggestMuscleGroup(name);
}

export function presentMuscle(exercise: { name: string; muscleGroup?: MuscleGroup | null }): {
  muscleGroup: MuscleGroup;
  muscleSource: "saved" | "suggested";
} {
  if (isMuscleGroup(exercise.muscleGroup)) {
    return { muscleGroup: exercise.muscleGroup, muscleSource: "saved" };
  }
  return { muscleGroup: suggestMuscleGroup(exercise.name), muscleSource: "suggested" };
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
