export function formatWeightLb(weightLb: number): string {
  if (weightLb === 0) {
    return "bodyweight";
  }
  const rounded = Math.round(weightLb * 100) / 100;
  return `${rounded} lb`;
}

export function formatSessionWhen(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(timestamp);
}
