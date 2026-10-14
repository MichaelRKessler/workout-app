import type { Celebration, EarnedBadge, Highlight } from "../convex/lib/recap.ts";
import type { WeightUnit } from "../convex/lib/units.ts";
import { formatVolumeLb, formatWeightLb, pluralize } from "./format.ts";

type Names = Record<string, string>;

const THINGS: Record<string, { one: string; many: string }> = {
  grizzly: { one: "grizzly bear", many: "grizzly bears" },
  piano: { one: "grand piano", many: "grand pianos" },
  horse: { one: "horse", many: "horses" },
  hippo: { one: "hippo", many: "hippos" },
  car: { one: "car", many: "cars" },
  rhino: { one: "rhino", many: "rhinos" },
  elephant: { one: "elephant", many: "elephants" },
  trex: { one: "T. rex", many: "T. rexes" },
  bus: { one: "school bus", many: "school buses" },
  humpback: { one: "humpback whale", many: "humpback whales" },
  blueWhale: { one: "blue whale", many: "blue whales" },
  jumbo: { one: "jumbo jet", many: "jumbo jets" },
  liberty: { one: "Statue of Liberty", many: "Statues of Liberty" },
};

const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

/** "about two elephants", "about one and a half pianos", "about 14 cars". */
export function describeComparison(comparison: { id: string; count: number }): string {
  const thing = THINGS[comparison.id] ?? { one: "thing", many: "things" };
  const count = comparison.count;
  const whole = Math.floor(count);
  const fraction = count - whole;
  if (whole < 3 && fraction >= 0.35 && fraction < 0.75) {
    return `about ${WORDS[whole]} and a half ${thing.many}`;
  }
  const rounded = Math.max(1, Math.round(count));
  const word = rounded <= 10 ? WORDS[rounded] : String(rounded);
  return rounded === 1 ? `about one ${thing.one}` : `about ${word} ${thing.many}`;
}

function pick<T>(options: T[], seed: number, salt: number): T {
  return options[(seed + salt * 7919) % options.length] as T;
}

function name(names: Names, exerciseId: string): string {
  return names[exerciseId] ?? "this exercise";
}

export function headingFor(seed: number, celebrate: boolean): string {
  if (celebrate) {
    return pick(["New record!", "Record day.", "You beat your best.", "That's a PR."], seed, 1);
  }
  return pick(
    ["Nice work.", "Strong finish.", "That's a wrap.", "Good session.", "Done and dusted.", "Another one in the books."],
    seed,
    1,
  );
}

export function celebrationText(item: Celebration, unit: WeightUnit, names: Names): string {
  switch (item.kind) {
    case "sessionVolume":
      return `Biggest workout yet: ${formatVolumeLb(item.volumeLb, unit)} moved (was ${formatVolumeLb(item.previousLb, unit)})`;
    case "exerciseVolume":
      return `Most volume ever on ${name(names, item.exerciseId)}: ${formatVolumeLb(item.volumeLb, unit)} (was ${formatVolumeLb(item.previousLb, unit)})`;
    case "repsAtWeight":
      return `Most reps at ${formatWeightLb(item.weightLb, unit)} on ${name(names, item.exerciseId)}: ${item.reps} (was ${item.previousReps})`;
    case "beatLastTime": {
      const exercise = name(names, item.exerciseId);
      if (item.metric === "volume") {
        return `More ${exercise} volume than last time: ${formatVolumeLb(item.value, unit)} (was ${formatVolumeLb(item.previous, unit)})`;
      }
      if (item.metric === "reps") {
        return `More ${exercise} reps than last time: ${item.value} (was ${item.previous})`;
      }
      return `More ${exercise} sets than last time: ${item.value} (was ${item.previous})`;
    }
  }
}

export function highlightText(
  item: Highlight,
  unit: WeightUnit,
  names: Names,
  seed: number,
): { icon: string; text: string } {
  switch (item.kind) {
    case "workoutVolume":
      return {
        icon: "🏋️",
        text: pick(
          [
            `You moved ${formatVolumeLb(item.volumeLb, unit)} today, ${describeComparison(item.comparison)}.`,
            `${formatVolumeLb(item.volumeLb, unit)} lifted in one workout. That's ${describeComparison(item.comparison)}.`,
          ],
          seed,
          2,
        ),
      };
    case "monthVolume":
      return {
        icon: item.comparison.id === "elephant" ? "🐘" : "📅",
        text: pick(
          [
            `This month you've lifted ${describeComparison(item.comparison)}: ${formatVolumeLb(item.volumeLb, unit)} across ${pluralize(item.workouts, "workout")}.`,
            `${formatVolumeLb(item.volumeLb, unit)} so far this month. That's ${describeComparison(item.comparison)}.`,
          ],
          seed,
          3,
        ),
      };
    case "lifetimeVolume":
      return {
        icon: "🌍",
        text: `All time, you've moved ${formatVolumeLb(item.volumeLb, unit)}, ${describeComparison(item.comparison)}.`,
      };
    case "strengthGain": {
      const weeks = Math.round(item.days / 7);
      return {
        icon: "📈",
        text: `Your ${name(names, item.exerciseId)} estimated max is up ${formatWeightLb(Math.round(item.toLb - item.fromLb), unit)} in ${pluralize(weeks, "week")} (${formatWeightLb(Math.round(item.fromLb), unit)} to ${formatWeightLb(Math.round(item.toLb), unit)}).`,
      };
    }
    case "workoutNumber":
      return {
        icon: "🔢",
        text: item.count % 10 === 0 ? `Workout number ${item.count}. Nice round number.` : `That was workout number ${item.count}.`,
      };
    case "monthWorkouts":
      return { icon: "🗓️", text: `${ordinal(item.count)} workout this month.` };
    case "streak":
      return {
        icon: "🔥",
        text: pick(
          [`${item.weeks} weeks in a row with a workout.`, `Your streak is ${item.weeks} weeks and counting.`],
          seed,
          4,
        ),
      };
    case "totalReps":
      return { icon: "🔁", text: `${item.reps} reps across ${pluralize(item.sets, "set")}.` };
    case "topExercise":
      return {
        icon: "⭐",
        text: `${name(names, item.exerciseId)} carried the day with ${formatVolumeLb(item.volumeLb, unit)}, ${Math.round(item.share * 100)}% of your volume.`,
      };
    case "badgeProgress": {
      const [badgeId, exerciseId] = item.badgeId.split(":");
      const badge = badgeInfo({ id: badgeId ?? "", exerciseId: exerciseId ?? null }, names);
      const remaining =
        item.unit === "lb"
          ? formatVolumeLb(item.remaining, unit)
          : item.unit === "sets"
            ? pluralize(item.remaining, "set")
            : pluralize(item.remaining, "workout");
      return { icon: badge.emoji, text: `${remaining} to go until ${badge.title}.` };
    }
  }
}

export function ordinal(count: number): string {
  const mod100 = count % 100;
  const suffix =
    mod100 >= 11 && mod100 <= 13 ? "th" : count % 10 === 1 ? "st" : count % 10 === 2 ? "nd" : count % 10 === 3 ? "rd" : "th";
  return `${count}${suffix}`;
}

export function badgeInfo(
  badge: Pick<EarnedBadge, "id" | "exerciseId">,
  names: Names,
): { emoji: string; title: string; description: string } {
  const exercise = badge.exerciseId ? name(names, badge.exerciseId) : "";
  switch (badge.id) {
    case "workouts-10":
      return { emoji: "🌱", title: "Habit Forming", description: "10 workouts logged" };
    case "workouts-50":
      return { emoji: "🎯", title: "Half Century", description: "50 workouts logged" };
    case "workouts-100":
      return { emoji: "💯", title: "Centurion", description: "100 workouts logged" };
    case "workouts-250":
      return { emoji: "🏛️", title: "Iron Regular", description: "250 workouts logged" };
    case "workouts-500":
      return { emoji: "👑", title: "Legend", description: "500 workouts logged" };
    case "volume-100k":
      return { emoji: "🏋️", title: "Six Figures", description: "100,000 lb lifted in total" };
    case "volume-500k":
      return { emoji: "🚀", title: "Half-Million Mover", description: "500,000 lb lifted in total" };
    case "volume-1m":
      return { emoji: "💎", title: "Million Pound Club", description: "1,000,000 lb lifted in total" };
    case "volume-5m":
      return { emoji: "🌋", title: "Five Million", description: "5,000,000 lb lifted in total" };
    case "iron-elephant":
      return { emoji: "🐘", title: "Iron Elephant", description: "An elephant's weight (13,000 lb) in one workout" };
    case "school-bus":
      return { emoji: "🚌", title: "Bus Driver", description: "A school bus (25,000 lb) in one workout" };
    case "sets-100":
      return { emoji: "🥉", title: `100 ${exercise} sets`, description: `100 sets of ${exercise}` };
    case "sets-500":
      return { emoji: "🏆", title: `500 ${exercise} sets`, description: `500 sets of ${exercise}` };
    case "streak-4":
      return { emoji: "🔥", title: "Month Strong", description: "4 weeks in a row with a workout" };
    case "streak-12":
      return { emoji: "⚡", title: "Quarter of Iron", description: "12 weeks in a row with a workout" };
    case "streak-26":
      return { emoji: "🌗", title: "Half-Year Habit", description: "26 weeks in a row with a workout" };
    case "streak-52":
      return { emoji: "🗓️", title: "Year of Iron", description: "52 weeks in a row with a workout" };
    case "early-bird":
      return { emoji: "🌅", title: "Early Bird", description: "Started a workout before 6 AM" };
    case "night-owl":
      return { emoji: "🦉", title: "Night Owl", description: "Started a workout after 10 PM" };
    default:
      return { emoji: "🏅", title: "Badge", description: "" };
  }
}
