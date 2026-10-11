import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "close stale workouts",
  { minutes: 30 },
  internal.sessions.closeStale,
  {},
);

export default crons;
