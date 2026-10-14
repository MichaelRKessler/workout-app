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
    normalizedName: exerciseNameKey(name),
  };
}

/**
 * The key two spellings of one exercise share. Case, spaces, hyphens and other
 * punctuation don't count, and a plural matches its singular, so "Sit ups",
 * "Sit-ups" and "situp" are one exercise.
 */
export function exerciseNameKey(name: string): string {
  const words = name
    .toLocaleLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 0)
    .map(singular);
  const key = words.join("");
  // A name of only punctuation still needs a key of its own.
  return key.length > 0 ? key : legacyExerciseNameKey(name);
}

/** The key exercises saved before spelling variants matched were stored under. */
export function legacyExerciseNameKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function singular(word: string): string {
  if (word.length < 3 || !word.endsWith("s") || word.endsWith("ss")) {
    return word;
  }
  // Crunches, pushes, boxes and presses drop "es". Other plurals drop "s".
  if (/(ch|sh|x|ss)es$/.test(word)) {
    return word.slice(0, -2);
  }
  return word.slice(0, -1);
}
