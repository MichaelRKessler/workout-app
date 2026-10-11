import { v } from "convex/values";
import { authedQuery } from "./lib/customFunctions";
import { MAX_KNOWN_EXERCISE_NAMES } from "./lib/exerciseName";
import { loadVoiceExerciseNames } from "./lib/workouts";

const exerciseValidator = v.object({
  _id: v.id("exercises"),
  name: v.string(),
});

const EXERCISE_LIMIT = 200;

export const list = authedQuery({
  args: {},
  returns: v.object({
    exercises: v.array(exerciseValidator),
    truncated: v.boolean(),
  }),
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("exercises")
      .withIndex("by_user_and_normalized_name", (q) =>
        q.eq("userId", ctx.userId),
      )
      .take(EXERCISE_LIMIT + 1);

    const truncated = rows.length > EXERCISE_LIMIT;
    const exercises = rows.slice(0, EXERCISE_LIMIT).map((exercise) => ({
      _id: exercise._id,
      name: exercise.name,
    }));
    exercises.sort((left, right) => left.name.localeCompare(right.name));

    return { exercises, truncated };
  },
});

/** Names for the voice prompt: this user only, most recent first, capped. */
export const namesForVoice = authedQuery({
  args: {},
  returns: v.array(v.string()),
  handler: async (ctx) => {
    const names = await loadVoiceExerciseNames(ctx, ctx.userId);
    return names.slice(0, MAX_KNOWN_EXERCISE_NAMES);
  },
});
