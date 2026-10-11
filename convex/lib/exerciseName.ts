const MAX_EXERCISE_NAME_LENGTH = 80;

/** How many of the signed-in user's names a voice prompt may include. */
export const MAX_KNOWN_EXERCISE_NAMES = 40;

export type FormattedExerciseName = {
  name: string;
  normalizedName: string;
};

export function formatExerciseName(raw: string): FormattedExerciseName | null {
  const name = raw.trim().replace(/\s+/g, " ");
  if (name.length < 1 || name.length > MAX_EXERCISE_NAME_LENGTH) {
    return null;
  }
  return {
    name,
    normalizedName: name.toLocaleLowerCase(),
  };
}
