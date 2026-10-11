export function formatWeightLb(weightLb: number): string {
  if (weightLb === 0) {
    return "bodyweight";
  }
  const rounded = Math.round(weightLb * 100) / 100;
  return `${rounded} lb`;
}

/** Compact set label for lists: "10×135", or "20×BW" for bodyweight. */
export function formatSetShort(set: { reps: number; weightLb: number }): string {
  if (set.weightLb === 0) {
    return `${set.reps}×BW`;
  }
  return `${set.reps}×${Math.round(set.weightLb * 100) / 100}`;
}

/** Spoken-style set label for screen readers and buttons. */
export function describeSet(set: { reps: number; weightLb: number }): string {
  const reps = `${set.reps} ${set.reps === 1 ? "rep" : "reps"}`;
  if (set.weightLb === 0) {
    return `${reps}, bodyweight`;
  }
  return `${reps} at ${formatWeightLb(set.weightLb)}`;
}

/** Stopwatch time: "4:05", or "1:02:05" past an hour. */
export function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const ss = String(seconds).padStart(2, "0");
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${ss}`;
  }
  return `${minutes}:${ss}`;
}

/** Workout length: "52 min", or "1 h 5 min". Under a minute counts as 1 min. */
export function formatDuration(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

export function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

/** "Sun, Oct 11" */
export function formatShortDate(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(timestamp);
}

/** "Sunday, October 11" */
export function formatLongDate(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(timestamp);
}

/** "6:42 PM" */
export function formatTimeOfDay(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(timestamp);
}

/** "October", or "October 2025" outside the current year. */
export function formatMonthHeading(timestamp: number, now = Date.now()): string {
  const sameYear = new Date(timestamp).getFullYear() === new Date(now).getFullYear();
  return new Intl.DateTimeFormat(undefined, {
    month: "long",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(timestamp);
}

export function monthKey(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${date.getMonth()}`;
}
