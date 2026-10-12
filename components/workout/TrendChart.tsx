"use client";

import { pluralize } from "@/lib/format";
import {
  CHART_PLOT_HEIGHT,
  CHART_PLOT_TOP,
  areaPath,
  formatChartDate,
  formatChartDelta,
  formatChartSet,
  formatChartValue,
  gapThresholdMs,
  layoutDateTicks,
  linearTrend,
  monotonePath,
  nearestPointIndex,
  pointerMoved,
  pointerXInView,
  selectionAfter,
  seriesLayout,
  splitSegments,
  type ChartGesture,
  type ChartMetric,
  type ChartRange,
  type DateTick,
  type PlottedPoint,
  type ProgressPoint,
  type SeriesLayout,
  type TrendUnit,
  availableMetrics,
  buildSeries,
  defaultChartMetric,
  defaultChartRange,
  filterByRange,
  rangeStats,
} from "@/lib/progressChart";
import type { WeightUnit } from "@/convex/lib/units";
import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type RefObject } from "react";

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
  calories: { short: "Cals", name: "Calories" },
  body: { short: "Weight", name: "Weight" },
};

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
  series?: "effort" | "body";
};

type Gesture = {
  pointerId: number;
  origin: string | null;
  moved: boolean;
  startX: number;
  startY: number;
};

/**
 * Progress over real calendar time. Points land on their dates, same-day
 * sessions fold into one reading, and a tap reads that day above the plot.
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
  const seriesKind = series ?? (valueCaption === "Weight" ? "body" : "effort");
  const [rangeOverride, setRangeOverride] = useState<ChartRange | null>(null);
  const [metricOverride, setMetricOverride] = useState<ChartMetric | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [now] = useState(() => Date.now());
  const [width, setWidth] = useState(0);
  const frameRef = useRef<HTMLDivElement>(null);
  const figureRef = useRef<HTMLElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const layoutRef = useRef<SeriesLayout | null>(null);
  const selectedKeyRef = useRef<string | null>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const rawId = useId().replace(/:/g, "");
  const gradientId = `trend-${rawId}`;
  selectedKeyRef.current = selectedKey;

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
  const fallback = defaultChartMetric(metrics, recordUnit);
  const metric = metricOverride && metrics.includes(metricOverride) ? metricOverride : fallback;
  const zone = timeZone ?? "UTC";
  const ready = timeZone !== null;
  const fullSeries = useMemo(
    () => (ready ? buildSeries(points, metric, recordUnit, zone) : []),
    [metric, points, ready, recordUnit, zone],
  );
  const plotted = useMemo(() => filterByRange(fullSeries, range, now), [fullSeries, now, range]);
  const stats = rangeStats(plotted);
  const layout = useMemo(
    () => (ready && width > 0 ? seriesLayout(plotted, range, now, width, metric, weightUnit) : null),
    [metric, now, plotted, range, ready, weightUnit, width],
  );
  layoutRef.current = layout;
  const selectedIndex = selectedKey === null ? -1 : plotted.findIndex((point) => point.dayKey === selectedKey);
  const selected = selectedIndex >= 0 ? (plotted[selectedIndex] ?? null) : null;

  useEffect(() => {
    if (selectedKey !== null && !plotted.some((point) => point.dayKey === selectedKey)) {
      setSelectedKey(null);
    }
  }, [plotted, selectedKey]);

  useEffect(() => {
    if (selectedKey === null) return;
    const onPointerDown = (event: PointerEvent) => {
      const figure = figureRef.current;
      if (figure && event.target instanceof Node && figure.contains(event.target)) return;
      setSelectedKey(selectionAfter(selectedKey, { type: "outside" }));
    };
    const startY = window.scrollY;
    const onScroll = () => {
      if (Math.abs(window.scrollY - startY) < 2) return;
      setSelectedKey(selectionAfter(selectedKey, { type: "scroll" }));
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [selectedKey]);

  if (points.length === 0) return null;

  const metricCopy = METRIC_COPY[metric];
  const seriesName = valueCaption && metric === "body" ? valueCaption : metricCopy.name;
  const chartLabel = describeChart(plotted, seriesName, noun, weightUnit, metric, zone, stats);
  const setLabel = selected ? formatChartSet(selected.bestSet, metric, weightUnit) : null;
  const pointValue = selected ? formatChartValue(selected.value, metric, weightUnit) : "";
  const pointCaption = metricCaption(metric, valueCaption);
  const pointDetail = setLabel ? `${pointCaption} · ${setLabel}` : pointCaption;
  const dayHref = linkDays && selected ? `/history/day/${selected.dayKey}` : null;
  const valueText = selected
    ? `${formatChartDate(selected.startedAt, zone, true)}, ${pointValue}${setLabel ? `, ${setLabel}` : ""}${selected.pr ? ", personal record" : ""}`
    : chartLabel;

  function applySelection(action: ChartGesture) {
    setSelectedKey(selectionAfter(selectedKeyRef.current, action));
  }

  function keyAt(clientX: number): string | null {
    const svg = svgRef.current;
    const frame = layoutRef.current;
    if (!svg || !frame || frame.coords.length === 0) return null;
    const rect = svg.getBoundingClientRect();
    const viewWidth = svg.viewBox.baseVal.width || rect.width;
    const x = pointerXInView(clientX, rect.left, rect.width, viewWidth);
    const index = nearestPointIndex(frame.coords, x);
    return frame.coords[index]?.dayKey || null;
  }

  function finishGesture(clientX: number) {
    const gesture = gestureRef.current;
    gestureRef.current = null;
    if (!gesture) return;
    const key = keyAt(clientX);
    if (!key) return;
    applySelection(gesture.moved ? { type: "scrub", key } : { type: "tap", key });
  }

  function onPlotPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    gestureRef.current = {
      pointerId: event.pointerId,
      origin: selectedKeyRef.current,
      moved: false,
      startX: event.clientX,
      startY: event.clientY,
    };
  }

  function onPlotPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (!gesture.moved && pointerMoved(gesture.startX, gesture.startY, event.clientX, event.clientY)) {
      gesture.moved = true;
    }
    if (!gesture.moved) return;
    const key = keyAt(event.clientX);
    if (key) applySelection({ type: "scrub", key });
  }

  function onPlotPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (gestureRef.current?.pointerId !== event.pointerId) return;
    finishGesture(event.clientX);
  }

  function onKey(key: string) {
    if (key === "Escape") {
      setSelectedKey(null);
      return;
    }
    const last = plotted.length - 1;
    if (last < 0) return;
    let index = selectedIndex;
    if (index < 0) {
      index = key === "ArrowLeft" || key === "ArrowUp" || key === "Home" ? 0 : last;
    } else if (key === "ArrowRight" || key === "ArrowDown") index = Math.min(last, index + 1);
    else if (key === "ArrowLeft" || key === "ArrowUp") index = Math.max(0, index - 1);
    else if (key === "Home") index = 0;
    else if (key === "End") index = last;
    else return;
    const point = plotted[index];
    if (point) setSelectedKey(point.dayKey);
  }

  return (
    <figure ref={figureRef} className="mt-4 rounded-[1.25rem] border border-line bg-surface p-4 shadow-float">
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

        {selected ? (
          <div role="status" aria-live="polite" data-chart-readout="" className="mt-1 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm text-muted" suppressHydrationWarning>
                {formatChartDate(selected.startedAt, zone, true)}
                {selected.pr ? (
                  <span className="ml-2 text-xs font-semibold tracking-[0.05em] text-accent-ink uppercase">PR</span>
                ) : null}
              </p>
              <p className="mt-0.5 text-lg leading-tight font-medium tracking-[-0.03em] tabular-nums whitespace-nowrap">
                {pointValue}
              </p>
              <p className="mt-0.5 text-xs leading-snug text-muted">{pointDetail}</p>
            </div>
            {dayHref ? (
              <Link
                href={dayHref}
                className="inline-flex min-h-11 shrink-0 items-center text-base font-medium underline decoration-line underline-offset-4"
              >
                Open this day
              </Link>
            ) : null}
          </div>
        ) : stats ? (
          <div data-chart-stats="" className="mt-1 flex flex-wrap justify-between gap-x-3 gap-y-2">
            <Stat label="Current" value={formatChartValue(stats.current, metric, weightUnit)} />
            <Stat
              label={seriesKind === "body" ? "High" : "Best"}
              value={formatChartValue(stats.best, metric, weightUnit)}
            />
            <Stat
              label="Change"
              value={stats.delta === null ? "—" : formatChartDelta(stats.delta, metric, weightUnit)}
            />
          </div>
        ) : (
          <p className="mt-1 text-base text-muted">{emptyCopy(range, noun)}</p>
        )}

        {layout ? (
          <ChartPlot
            layout={layout}
            width={width}
            plotted={plotted}
            zone={zone}
            selectedIndex={selectedIndex}
            gradientId={gradientId}
            chartLabel={chartLabel}
            valueText={valueText}
            svgRef={svgRef}
            onPointerDown={onPlotPointerDown}
            onPointerMove={onPlotPointerMove}
            onPointerUp={onPlotPointerUp}
            onPointerCancel={onPlotPointerUp}
            onKey={onKey}
          />
        ) : stats ? (
          <div className="mt-2 h-44 rounded-xl bg-fill" aria-hidden />
        ) : null}

        {plotted.length === 1 ? (
          <p className="text-sm text-muted">One {noun} in this range. The line shows up after the next one.</p>
        ) : null}
      </div>
    </figure>
  );
}

function ChartPlot({
  layout,
  width,
  plotted,
  zone,
  selectedIndex,
  gradientId,
  chartLabel,
  valueText,
  svgRef,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onKey,
}: {
  layout: SeriesLayout;
  width: number;
  plotted: PlottedPoint[];
  zone: string;
  selectedIndex: number;
  gradientId: string;
  chartLabel: string;
  valueText: string;
  svgRef: RefObject<SVGSVGElement | null>;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onKey: (key: string) => void;
}) {
  const height = CHART_PLOT_TOP + CHART_PLOT_HEIGHT + 8;
  const baseline = CHART_PLOT_TOP + CHART_PLOT_HEIGHT;
  const { coords, yTicks, plotLeft, plotWidth, domain } = layout;
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
  const selectedCoord = selectedIndex >= 0 ? (coords[selectedIndex] ?? null) : null;

  return (
    <div
      className="mt-1 touch-none select-none"
      style={{ width }}
      role="slider"
      tabIndex={0}
      aria-label={chartLabel}
      aria-valuemin={0}
      aria-valuemax={Math.max(0, plotted.length - 1)}
      aria-valuenow={selectedIndex >= 0 ? selectedIndex : undefined}
      aria-valuetext={valueText}
      onKeyDown={(event) => {
        if (event.key === "Escape" || event.key.startsWith("Arrow") || event.key === "Home" || event.key === "End") {
          event.preventDefault();
          onKey(event.key);
        }
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      <div className="relative" style={{ height }}>
        {yTicks.map((tick) => (
          <span
            key={tick.label}
            className="pointer-events-none absolute text-right text-xs leading-none text-muted"
            style={{ left: 0, width: Math.max(0, plotLeft - 6), top: tick.y - 8 }}
          >
            {tick.label}
          </span>
        ))}
        <svg
          ref={svgRef}
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          className="block"
          aria-hidden
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.3" />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.02" />
            </linearGradient>
            <clipPath id={`${gradientId}-clip`}>
              <rect x={plotLeft} y={CHART_PLOT_TOP} width={plotWidth} height={CHART_PLOT_HEIGHT} />
            </clipPath>
          </defs>
          {yTicks.map((tick) => (
            <line key={tick.label} x1={plotLeft} x2={plotLeft + plotWidth} y1={tick.y} y2={tick.y} stroke="var(--line)" />
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
          {selectedCoord ? (
            <line
              data-guide=""
              x1={selectedCoord.x}
              x2={selectedCoord.x}
              y1={CHART_PLOT_TOP}
              y2={baseline}
              stroke="var(--accent)"
              strokeOpacity={0.35}
              strokeDasharray="3 4"
            />
          ) : null}
          {coords.map((coord, index) => {
            const point = plotted[index];
            if (!point) return null;
            const marked = index === selectedIndex;
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
                  data-selected={marked ? "true" : undefined}
                  data-day={point.dayKey}
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
    <div className="shrink-0">
      <p className="text-xs font-medium tracking-[0.06em] text-subtle uppercase">{label}</p>
      <p className="mt-0.5 text-lg leading-tight font-medium tracking-[-0.03em] tabular-nums whitespace-nowrap">{value}</p>
    </div>
  );
}

function metricCaption(metric: ChartMetric, valueCaption: string | undefined): string {
  if (metric === "body") return valueCaption ?? "Weight";
  if (metric === "epley") return "Est. 1RM";
  return METRIC_COPY[metric].short;
}

function dateTickStyle(tick: DateTick, width: number): CSSProperties {
  if (tick.anchor === "start") return { left: tick.x };
  if (tick.anchor === "end") return { right: Math.max(0, width - tick.x) };
  return { left: tick.x, transform: "translateX(-50%)" };
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
  const change = stats.delta === null ? "no change yet" : `change ${formatChartDelta(stats.delta, metric, unit)}`;
  return `${seriesName} from ${formatChartDate(first.startedAt, zone)} to ${formatChartDate(last.startedAt, zone)}, ${pluralize(plotted.length, noun)}. Current ${formatChartValue(stats.current, metric, unit)}, best ${formatChartValue(stats.best, metric, unit)}, ${change}.`;
}
