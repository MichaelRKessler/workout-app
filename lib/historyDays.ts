/** Local calendar day, matching the dates History already shows. */
export function localDayKey(timestamp: number): string {
  const date = new Date(timestamp);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * Groups items that share a local calendar day. Items must already be ordered
 * by time, which is how History loads workouts.
 */
export function groupByLocalDay<T extends { startedAt: number }>(
  items: T[],
): Array<{ key: string; items: T[] }> {
  const groups: Array<{ key: string; items: T[] }> = [];
  for (const item of items) {
    const key = localDayKey(item.startedAt);
    const current = groups[groups.length - 1];
    if (current && current.key === key) {
      current.items.push(item);
    } else {
      groups.push({ key, items: [item] });
    }
  }
  return groups;
}
