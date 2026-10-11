"use client";

import { formatClock, formatDistance } from "@/convex/lib/measures";
import { formatShortDate, formatVolumeLb, pluralize } from "@/lib/format";

function trendAmount(value: number, unit: "lb" | "reps" | "m" | "sec"): string {
  if (unit === "lb") {
    return formatVolumeLb(value);
  }
  if (unit === "reps") {
    return pluralize(value, "rep");
  }
  if (unit === "m") {
    return formatDistance(value);
  }
  return formatClock(value);
}

export function TrendChart({
  points,
  unit,
}: {
  points: Array<{ startedAt: number; value: number }>;
  unit: "lb" | "reps" | "m" | "sec";
}) {
  if (points.length < 2) {
    return null;
  }

  const width = 320;
  const height = 96;
  const padX = 8;
  const padY = 10;
  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const coords = points.map((point, index) => {
    const x = padX + (index / (points.length - 1)) * (width - padX * 2);
    const y = padY + (1 - (point.value - min) / span) * (height - padY * 2);
    return { x, y };
  });
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) {
    return null;
  }
  const unitLabel =
    unit === "lb"
      ? "estimated one-rep max"
      : unit === "reps"
        ? "most reps"
        : unit === "m"
          ? "farthest distance"
          : "longest time";
  const label = `${unitLabel} from ${formatShortDate(first.startedAt)} to ${formatShortDate(last.startedAt)}, ${pluralize(points.length, "workout")}`;

  return (
    <figure className="mt-4">
      <svg
        role="img"
        aria-label={label}
        viewBox={`0 0 ${width} ${height}`}
        className="h-24 w-full text-foreground"
      >
        <polyline
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          points={coords.map((point) => `${point.x},${point.y}`).join(" ")}
        />
        {coords.map((point, index) => (
          <circle key={points[index]?.startedAt ?? index} cx={point.x} cy={point.y} r="2.5" fill="currentColor" />
        ))}
      </svg>
      <figcaption className="mt-1 flex justify-between text-[12px] text-subtle">
        <span>{trendAmount(min, unit)}</span>
        <span>
          {unit === "lb" ? "Est. 1RM" : unit === "reps" ? "Most reps" : unit === "m" ? "Farthest" : "Longest"}
        </span>
        <span>{trendAmount(max, unit)}</span>
      </figcaption>
    </figure>
  );
}
