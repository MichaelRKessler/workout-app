/** One exercise from free-exercise-db, trimmed to what the demo shows. */
export type DemoEntry = {
  id: string;
  name: string;
  equipment: string | null;
  muscles: string[];
  steps: string[];
};

/** Saved on an exercise to turn its demo off instead of following the name. */
export const NO_DEMO = "none";

/**
 * Pinned free-exercise-db commit, served by jsDelivr. Matches the commit in
 * scripts/generate-exercise-demos.mjs, so the photos and catalogue agree.
 */
const IMAGE_BASE =
  "https://cdn.jsdelivr.net/gh/yuhonas/free-exercise-db@f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5/exercises";

/** Start and end position photos. */
export function demoImageUrls(id: string): [string, string] {
  const base = `${IMAGE_BASE}/${encodeURIComponent(id)}`;
  return [`${base}/0.jpg`, `${base}/1.jpg`];
}

export function videoSearchUrl(name: string): string {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(`${name.trim()} exercise form`)}`;
}

// Spellings that mean the same thing, folded before the name splits into words.
const REWRITES: Array<[RegExp, string]> = [
  [/&/g, " and "],
  [/['’]/g, ""],
  [/\bdumb?bells?\b|\bdbs?\b/g, "dumbbell"],
  [/\bbb\b/g, "barbell"],
  [/\bkettlebells?\b|\bkbs?\b/g, "kettlebell"],
  [/\be-?z[- ]?(curl )?bar\b/g, "ezbar"],
  [/\b(trap|hex) bar\b/g, "trapbar"],
  [/\bt[- ]bar\b/g, "tbar"],
  [/\bv[- ]bar\b/g, "vbar"],
  [/\b(pull|push|chin|sit|step|press)[- ]?ups?\b/g, "$1up"],
  [/\b(pull|push)[- ]?downs?\b/g, "$1down"],
  [/\bskull[- ]?crushers?\b/g, "skullcrusher"],
  [/\bfl(y|ye|yes|ies)\b/g, "fly"],
  [/\brdls?\b/g, "romanian deadlift"],
  [/\bsldls?\b/g, "stiff legged deadlift"],
  [/\bohp\b/g, "overhead press"],
  [/\bhamstring curls?\b/g, "leg curl"],
  [/\bstiff[- ]leg(ged)?\b/g, "stiff legged"],
  [/\bbent[- ]over\b/g, "bent over"],
];

const STOP = new Set(["a", "an", "the", "with", "to", "on", "of", "and", "medium", "grip", "version", "attachment"]);

function singular(word: string): string {
  if (word.length <= 3 || word.endsWith("ss")) {
    return word;
  }
  if (/(ches|shes|sses|xes)$/.test(word)) {
    return word.slice(0, -2);
  }
  return word.endsWith("s") ? word.slice(0, -1) : word;
}

export function demoWords(name: string): string[] {
  let text = name.toLowerCase();
  for (const [pattern, replacement] of REWRITES) {
    text = text.replace(pattern, replacement);
  }
  const words = text
    .split(/[^a-z0-9]+/)
    .filter((word) => word && !STOP.has(word))
    .map(singular);
  return [...new Set(words)];
}

function key(name: string): string {
  return demoWords(name).sort().join(" ");
}

/**
 * Common names that the word match can't settle on its own, such as "Bench
 * press", which fits barbell, dumbbell and machine presses equally well.
 */
export const DEMO_ALIASES: Readonly<Record<string, string>> = {
  "Bench press": "Barbell_Bench_Press_-_Medium_Grip",
  "Flat bench press": "Barbell_Bench_Press_-_Medium_Grip",
  "Incline bench press": "Barbell_Incline_Bench_Press_-_Medium_Grip",
  "Incline press": "Barbell_Incline_Bench_Press_-_Medium_Grip",
  "Decline bench press": "Decline_Barbell_Bench_Press",
  "Close grip bench press": "Close-Grip_Barbell_Bench_Press",
  "Dumbbell press": "Dumbbell_Bench_Press",
  "Incline dumbbell bench press": "Incline_Dumbbell_Press",
  "Squat": "Barbell_Squat",
  "Back squat": "Barbell_Squat",
  "Front squat": "Front_Barbell_Squat",
  "Deadlift": "Barbell_Deadlift",
  "Conventional deadlift": "Barbell_Deadlift",
  "Overhead press": "Standing_Military_Press",
  "Military press": "Standing_Military_Press",
  "Shoulder press": "Dumbbell_Shoulder_Press",
  "Barbell overhead press": "Standing_Military_Press",
  "Dumbbell overhead press": "Dumbbell_Shoulder_Press",
  "Pull up": "Pullups",
  "Chin up": "Chin-Up",
  "Push up": "Pushups",
  "Dip": "Dips_-_Triceps_Version",
  "Chest dip": "Dips_-_Chest_Version",
  "Tricep dip": "Dips_-_Triceps_Version",
  "Lat pulldown": "Wide-Grip_Lat_Pulldown",
  "Pulldown": "Wide-Grip_Lat_Pulldown",
  "Row": "Bent_Over_Barbell_Row",
  "Barbell row": "Bent_Over_Barbell_Row",
  "Dumbbell row": "One-Arm_Dumbbell_Row",
  "Single arm dumbbell row": "One-Arm_Dumbbell_Row",
  "Cable row": "Seated_Cable_Rows",
  "Seated row": "Seated_Cable_Rows",
  "T bar row": "T-Bar_Row_with_Handle",
  "Curl": "Barbell_Curl",
  "Bicep curl": "Dumbbell_Bicep_Curl",
  "Dumbbell curl": "Dumbbell_Bicep_Curl",
  "Tricep pushdown": "Triceps_Pushdown",
  "Rope pushdown": "Triceps_Pushdown_-_Rope_Attachment",
  "Tricep extension": "Standing_Dumbbell_Triceps_Extension",
  "Overhead tricep extension": "Standing_Dumbbell_Triceps_Extension",
  "Skull crusher": "EZ-Bar_Skullcrusher",
  "Lateral raise": "Side_Lateral_Raise",
  "Side raise": "Side_Lateral_Raise",
  "Front raise": "Front_Dumbbell_Raise",
  "Rear delt fly": "Reverse_Flyes",
  "Reverse fly": "Reverse_Flyes",
  "Chest fly": "Dumbbell_Flyes",
  "Pec deck": "Butterfly",
  "Chest press": "Machine_Bench_Press",
  "Machine chest press": "Machine_Bench_Press",
  "Cable fly": "Cable_Crossover",
  "Shrug": "Barbell_Shrug",
  "Upright row": "Upright_Barbell_Row",
  "Lunge": "Dumbbell_Lunges",
  "Walking lunge": "Bodyweight_Walking_Lunge",
  "Bulgarian split squat": "Split_Squat_with_Dumbbells",
  "Split squat": "Split_Squat_with_Dumbbells",
  "Leg curl": "Lying_Leg_Curls",
  "Leg extension": "Leg_Extensions",
  "Calf raise": "Standing_Calf_Raises",
  "Hip thrust": "Barbell_Hip_Thrust",
  "Glute bridge": "Barbell_Glute_Bridge",
  "Step up": "Dumbbell_Step_Ups",
  "Kettlebell swing": "One-Arm_Kettlebell_Swings",
  "Farmer walk": "Farmers_Walk",
  "Farmer carry": "Farmers_Walk",
  "Back extension": "Hyperextensions_Back_Extensions",
  "Hyperextension": "Hyperextensions_Back_Extensions",
  "Ab wheel": "Ab_Roller",
  "Ab rollout": "Ab_Roller",
  "Crunch": "Crunches",
  "Box jump": "Front_Box_Jump",
  "Jump rope": "Rope_Jumping",
  "Treadmill": "Running_Treadmill",
  "Run": "Running_Treadmill",
  "Bike": "Bicycling_Stationary",
  "Rowing machine": "Rowing_Stationary",
  "Rower": "Rowing_Stationary",
};

const ALIAS_KEYS = new Map(Object.entries(DEMO_ALIASES).map(([name, id]) => [key(name), id]));

const EQUIPMENT_DEFAULT = "barbell";

type Indexed = { entry: DemoEntry; words: Set<string> };
const indexes = new WeakMap<readonly DemoEntry[], Indexed[]>();

function indexOf(catalogue: readonly DemoEntry[]): Indexed[] {
  let index = indexes.get(catalogue);
  if (!index) {
    index = catalogue.map((entry) => ({ entry, words: new Set(demoWords(entry.name)) }));
    indexes.set(catalogue, index);
  }
  return index;
}

/**
 * The catalogue exercise a name most likely means, or null when nothing fits
 * closely. Every word of the name must appear in the match, and the match may
 * add at most as many words again ("Curl" finds "Barbell Curl"). Ties go to the
 * barbell version, then the shorter name.
 */
export function matchDemo(name: string, catalogue: readonly DemoEntry[]): DemoEntry | null {
  const words = demoWords(name).filter((word) => word !== "bodyweight");
  if (words.length === 0) {
    return null;
  }
  const index = indexOf(catalogue);
  const aliasId = ALIAS_KEYS.get([...words].sort().join(" "));
  if (aliasId) {
    const aliased = index.find((item) => item.entry.id === aliasId);
    if (aliased) {
      return aliased.entry;
    }
  }

  let best: { item: Indexed; score: number; plain: boolean } | null = null;
  for (const item of index) {
    if (!words.every((word) => item.words.has(word))) {
      continue;
    }
    const score = words.length / item.words.size;
    if (score < 0.5) {
      continue;
    }
    const extra = [...item.words].filter((word) => !words.includes(word));
    const plain = extra.every((word) => word === EQUIPMENT_DEFAULT);
    if (
      !best ||
      score > best.score ||
      (score === best.score && plain && !best.plain) ||
      (score === best.score && plain === best.plain && item.entry.name.length < best.item.entry.name.length)
    ) {
      best = { item, score, plain };
    }
  }
  return best?.item.entry ?? null;
}

export function findDemo(id: string, catalogue: readonly DemoEntry[]): DemoEntry | null {
  return catalogue.find((entry) => entry.id === id) ?? null;
}
