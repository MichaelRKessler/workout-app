export type SetLine = {
  _id: string;
  exerciseId: string;
  exerciseName: string;
  reps: number;
  weightLb: number;
  loggedAt: number;
};

export function groupSets<T extends SetLine>(sets: T[]) {
  const groups: Array<{ exerciseId: string; name: string; sets: T[] }> = [];
  for (const set of sets) {
    const existing = groups.find((group) => group.exerciseId === set.exerciseId);
    if (existing) {
      existing.sets.push(set);
    } else {
      groups.push({
        exerciseId: set.exerciseId,
        name: set.exerciseName,
        sets: [set],
      });
    }
  }
  return groups;
}
