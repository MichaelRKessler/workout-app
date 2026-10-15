/**
 * The routine after the one used last, in the saved order, wrapping to the first.
 * With no routine workout yet, or when that routine was deleted, the first one.
 */
export function pickNextRoutine<T extends string>(routineIds: readonly T[], lastRoutineId: string | null): T | null {
  if (routineIds.length === 0) {
    return null;
  }
  const index = lastRoutineId === null ? -1 : routineIds.indexOf(lastRoutineId as T);
  if (index === -1) {
    return routineIds[0] ?? null;
  }
  return routineIds[(index + 1) % routineIds.length] ?? null;
}
