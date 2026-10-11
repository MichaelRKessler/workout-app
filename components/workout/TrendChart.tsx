"use client";

import { formatClock, formatDistance } from "@/convex/lib/measures";
import { formatWeightAmount, type WeightUnit } from "@/convex/lib/units";
import { formatVolumeLb, formatWeightLb, pluralize } from "@/lib/format";
import {
  availableMetrics,
  AXIS_FONT_PX,
  buildSeries,
  chartDomain,
  defaultChartRange,
  estimateLabelWidth,
  filterByRange,
  formatChartDate,
  formatYTick,
  gapThresholdMs,
  layoutDateTicks,
  linearTrend,
  monotonePath,
  areaPath,
  nearestPointIndex,
  prepareYScale,
  rangeStats,
  splitSegments,
  timeToX,
  valueToY,
  type ChartMetric,
  type ChartRange,
  type ChartSeries,
  type ChartSetSnap,
  type DateTick,
  type PlottedPoint,
  type ProgressPoint,
  type TrendUnit,
} from "@/lib/progressChart";
import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";

const RANGES: Array<{ id: ChartRange; label: string; name: string }> = [
  { id: "1m", label: "1M", name: "1 month" },
  { id: "3m", label: "3M", name: "3 months" },
  { id: "6m", label: "6M", name: "6 months" },
  { id: "1y", label: "1Y", name: "1 year" },
  { id: "all", label: "All", name: "All time" },
];

const METRIC_COPY: Record<ChartMetric, { short: string; name: string }> = {
  epley: { short: "1RM", name: "Estimated one-rep max" },
  weight: { short: "Weight", name: "Top weight" },
  volume: { short: "Volume", name: "Volume" },
  reps: { short: "Reps", name: "Most reps" },
  time: { short: "Time", name: "Longest time" },
  distance: { short: "Distance", name: "Farthest distance" },
  body: { short: "Weight", name: "Weight" },
};

const PLOT_TOP = 10;
const PLOT_HEIGHT = 148;

type TrendChartProps = {
  points: ProgressPoint[];
  recordUnit: TrendUnit;
  weightUnit: WeightUnit;
  timeZone: string | null;
  /** Exercise charts open the workout day. A body-weight chart only selects a point. */
  linkDays?: boolean;
  /** Pluralized in the chart description and empty range, such as "weigh-in". */
  noun?: string;
  /** Replaces the record caption. Body weight uses "Weight". */
  valueCaption?: string;
  /** Body weight keeps the latest reading each day and does not mark PRs. */
  series?: ChartSeries;
};

/**
 * Progress over real calendar time. Points land on their dates, same-day
 * sessions fold into one reading, and a scrubber shows that day's best set.
 */
export function TrendChart({
  points,
  recordUnit,
  weightUnit,
  timeZone,
  linkDays = true,
  noun = "workout",
  valueCaption,
  series,
}: TrendChartProps) {
  const seriesKind: ChartSeries = series ?? (valueCaption === "Weight" ? "body" : "effort");
  const [rangeOverride, setRangeOverride] = useState<ChartRange | null>(null);
  const [metricOverride, setMetricOverride] = useState<ChartMetric | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [scrubbed, setScrubbed] = useState(false);
  const [now] = useState(() => Date.now());
  const [width, setWidth] = useState(0);
  const frameRef = useRef<HTMLDivElement>(null);
  const rawId = useId().replace(/:/g, "");
  const gradientId = `trend-${rawId}`;

  useEffect(() => {
    const node = frameRef.current;
    if (!node) return;
    const measure = () => setWidth(Math.round(node.clientWidth));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const range = rangeOverride ?? defaultChartRange(points, now);
  const metrics = useMemo(
    () => availableMetrics(points, recordUnit, seriesKind),
    [points, recordUnit, seriesKind],
  );
  const metric = metrics.includes(metricOverride ?? "epley") && metricOverride ? metricOverride : (metrics[0] ?? "epley");
  const zone = timeZone ?? "UTC";
  const ready = timeZone !== null;
  const fullSeries = useMemo(
    () => (ready ? buildSeries(points, metric, recordUnit, zone) : []),
    [metric, points, ready, recordUnit, zone],
  );
  const plotted = useMemo(() => filterByRange(fullSeries, range, now), [fullSeries, now, range]);
  const stats = rangeStats(plotted);
  const foundIndex = plotted.findIndex((point) => point.dayKey === selectedKey);
  const safeIndex = plotted.length === 0 ? 0 : foundIndex === -1 ? plotted.length - 1 : foundIndex;
  const selected = plotted[safeIndex] ?? null;

  if (points.length === 0) return null;

  const metricCopy = METRIC_COPY[metric];
  const seriesName = valueCaption && metric === "body" ? valueCaption : metricCopy.name;
  const dayHref = linkDays && selected ? `/history/day/${selected.dayKey}` : null;
  const chartLabel = describeChart(plotted, seriesName, noun, weightUnit, metric, zone, stats);

  function chooseIndex(index: number) {
    const point = plotted[index];
    if (!point) return;
    setScrubbed(true);
    setSelectedKey(point.dayKey);
  }

  function scrub(event: ReactPointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || plotted.length === 0) return;
    const x = ((event.clientX - rect.left) / rect.width) * width;
    chooseIndex(nearestPointIndex(layoutCoords(plotted, range, now, width, metric, weightUnit), x));
  }

  return (
    <figure className="mt-4 rounded-[1.25rem] border border-line bg-surface p-4 shadow-float">
      <div ref={frameRef} className="flex flex-col gap-2">
        <div role="radiogroup" aria-label="Chart range" className="grid grid-cols-5 gap-1 rounded-full bg-fill p-1">
          {RANGES.map((item) => {
            const pressed = range === item.id;
            return (
              <button
                key={item.id}
                type="button"
                role="radio"
                aria-checked={pressed}
                aria-label={item.name}
                onClick={() => setRangeOverride(item.id)}
                className={`min-h-11 rounded-full text-sm font-medium ${
                  pressed ? "bg-surface text-foreground shadow-float" : "text-muted"
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </div>
        {metrics.length > 1 ? (
          <div
            role="radiogroup"
            aria-label="Chart metric"
            className={`grid gap-1 rounded-full bg-fill p-1 ${metrics.length === 2 ? "grid-cols-2" : metrics.length === 4 ? "grid-cols-2" : "grid-cols-3"}`}
          >
            {metrics.map((item) => {
              const pressed = metric === item;
              const copy = METRIC_COPY[item];
              return (
                <button
                  key={item}
                  type="button"
                  role="radio"
                  aria-checked={pressed}
                  aria-label={copy.name}
                  onClick={() => setMetricOverride(item)}
                  className={`min-h-11 rounded-full text-sm font-medium ${
                    pressed ? "bg-surface text-foreground shadow-float" : "text-muted"
                  }`}
                >
                  {copy.short}
                </button>
              );
            })}
          </div>
        ) : null}

        {stats ? (
          <div className="mt-1 grid grid-cols-3 gap-2">
            <Stat label="Current" value={formatStored(stats.current, metric, weightUnit)} />
            <Stat
              label={seriesKind === "body" ? "High" : "Best"}
              value={formatStored(stats.best, metric, weightUnit)}
            />
            <Stat
              label="Change"
              value={stats.delta === null ? "—" : formatDelta(stats.delta, metric, weightUnit)}
            />
          </div>
        ) : (
          <p className="mt-1 text-base text-muted">{emptyCopy(range, noun)}</p>
        )}

        {ready && width > 0 && plotted.length > 0 ? (
          <ChartPlot
            width={width}
            plotted={plotted}
            range={range}
            now={now}
            metric={metric}
            weightUnit={weightUnit}
            zone={zone}
            safeIndex={safeIndex}
            gradientId={gradientId}
            chartLabel={chartLabel}
            showCallout={scrubbed}
            onScrub={scrub}
            onKey={(key) => {
              if (key === "ArrowRight" || key === "ArrowDown") chooseIndex(Math.min(plotted.length - 1, safeIndex + 1));
              else if (key === "ArrowLeft" || key === "ArrowUp") chooseIndex(Math.max(0, safeIndex - 1));
              else if (key === "Home") chooseIndex(0);
              else if (key === "End") chooseIndex(plotted.length - 1);
            }}
          />
        ) : stats ? (
          <div className="mt-2 h-44 rounded-xl bg-fill" aria-hidden />
        ) : null}

        {plotted.length === 1 ? (
          <p className="text-sm text-muted">One {noun} in this range. The line shows up after the next one.</p>
        ) : null}

        {dayHref && selected ? (
          <Link
            href={dayHref}
            className="inline-flex min-h-11 items-center text-base font-medium underline decoration-line underline-offset-4"
          >
            Open {formatChartDate(selected.startedAt, zone)}
          </Link>
        ) : null}
      </div>
    </figure>
  );
}

function ChartPlot({
  width,
  plotted,
  range,
  now,
  metric,
  weightUnit,
  zone,
  safeIndex,
  gradientId,
  chartLabel,
  showCallout,
  onScrub,
  onKey,
}: {
  width: number;
  plotted: PlottedPoint[];
  range: ChartRange;
  now: number;
  metric: ChartMetric;
  weightUnit: WeightUnit;
  zone: string;
  safeIndex: number;
  gradientId: string;
  chartLabel: string;
  showCallout: boolean;
  onScrub: (event: ReactPointerEvent<SVGSVGElement>) => void;
  onKey: (key: string) => void;
}) {
  const domain = chartDomain(range, plotted, now);
  const prepared = prepareYScale(
    plotted.map((point) => point.value),
    metric,
    weightUnit,
  );
  if (!domain) return null;
  const yLabels = yTickLabels(prepared);
  const gutter = yGutter(prepared, width);
  const plotLeft = gutter;
  const plotWidth = Math.max(32, width - gutter - 8);
  const height = PLOT_TOP + PLOT_HEIGHT + 8;
  const baseline = PLOT_TOP + PLOT_HEIGHT;
  const coords = plotted.map((point) => ({
    x: timeToX(point.startedAt, domain, plotLeft, plotWidth),
    y: valueToY(prepared.toDisplay(point.value), prepared.scale, PLOT_TOP, PLOT_HEIGHT),
  }));
  const ticks = prepared.scale.ticks.map((tick, index) => ({
    y: valueToY(tick, prepared.scale, PLOT_TOP, PLOT_HEIGHT),
    label: yLabels[index] ?? "",
  }));
  const dateTicks = layoutDateTicks(domain.start, domain.end, plotLeft, plotWidth, zone);
  const segments = splitSegments(
    plotted.map((point, index) => ({ ...point, index })),
    gapThresholdMs(domain.start, domain.end),
  );
  const paths = segments.flatMap((segment) => {
    const pts = segment.flatMap((item) => {
      const coord = coords[item.index];
      return coord ? [coord] : [];
    });
    if (pts.length < 2) return [];
    const line = monotonePath(pts);
    return [{ line, area: areaPath(line, pts, baseline) }];
  });
  const trend = linearTrend(coords);
  const selected = plotted[safeIndex] ?? null;
  const selectedCoord = coords[safeIndex] ?? null;
  const setLabel = selected ? formatSnap(selected.bestSet, metric, weightUnit) : null;
  const tip = selected && selectedCoord ? placeTooltip(selectedCoord, width, height) : null;

  return (
    <div className="mt-1">
      <div
        className="relative"
        style={{ height }}
        role="slider"
        tabIndex={0}
        aria-label={chartLabel}
        aria-valuemin={0}
        aria-valuemax={Math.max(0, plotted.length - 1)}
        aria-valuenow={safeIndex}
        aria-valuetext={
          selected
            ? `${formatChartDate(selected.startedAt, zone, true)}, ${formatStored(selected.value, metric, weightUnit)}${setLabel ? `, ${setLabel}` : ""}${selected.pr ? ", personal record" : ""}`
            : "No points"
        }
        onKeyDown={(event) => {
          if (event.key.startsWith("Arrow") || event.key === "Home" || event.key === "End") {
            event.preventDefault();
            onKey(event.key);
          }
        }}
      >
        {ticks.map((tick) => (
          <span
            key={tick.label}
            className="pointer-events-none absolute text-right text-xs leading-none text-muted"
            style={{ left: 0, width: Math.max(0, plotLeft - 6), top: tick.y - 8 }}
          >
            {tick.label}
          </span>
        ))}
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          className="block touch-none select-none"
          aria-hidden
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            onScrub(event);
          }}
          onPointerMove={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) onScrub(event);
          }}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.3" />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.02" />
            </linearGradient>
            <clipPath id={`${gradientId}-clip`}>
              <rect x={plotLeft} y={PLOT_TOP} width={plotWidth} height={PLOT_HEIGHT} />
            </clipPath>
          </defs>
          {ticks.map((tick) => (
            <line
              key={tick.label}
              x1={plotLeft}
              x2={plotLeft + plotWidth}
              y1={tick.y}
              y2={tick.y}
              stroke="var(--line)"
            />
          ))}
          <g clipPath={`url(#${gradientId}-clip)`}>
            {paths.map((path) => (
              <path key={path.line} d={path.area} fill={`url(#${gradientId})`} stroke="none" />
            ))}
            {trend ? (
              <line
                x1={trend.x1}
                y1={trend.y1}
                x2={trend.x2}
                y2={trend.y2}
                stroke="var(--subtle)"
                strokeWidth={1.5}
                strokeDasharray="4 4"
                strokeLinecap="round"
              />
            ) : null}
            {paths.map((path) => (
              <path
                key={`${path.line}-stroke`}
                d={path.line}
                fill="none"
                stroke="var(--accent)"
                strokeWidth={2.5}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ))}
          </g>
          {showCallout && selectedCoord ? (
            <line
              x1={selectedCoord.x}
              x2={selectedCoord.x}
              y1={PLOT_TOP}
              y2={baseline}
              stroke="var(--accent)"
              strokeOpacity={0.35}
              strokeDasharray="3 4"
            />
          ) : null}
          {coords.map((coord, index) => {
            const point = plotted[index];
            if (!point) return null;
            const marked = index === safeIndex;
            const show = plotted.length <= 18 || point.pr || marked || index === 0 || index === plotted.length - 1;
            if (!show) return null;
            return (
              <g key={point.dayKey}>
                {point.pr ? (
                  <circle
                    cx={coord.x}
                    cy={coord.y}
                    r={marked ? 9 : 8}
                    fill="none"
                    stroke="var(--accent)"
                    strokeOpacity={0.4}
                    strokeWidth={1.5}
                  />
                ) : null}
                <circle
                  cx={coord.x}
                  cy={coord.y}
                  r={marked ? 5.5 : point.pr ? 4.5 : 3.5}
                  fill={marked || point.pr ? "var(--accent)" : "var(--surface)"}
                  stroke="var(--accent)"
                  strokeWidth={marked || point.pr ? 0 : 2}
                />
              </g>
            );
          })}
        </svg>
        {showCallout && selected && tip ? (
          <div
            role="status"
            aria-live="polite"
            className="pointer-events-none absolute z-10 rounded-2xl border border-line bg-surface px-3 py-2 shadow-lift"
            style={{ left: tip.left, top: tip.top, width: tip.width }}
          >
            <p className="text-xs leading-none text-muted" suppressHydrationWarning>
              {formatChartDate(selected.startedAt, zone, true)}
              {selected.pr ? <span className="ml-2 font-semibold tracking-[0.05em] text-accent uppercase">PR</span> : null}
            </p>
            <p className="mt-1 font-mono text-lg leading-tight font-medium tracking-[-0.03em]">
              {formatStored(selected.value, metric, weightUnit)}
            </p>
            <p className="mt-0.5 text-xs leading-snug text-muted">
              {metric === "body" ? "Weight" : metric === "epley" ? "Est. 1RM" : METRIC_COPY[metric].short}
              {setLabel ? ` · ${setLabel}` : ""}
            </p>
          </div>
        ) : null}
      </div>
      <div className="relative mt-1 h-7">
        {dateTicks.map((tick) => (
          <span
            key={`${tick.time}-${tick.label}`}
            className="absolute top-0 text-xs leading-none whitespace-nowrap text-muted"
            style={dateTickStyle(tick, width)}
          >
            {tick.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-medium tracking-[0.06em] text-subtle uppercase">{label}</p>
      <p className="mt-0.5 font-mono text-lg leading-tight font-medium tracking-[-0.03em] text-pretty">{value}</p>
    </div>
  );
}

function layoutCoords(
  plotted: PlottedPoint[],
  range: ChartRange,
  now: number,
  width: number,
  metric: ChartMetric,
  weightUnit: WeightUnit,
) {
  const domain = chartDomain(range, plotted, now);
  const prepared = prepareYScale(
    plotted.map((point) => point.value),
    metric,
    weightUnit,
  );
  if (!domain || width <= 0) return plotted.map(() => ({ x: 0 }));
  const gutter = yGutter(prepared, width);
  const plotWidth = Math.max(32, width - gutter - 8);
  return plotted.map((point) => ({
    x: timeToX(point.startedAt, domain, gutter, plotWidth),
  }));
}

function yTickLabels(prepared: ReturnType<typeof prepareYScale>): string[] {
  return prepared.scale.ticks.map((tick, index, all) => {
    const text = formatYTick(tick, prepared.tickKind);
    if (index === all.length - 1 && prepared.caption) return `${text} ${prepared.caption}`;
    return text;
  });
}

function yGutter(prepared: ReturnType<typeof prepareYScale>, width: number): number {
  const labels = yTickLabels(prepared);
  return Math.min(
    width * 0.46,
    Math.max(44, ...labels.map((label) => estimateLabelWidth(label, AXIS_FONT_PX) + 8), 0),
  );
}

function placeTooltip(
  coord: { x: number; y: number },
  width: number,
  height: number,
): { left: number; top: number; width: number } {
  const tipWidth = Math.min(188, Math.max(120, width - 8));
  const left = Math.max(4, Math.min(width - tipWidth - 4, coord.x - tipWidth / 2));
  const above = coord.y > 78;
  const top = above ? Math.max(4, coord.y - 74) : Math.min(height - 70, coord.y + 12);
  return { left, top, width: tipWidth };
}

function dateTickStyle(tick: DateTick, width: number): CSSProperties {
  if (tick.anchor === "start") return { left: tick.x };
  if (tick.anchor === "end") return { right: Math.max(0, width - tick.x) };
  return { left: tick.x, transform: "translateX(-50%)" };
}

function formatStored(value: number, metric: ChartMetric, unit: WeightUnit): string {
  if (metric === "volume") return formatVolumeLb(value, unit);
  if (metric === "epley" || metric === "weight" || metric === "body") return formatWeightLb(value, unit);
  if (metric === "reps") return pluralize(value, "rep");
  if (metric === "time") return formatClock(value);
  return formatDistance(value);
}

function formatDelta(delta: number, metric: ChartMetric, unit: WeightUnit): string {
  const quiet = metric === "time" ? 0.5 : metric === "reps" ? 0.5 : 0.05;
  if (Math.abs(delta) < quiet) {
    if (metric === "reps") return "0 reps";
    if (metric === "time") return "0:00";
    if (metric === "distance") return formatDistance(0);
    return `0 ${unit}`;
  }
  const text = formatStored(Math.abs(delta), metric, unit);
  return delta > 0 ? `+${text}` : `−${text}`;
}

function formatSnap(set: ChartSetSnap | null, metric: ChartMetric, unit: WeightUnit): string | null {
  if (!set || metric === "body") return null;
  if (metric === "time") {
    const clock = formatClock(set.durationSec ?? 0);
    return set.weightLb > 0 ? `${clock} @ ${formatWeightAmount(set.weightLb, unit)}` : clock;
  }
  if (metric === "distance") {
    const distance = formatDistance(set.distanceM ?? 0);
    return set.durationSec ? `${distance} in ${formatClock(set.durationSec)}` : distance;
  }
  if ((set.reps ?? 0) <= 0) return null;
  if (set.weightLb <= 0) return `${set.reps}×BW`;
  return `${set.reps}×${formatWeightAmount(set.weightLb, unit)}`;
}

function emptyCopy(range: ChartRange, noun: string): string {
  if (range === "1m") return `No ${noun}s in the last month.`;
  if (range === "3m") return `No ${noun}s in the last 3 months.`;
  if (range === "6m") return `No ${noun}s in the last 6 months.`;
  if (range === "1y") return `No ${noun}s in the last year.`;
  return `No ${noun}s to chart.`;
}

function describeChart(
  plotted: PlottedPoint[],
  seriesName: string,
  noun: string,
  unit: WeightUnit,
  metric: ChartMetric,
  zone: string,
  stats: ReturnType<typeof rangeStats>,
): string {
  const first = plotted[0];
  const last = plotted[plotted.length - 1];
  if (!first || !last || !stats) return `No ${seriesName.toLowerCase()} in this range`;
  const change = stats.delta === null ? "no change yet" : `change ${formatDelta(stats.delta, metric, unit)}`;
  return `${seriesName} from ${formatChartDate(first.startedAt, zone)} to ${formatChartDate(last.startedAt, zone)}, ${pluralize(plotted.length, noun)}. Current ${formatStored(stats.current, metric, unit)}, best ${formatStored(stats.best, metric, unit)}, ${change}.`;
}
