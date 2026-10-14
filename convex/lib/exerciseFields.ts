import type { Doc } from "../_generated/dataModel";
import type { MuscleGroup } from "./muscleGroup";

type ExerciseDoc = Pick<
  Doc<"exercises">,
  "userId" | "name" | "normalizedName" | "createdAt" | "restSeconds" | "muscleGroup" | "demoId"
>;

/**
 * Full exercise document for a replace. Null clears an optional field.
 * An omitted patch key keeps the stored value, so rest, muscle and demo
 * survive each other's edits.
 */
export function exerciseRecord(
  exercise: ExerciseDoc,
  patch: {
    name?: string;
    normalizedName?: string;
    restSeconds?: number | null;
    muscleGroup?: MuscleGroup | null;
    demoId?: string | null;
  },
) {
  const restSeconds =
    patch.restSeconds === undefined
      ? exercise.restSeconds
      : patch.restSeconds === null
        ? undefined
        : patch.restSeconds;
  const muscleGroup =
    patch.muscleGroup === undefined
      ? exercise.muscleGroup
      : patch.muscleGroup === null
        ? undefined
        : patch.muscleGroup;
  const demoId =
    patch.demoId === undefined ? exercise.demoId : patch.demoId === null ? undefined : patch.demoId;
  return {
    userId: exercise.userId,
    name: patch.name ?? exercise.name,
    normalizedName: patch.normalizedName ?? exercise.normalizedName,
    createdAt: exercise.createdAt,
    ...(restSeconds !== undefined ? { restSeconds } : {}),
    ...(muscleGroup !== undefined ? { muscleGroup } : {}),
    ...(demoId !== undefined ? { demoId } : {}),
  };
}
