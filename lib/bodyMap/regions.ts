import { MUSCLE_GROUPS, type MuscleGroup } from "@/convex/lib/muscleGroup";

/** Every shape the body outline has, muscles and the rest of the silhouette. */
export type BodyRegion =
  | "chest"
  | "abs"
  | "obliques"
  | "serratus"
  | "deltoids"
  | "trapezius"
  | "upperBack"
  | "lowerBack"
  | "biceps"
  | "triceps"
  | "forearm"
  | "quadriceps"
  | "hipFlexors"
  | "adductors"
  | "hamstrings"
  | "glutes"
  | "calves"
  | "tibialis"
  | "head"
  | "hands"
  | "feet"
  | "knees";

/**
 * The muscle group each region shades with. Regions with no group (forearms,
 * calves, shins, inner thigh, hip flexors) are drawn as plain silhouette,
 * because no exercise can be filed under them.
 */
export const REGION_GROUP: Partial<Record<BodyRegion, MuscleGroup>> = {
  chest: "chest",
  abs: "core",
  obliques: "core",
  serratus: "core",
  deltoids: "shoulders",
  trapezius: "back",
  upperBack: "back",
  lowerBack: "back",
  biceps: "biceps",
  triceps: "triceps",
  quadriceps: "quads",
  hamstrings: "hamstrings",
  glutes: "glutes",
};

/** Groups the map can show, in the same order as the weekly summary. */
export const DRAWN_GROUPS: readonly MuscleGroup[] = MUSCLE_GROUPS.filter((group) =>
  Object.values(REGION_GROUP).includes(group),
);

export type MuscleLevel = 0 | 1 | 2 | 3 | 4;

/**
 * Shade step per group, relative to the most-trained group this week, so the
 * map reads as balance rather than as an absolute target. Any trained group is
 * at least step 1, so one set still shows.
 */
export function muscleLevels(
  muscles: ReadonlyArray<{ group: MuscleGroup; sets: number }>,
): Map<MuscleGroup, MuscleLevel> {
  const sets = new Map<MuscleGroup, number>();
  for (const item of muscles) {
    if (item.sets > 0 && DRAWN_GROUPS.includes(item.group)) {
      sets.set(item.group, (sets.get(item.group) ?? 0) + item.sets);
    }
  }
  const max = Math.max(0, ...sets.values());
  const levels = new Map<MuscleGroup, MuscleLevel>();
  for (const group of DRAWN_GROUPS) {
    const count = sets.get(group) ?? 0;
    levels.set(
      group,
      count <= 0 || max <= 0 ? 0 : (Math.max(1, Math.min(4, Math.ceil((count / max) * 4))) as MuscleLevel),
    );
  }
  return levels;
}

/** Drawable groups with no working sets, in summary order. */
export function untrainedGroups(
  muscles: ReadonlyArray<{ group: MuscleGroup; sets: number }>,
): MuscleGroup[] {
  const trained = new Set(muscles.filter((item) => item.sets > 0).map((item) => item.group));
  return DRAWN_GROUPS.filter((group) => !trained.has(group));
}
