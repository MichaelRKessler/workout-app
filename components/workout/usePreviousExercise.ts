"use client";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { formatExerciseName } from "@/convex/lib/exerciseName";
import { useWeightUnit } from "@/components/WeightUnit";
import { formatLastTime } from "@/lib/format";
import { previousSetsForName } from "@/lib/prefill";
import { useQuery } from "convex/react";

export function usePreviousExercise(
  exerciseName: string,
  excludeSessionId?: Id<"sessions">,
) {
  const unit = useWeightUnit();
  const formatted = formatExerciseName(exerciseName);
  const previous = useQuery(
    api.sets.recentForExercise,
    formatted
      ? {
          exerciseName: formatted.name,
          ...(excludeSessionId ? { excludeSessionId } : {}),
        }
      : "skip",
  );

  if (!formatted) {
    return { loading: false, sets: null, label: null };
  }
  if (previous === undefined) {
    return { loading: true, sets: null, label: null };
  }
  if (previous !== null && previous.normalizedName !== formatted.normalizedName) {
    return { loading: true, sets: null, label: null };
  }

  const sets = previousSetsForName(exerciseName, previous);
  return {
    loading: false,
    sets,
    label: formatLastTime(sets ?? [], unit),
  };
}
