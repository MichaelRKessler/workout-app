"use client";

import { formatClock, formatDistance } from "@/convex/lib/measures";
import type { WeightUnit } from "@/convex/lib/units";
import { formatShortDate, formatVolumeLb, formatWeightLb, pluralize } from "@/lib/format";
import { calendarDayKey } from "@/lib/historyDays";
import {
  chartCoords,
  filterByRange,
  nearestPointIndex,
  recordPoints,
  type ChartRange,
} from "@/lib/progressChart";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

const WIDTH = 320;
const HEIGHT = 148;
const PAD_X = 12;
const PAD_Y = 16;

type TrendUnit = "lb" | "reps" | "m" | "sec";

type Point = {
  sessionId: string;
  startedAt: number;
  value: number | null;
  volumeLb: number;
};

const RANGES: Array<{ id: ChartRange; label: string; name: string }> = [
  { id: "3m", label: "3 mo", name: "3 months" },
  { id: "1y", label: "1 yr", name: "1 year" },
  { id: "all", label: "All", name: "All time" },
];

/**
 * Best effort over time, with a volume toggle. A point opens that local day's
 * sets. The first tap on a point selects it; tapping the selected point, or
 * Open this day, opens the day. The latest point starts selected.
 */
export function TrendChart({
  points,
  recordUnit,
  weightUnit,
  timeZone,
  linkDays = true,
  noun = "workout",
  valueCaption,
}: {
  points: Point[];
  recordUnit: TrendUnit;
  weightUnit: WeightUnit;
  timeZone: string | null;
  /** Exercise charts open the workout day. A body-weight chart only selects a point. */
  linkDays?: boolean;
  /** Pluralized in the chart description and empty range, such as "weigh-in". */
  noun?: string;
  /** Replaces the record caption. Body weight uses "Weight". */
  valueCaption?: string;
}) {
  const router = useRouter();
  const [range, setRange] = useState<ChartRange>("3m");
  const [mode, setMode] = useState<"record" | "volume">("record");
  const [now] = useState(() => Date.now());
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const ranged = useMemo(() => filterByRange(points, range, now), [now, points, range]);
  const volumeAvailable = points.some((point) => point.volumeLb > 0);
  const activeMode = mode === "volume" && volumeAvailable ? "volume" : "record";
  const plotted = useMemo(() => {
    if (activeMode === "volume") {
      return ranged.map((point) => ({ ...point, plot: point.volumeLb }));
    }
    return recordPoints(ranged).map((point) => ({ ...point, plot: point.value }));
  }, [activeMode, ranged]);

  const foundIndex = plotted.findIndex((point) => point.sessionId === selectedKey);
  const safeIndex = plotted.length === 0 ? 0 : foundIndex === -1 ? plotted.length - 1 : foundIndex;
  const selected = plotted[safeIndex] ?? null;

  if (points.length === 0) {
    return null;
  }

  const recordName = recordLabel(recordUnit);
  const coords = chartCoords(
    plotted.map((point) => point.plot),
    WIDTH,
    HEIGHT,
    PAD_X,
    PAD_Y,
  );
  const min = plotted.length > 0 ? Math.min(...plotted.map((point) => point.plot)) : 0;
  const max = plotted.length > 0 ? Math.max(...plotted.map((point) => point.plot)) : 0;
  const line = coords.map((point) => `${point.x},${point.y}`).join(" ");
  const first = coords[0];
  const last = coords[coords.length - 1];
  const area =
    first && last
      ? `M ${first.x} ${HEIGHT - PAD_Y} L ${coords.map((point) => `${point.x} ${point.y}`).join(" L ")} L ${last.x} ${HEIGHT - PAD_Y} Z`
      : "";
  const dayHref =
    linkDays && selected
      ? `/history/day/${calendarDayKey(selected.startedAt, timeZone ?? undefined)}`
      : null;
  const seriesName = activeMode === "volume" ? "volume" : (valueCaption ?? recordName);
  const chartLabel =
    plotted.length === 0
      ? `No ${seriesName.toLowerCase()} in this range`
      : `${seriesName} from ${formatShortDate(plotted[0]?.startedAt ?? now)} to ${formatShortDate(plotted[plotted.length - 1]?.startedAt ?? now)}, ${pluralize(plotted.length, noun)}`;

  function formatPlot(value: number): string {
    if (activeMode === "volume") {
      return formatVolumeLb(value, weightUnit);
    }
    if (recordUnit === "lb") {
      return formatWeightLb(value, weightUnit);
    }
    if (recordUnit === "reps") {
      return pluralize(value, "rep");
    }
    if (recordUnit === "m") {
      return formatDistance(value);
    }
    return formatClock(value);
  }

  function choosePoint(index: number) {
    const point = plotted[index];
    if (!point) {
      return;
    }
    if (linkDays && point.sessionId === (selected?.sessionId ?? null) && dayHref) {
      router.push(dayHref);
      return;
    }
    setSelectedKey(point.sessionId);
  }

  return (
    <figure className="mt-4">
      <div className="flex flex-col gap-2">
        <div role="radiogroup" aria-label="Chart range" className="grid grid-cols-3 gap-1 rounded-full bg-fill p-1">
          {RANGES.map((item) => {
            const pressed = range === item.id;
            return (
              <button
                key={item.id}
                type="button"
                role="radio"
                aria-checked={pressed}
                aria-label={item.name}
                onClick={() => setRange(item.id)}
                className={`min-h-11 rounded-full text-sm font-medium ${
                  pressed ? "bg-surface text-foreground shadow-float" : "text-muted"
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </div>
        {volumeAvailable ? (
          <div role="radiogroup" aria-label="Chart metric" className="grid grid-cols-2 gap-1 rounded-full bg-fill p-1">
            <button
              type="button"
              role="radio"
              aria-checked={activeMode === "record"}
              aria-label={recordUnit === "lb" ? "Estimated one-rep max" : recordName}
              onClick={() => setMode("record")}
              className={`min-h-11 rounded-full text-sm font-medium ${
                activeMode === "record" ? "bg-surface text-foreground shadow-float" : "text-muted"
              }`}
            >
              {recordUnit === "lb" ? "1RM" : recordName}
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={activeMode === "volume"}
              onClick={() => setMode("volume")}
              className={`min-h-11 rounded-full text-sm font-medium ${
                activeMode === "volume" ? "bg-surface text-foreground shadow-float" : "text-muted"
              }`}
            >
              Volume
            </button>
          </div>
        ) : null}
      </div>

      {selected ? (
        <div className="mt-3">
          <p className="font-mono text-lg font-medium tracking-[-0.03em]">{formatPlot(selected.plot)}</p>
          <p className="text-sm text-muted" suppressHydrationWarning>
            {formatShortDate(selected.startedAt)}
            {activeMode === "record" && recordUnit === "lb" && !valueCaption ? " · est. 1RM" : ""}
            {activeMode === "volume" ? " · volume" : ""}
            {valueCaption && activeMode === "record" ? ` · ${valueCaption.toLowerCase()}` : ""}
          </p>
        </div>
      ) : (
        <p className="mt-3 text-base text-muted">
          {range === "3m"
            ? `No ${noun}s in the last 3 months.`
            : range === "1y"
              ? `No ${noun}s in the last year.`
              : `No ${noun}s to chart.`}
        </p>
      )}

      {plotted.length > 0 && first ? (
        <svg
          role="img"
          aria-label={chartLabel}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="mt-2 h-40 w-full touch-manipulation text-foreground"
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            const x = ((event.clientX - rect.left) / rect.width) * WIDTH;
            choosePoint(nearestPointIndex(coords, x));
          }}
        >
          {[0.25, 0.5, 0.75].map((fraction) => {
            const y = PAD_Y + (1 - fraction) * (HEIGHT - PAD_Y * 2);
            return (
              <line
                key={fraction}
                x1={PAD_X}
                x2={WIDTH - PAD_X}
                y1={y}
                y2={y}
                stroke="currentColor"
                strokeOpacity="0.15"
              />
            );
          })}
          {coords.length > 1 ? (
            <path d={area} fill="currentColor" fillOpacity="0.12" stroke="none" />
          ) : null}
          {coords.length > 1 ? (
            <polyline
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinejoin="round"
              strokeLinecap="round"
              points={line}
            />
          ) : null}
          {coords.map((point, index) => {
            const marked = index === safeIndex;
            const showDot = marked || coords.length <= 24;
            if (!showDot) {
              return null;
            }
            return (
              <circle
                key={plotted[index]?.sessionId ?? index}
                cx={point.x}
                cy={point.y}
                r={marked ? 6 : 3.5}
                fill={marked ? "var(--accent)" : "currentColor"}
              />
            );
          })}
        </svg>
      ) : null}

      {plotted.length > 0 ? (
        <figcaption className="mt-1 flex justify-between gap-3 text-xs text-subtle">
          <span>{formatPlot(min)}</span>
          <span>{activeMode === "volume" ? "Volume" : (valueCaption ?? recordName)}</span>
          <span>{formatPlot(max)}</span>
        </figcaption>
      ) : null}

      {dayHref && selected ? (
        <Link
          href={dayHref}
          className="mt-2 inline-flex min-h-11 items-center text-base font-medium underline decoration-line underline-offset-4"
        >
          Open this day
        </Link>
      ) : null}
    </figure>
  );
}

function recordLabel(unit: TrendUnit): string {
  if (unit === "lb") {
    return "Est. 1RM";
  }
  if (unit === "reps") {
    return "Most reps";
  }
  if (unit === "m") {
    return "Farthest";
  }
  return "Longest";
}
