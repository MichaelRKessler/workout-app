/** About three calendar months, used as the chart's default window. */
export const THREE_MONTHS_MS = 92 * 24 * 60 * 60 * 1000;

/** A non-leap year. The "1 year" chart range. */
export const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

export type ChartRange = "3m" | "1y" | "all";

export type ProgressPoint = {
  sessionId: string;
  startedAt: number;
  value: number | null;
  volumeLb: number;
};

export function filterByRange<T extends { startedAt: number }>(
  points: T[],
  range: ChartRange,
  now: number,
): T[] {
  if (range === "all") {
    return points;
  }
  const start = now - (range === "3m" ? THREE_MONTHS_MS : ONE_YEAR_MS);
  return points.filter((point) => point.startedAt >= start);
}

/** Record series drops workouts whose only sets were warm-ups or drops. */
export function recordPoints<T extends { value: number | null }>(
  points: T[],
): Array<T & { value: number }> {
  return points.flatMap((point) => (point.value === null ? [] : [{ ...point, value: point.value }]));
}

export function chartCoords(
  values: number[],
  width: number,
  height: number,
  padX: number,
  padY: number,
): Array<{ x: number; y: number }> {
  if (values.length === 0) {
    return [];
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  return values.map((value, index) => {
    const x =
      values.length === 1 ? width / 2 : padX + (index / (values.length - 1)) * (width - padX * 2);
    const y = padY + (1 - (value - min) / span) * (height - padY * 2);
    return { x, y };
  });
}

export function nearestPointIndex(coords: Array<{ x: number }>, x: number): number {
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < coords.length; index += 1) {
    const point = coords[index];
    if (!point) {
      continue;
    }
    const distance = Math.abs(point.x - x);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  }
  return best;
}
