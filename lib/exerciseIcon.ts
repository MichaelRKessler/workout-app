export type ExerciseIconKind =
  | "barbell"
  | "dumbbell"
  | "kettlebell"
  | "bodyweight"
  | "machine"
  | "other";

/**
 * Exercise names are free text, so the icon comes from keywords. Equipment
 * words win over movement words: "dumbbell bench press" is a dumbbell and
 * "leg press" is a machine, not a barbell press.
 */
const RULES: Array<[ExerciseIconKind, RegExp]> = [
  ["dumbbell", /\b(dumbbells?|dumbells?|db|hammer curls?)\b/],
  ["kettlebell", /\b(kettlebells?|kb|goblet|swings?|turkish get[- ]?ups?)\b/],
  [
    "machine",
    /\b(cables?|machines?|smith|pull[- ]?downs?|push[- ]?downs?|leg press|leg extensions?|leg curls?|hamstring curls?|pec deck|face pulls?|seated rows?|hack squats?|rowers?|erg)\b/,
  ],
  ["barbell", /\b(barbell|bb|ez[- ]?bar|trap bar|hex bar)\b/],
  [
    "bodyweight",
    /\b(push[- ]?ups?|press[- ]?ups?|pull[- ]?ups?|chin[- ]?ups?|dips?|planks?|sit[- ]?ups?|crunch(es)?|burpees?|lunges?|air squats?|bodyweight|muscle[- ]?ups?|mountain climbers?|jumping jacks?|pistol squats?|leg raises?|inverted rows?|handstands?|l[- ]sits?|glute bridges?|step[- ]?ups?|box jumps?)\b/,
  ],
  [
    "barbell",
    /\b(bench|squats?|deadlifts?|rdls?|romanian|ohp|press(es)?|cleans?|snatch(es)?|jerks?|rows?|hip thrusts?|good mornings?|curls?|shrugs?)\b/,
  ],
];

export function exerciseIconKind(name: string): ExerciseIconKind {
  const normalized = name.toLowerCase();
  for (const [kind, pattern] of RULES) {
    if (pattern.test(normalized)) {
      return kind;
    }
  }
  return "other";
}
