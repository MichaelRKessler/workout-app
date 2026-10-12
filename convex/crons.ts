import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "close stale workouts",
  { minutes: 30 },
  internal.sessions.closeStale,
  {},
);

// Walks existing exercises and workouts until stats and set counts are filled.
// A finished tick is one indexed read. Pages schedule themselves.
crons.interval(
  "backfill exercise stats",
  { minutes: 1 },
  internal.exerciseStats.backfillTick,
  {},
);

crons.interval(
  "expire removed set ids",
  { hours: 24 },
  internal.offline.expireRemovals,
  {},
);

export default crons;
