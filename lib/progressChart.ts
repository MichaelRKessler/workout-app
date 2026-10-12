import { M_PER_KM, M_PER_MI, formatCalories, formatClock } from "../convex/lib/measures";
import { fromPounds, type WeightUnit } from "../convex/lib/units";
import { formatVolumeLb, pluralize } from "./format";
import { calendarDayBounds, calendarDayKey, parseDayKey } from "./historyDays";

const DAY_MS = 24 * 60 * 60 * 1000;

/** About one calendar month. The "1 month" chart range. */
export const ONE_MONTH_MS = 31 * DAY_MS;

/** About three calendar months, used as the chart's default window. */
export const THREE_MONTHS_MS = 92 * DAY_MS;

/** About six calendar months. The "6 month" chart range. */
export const SIX_MONTHS_MS = 183 * DAY_MS;

/** A non-leap year. The "1 year" chart range. */
export const ONE_YEAR_MS = 365 * DAY_MS;

/**
 * Horizontal padding of the history and body pages (`px-5`) at the app's
 * spacing scale, in CSS pixels. Axis tests use this so labels are checked at
 * the width a 360–412px phone actually gives the chart.
 */
export const CHART_PAGE_GUTTER_PX = 45;

/** Padding inside the chart card (`p-4`) on both sides, in CSS pixels. */
export const CHART_CARD_GUTTER_PX = 36;

/** Axis labels use the app's 16px caption size. */
export const AXIS_FONT_PX = 16;

/** Plot box inside the chart SVG. The component draws the guide from these. */
export const CHART_PLOT_TOP = 10;
export const CHART_PLOT_HEIGHT = 148;
export const CHART_PLOT_RIGHT = 8;

/** A finger this far from pointer-down is a scrub, not a tap. */
export const CHART_TAP_SLOP_PX = 10;

/** Minimum space between date labels so 16px type does not collide. */
export const TICK_GAP_PX = 8;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

const TIME_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 10800, 14400];

export type ChartRange = "1m" | "3m" | "6m" | "1y" | "all";

export type ChartMetric = "epley" | "weight" | "volume" | "reps" | "time" | "distance" | "calories" | "body";

export type TrendUnit = "lb" | "reps" | "m" | "sec";

export type ChartSeries = "effort" | "body";

export type ChartSetSnap = {
  reps: number | null;
  weightLb: number;
  durationSec: number | null;
  distanceM: number | null;
};

export type ProgressPoint = {
  sessionId: string;
  startedAt: number;
  /** Primary record metric from the server. Null when every set was a warm-up or drop. */
  value: number | null;
  volumeLb: number;
  topWeightLb?: number | null;
  epleyLb?: number | null;
  reps?: number | null;
  durationSec?: number | null;
  distanceM?: number | null;
  /** Record-eligible calories in the workout. Absent on older points. */
  calories?: number | null;
  bestEpleySet?: ChartSetSnap | null;
  bestWeightSet?: ChartSetSnap | null;
  bestRepsSet?: ChartSetSnap | null;
  bestDurationSet?: ChartSetSnap | null;
  bestDistanceSet?: ChartSetSnap | null;
};

export type PlottedPoint = {
  sessionId: string;
  startedAt: number;
  dayKey: string;
  /** Stored units: pounds, reps, seconds, or meters. */
  value: number;
  bestSet: ChartSetSnap | null;
  /** True when this day beat every earlier day for the active metric. */
  pr: boolean;
};

export type DateTick = {
  time: number;
  label: string;
  x: number;
  anchor: "start" | "middle" | "end";
};

export type YScale = {
  min: number;
  max: number;
  ticks: number[];
};

export type PreparedScale = {
  scale: YScale;
  toDisplay: (stored: number) => number;
  /** Short unit drawn on the top gridline, such as "lb" or "km". */
  caption: string;
  tickKind: "number" | "time";
};

export function rangeWindow(range: Exclude<ChartRange, "all">): number {
  if (range === "1m") return ONE_MONTH_MS;
  if (range === "3m") return THREE_MONTHS_MS;
  if (range === "6m") return SIX_MONTHS_MS;
  return ONE_YEAR_MS;
}

/**
 * Recent training opens on 3 months. A short history, or a last session older
 * than that, opens on everything so the chart is not an empty window.
 */
export function defaultChartRange(points: Array<{ startedAt: number }>, now: number): ChartRange {
  const times = points.map((point) => point.startedAt).filter((time) => Number.isFinite(time));
  if (times.length === 0) return "3m";
  const newest = Math.max(...times);
  const oldest = Math.min(...times);
  if (newest < now - THREE_MONTHS_MS) return "all";
  if (newest - oldest <= 45 * DAY_MS) return "all";
  return "3m";
}

export function filterByRange<T extends { startedAt: number }>(
  points: T[],
  range: ChartRange,
  now: number,
): T[] {
  if (range === "all") return points;
  const start = now - rangeWindow(range);
  return points.filter((point) => point.startedAt >= start);
}

/** Record series drops workouts whose only sets were warm-ups or drops. */
export function recordPoints<T extends { value: number | null }>(
  points: T[],
): Array<T & { value: number }> {
  return points.flatMap((point) => (point.value === null ? [] : [{ ...point, value: point.value }]));
}

export function chartDomain(
  range: ChartRange,
  points: Array<{ startedAt: number }>,
  now: number,
): { start: number; end: number } | null {
  if (range !== "all") {
    return { start: now - rangeWindow(range), end: now };
  }
  const times = points.map((point) => point.startedAt).filter((time) => Number.isFinite(time));
  if (times.length === 0) return null;
  const start = Math.min(...times);
  const end = Math.max(...times);
  if (end - start < DAY_MS) {
    return { start: start - 3 * DAY_MS, end: end + 3 * DAY_MS };
  }
  const pad = Math.max(DAY_MS, (end - start) * 0.03);
  return { start: start - pad, end: end + pad };
}

/** Map a timestamp onto the plot. Position follows the date, not the point index. */
export function timeToX(
  time: number,
  domain: { start: number; end: number },
  plotLeft: number,
  plotWidth: number,
): number {
  const span = domain.end - domain.start;
  if (!(span > 0) || !(plotWidth > 0)) return plotLeft + plotWidth / 2;
  const ratio = Math.min(1, Math.max(0, (time - domain.start) / span));
  return plotLeft + ratio * plotWidth;
}

export function valueToY(display: number, scale: YScale, plotTop: number, plotHeight: number): number {
  const span = scale.max - scale.min || 1;
  const ratio = (display - scale.min) / span;
  return plotTop + (1 - ratio) * plotHeight;
}

/**
 * Map a pointer into the SVG's viewBox. Using the rendered width keeps a
 * scaled plot from selecting a point toward the y-axis.
 */
export function pointerXInView(
  clientX: number,
  rectLeft: number,
  rectWidth: number,
  viewWidth: number,
): number {
  if (!(rectWidth > 0) || !(viewWidth > 0)) return 0;
  return ((clientX - rectLeft) / rectWidth) * viewWidth;
}

export function pointerMoved(startX: number, startY: number, x: number, y: number): boolean {
  const dx = x - startX;
  const dy = y - startY;
  return dx * dx + dy * dy > CHART_TAP_SLOP_PX * CHART_TAP_SLOP_PX;
}

export type ChartGesture =
  | { type: "tap"; key: string }
  | { type: "scrub"; key: string }
  | { type: "outside" }
  | { type: "scroll" };

/**
 * Nothing is selected until a gesture says so. A second tap on the same day
 * clears it. Dragging keeps the day under the finger. A tap outside the chart
 * or a page scroll returns to the summary.
 */
export function selectionAfter(current: string | null, action: ChartGesture): string | null {
  if (action.type === "outside" || action.type === "scroll") return null;
  if (action.type === "scrub") return action.key;
  return current === action.key ? null : action.key;
}

export function nearestPointIndex(coords: Array<{ x: number }>, x: number): number {
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < coords.length; index += 1) {
    const point = coords[index];
    if (!point) continue;
    const distance = Math.abs(point.x - x);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  }
  return best;
}

/**
 * Width of a date label in the app's sans at `fontSize`. Slightly generous so
 * a tick that passes this check still clears its neighbor at 16px.
 */
export function estimateLabelWidth(label: string, fontSize = AXIS_FONT_PX): number {
  let em = 0;
  for (const char of label) {
    if (char === " ") em += 0.34;
    else if (char >= "0" && char <= "9") em += 0.62;
    else if (char === "'" || char === "." || char === ",") em += 0.3;
    else em += 0.62;
  }
  return em * fontSize;
}

export function plotSizeAtViewport(
  viewport: number,
  yGutter: number,
): { plotLeft: number; plotWidth: number; chartWidth: number } {
  const chartWidth = Math.max(0, viewport - CHART_PAGE_GUTTER_PX - CHART_CARD_GUTTER_PX);
  const plotLeft = yGutter;
  const plotWidth = Math.max(0, chartWidth - yGutter - 8);
  return { plotLeft, plotWidth, chartWidth };
}

export function layoutDateTicks(
  domainStart: number,
  domainEnd: number,
  plotLeft: number,
  plotWidth: number,
  timeZone = "UTC",
  fontSize = AXIS_FONT_PX,
): DateTick[] {
  if (!(plotWidth > 0) || !(domainEnd > domainStart)) return [];
  const span = domainEnd - domainStart;
  const style = tickStyle(span);
  const times = dropEdgeSlivers(
    candidateTimes(style, domainStart, domainEnd, timeZone),
    domainStart,
    domainEnd,
    timeZone,
    style,
  );
  const years = new Set(times.map((time) => calendarDayKey(time, timeZone).slice(0, 4)));
  const withYear = style !== "day" && style !== "year" && years.size > 1;
  const plotRight = plotLeft + plotWidth;
  const domain = { start: domainStart, end: domainEnd };
  const candidates = dedupeTimes(times).map((time) => ({
    time,
    label: tickLabel(time, style, withYear, timeZone),
    x: timeToX(time, domain, plotLeft, plotWidth),
  }));
  if (candidates.length === 0) {
    const time = domainStart;
    const single = assignAnchor(
      {
        time,
        label: tickLabel(time, "day", false, timeZone),
        x: timeToX(time, domain, plotLeft, plotWidth),
        anchor: "middle" as const,
      },
      plotLeft,
      plotRight,
      fontSize,
    );
    return ticksFit([single], plotLeft, plotRight, fontSize) ? [single] : [];
  }
  for (let count = candidates.length; count >= 1; count -= 1) {
    const placed = sampleEven(candidates, count).map((tick) =>
      assignAnchor({ ...tick, anchor: "middle" }, plotLeft, plotRight, fontSize),
    );
    if (ticksFit(placed, plotLeft, plotRight, fontSize)) return placed;
  }
  return [];
}

export function dateTickBoxes(
  ticks: DateTick[],
  fontSize = AXIS_FONT_PX,
): Array<{ left: number; right: number }> {
  return ticks.map((tick) => tickBox(tick, fontSize));
}

export function niceYScale(
  values: number[],
  options?: { integers?: boolean; time?: boolean },
): YScale {
  const finite = values.filter((value) => Number.isFinite(value));
  if (finite.length === 0) return { min: 0, max: 1, ticks: [0, 1] };
  const dataMin = Math.min(...finite);
  const dataMax = Math.max(...finite);
  const nonNegative = dataMin >= 0;

  if (dataMin === dataMax) {
    let step = niceNumber(Math.abs(dataMin) * 0.1 || 1, true);
    if (options?.time) step = niceTimeStep(step);
    if (options?.integers) step = Math.max(1, Math.ceil(step - 1e-9));
    let min = dataMin - step;
    const max = dataMin + step;
    if (nonNegative && min < 0) min = 0;
    const ticks = buildTicks(min, max, step);
    return finishScale(ticks, min, max);
  }

  let scale = scaleBetween(dataMin, dataMax, 4, options, nonNegative);
  for (const target of [3, 2]) {
    if (scale.ticks.length <= 6) break;
    scale = scaleBetween(dataMin, dataMax, target, options, nonNegative);
  }
  return scale;
}

export function prepareYScale(
  storedValues: number[],
  metric: ChartMetric,
  unit: WeightUnit,
): PreparedScale {
  const finite = storedValues.filter((value) => Number.isFinite(value));
  if (metric === "time") {
    return {
      scale: niceYScale(finite, { time: true }),
      toDisplay: (value) => value,
      caption: "",
      tickKind: "time",
    };
  }
  if (metric === "reps") {
    return {
      scale: niceYScale(finite, { integers: true }),
      toDisplay: (value) => value,
      caption: "reps",
      tickKind: "number",
    };
  }
  if (metric === "calories") {
    return {
      scale: niceYScale(finite, { integers: true }),
      toDisplay: (value) => value,
      caption: "cal",
      tickKind: "number",
    };
  }
  if (metric === "distance") {
    const max = finite.length > 0 ? Math.max(...finite) : 0;
    const divisor = max >= M_PER_MI ? M_PER_MI : max >= 1000 ? 1000 : 1;
    const caption = divisor === M_PER_MI ? "mi" : divisor === 1000 ? "km" : "m";
    return {
      scale: niceYScale(finite.map((value) => value / divisor)),
      toDisplay: (value) => value / divisor,
      caption,
      tickKind: "number",
    };
  }
  return {
    scale: niceYScale(finite.map((value) => fromPounds(value, unit))),
    toDisplay: (value) => fromPounds(value, unit),
    caption: unit,
    tickKind: "number",
  };
}

export function yAxisLabels(prepared: PreparedScale): string[] {
  return prepared.scale.ticks.map((tick, index, all) => {
    const text = formatYTick(tick, prepared.tickKind);
    if (index === all.length - 1 && prepared.caption) return `${text} ${prepared.caption}`;
    return text;
  });
}

export function yAxisGutter(prepared: PreparedScale, width: number): number {
  const labels = yAxisLabels(prepared);
  const widest = labels.reduce((max, label) => Math.max(max, estimateLabelWidth(label, AXIS_FONT_PX)), 0);
  return Math.min(width * 0.46, Math.max(44, widest + 8));
}

export type SeriesLayout = {
  domain: { start: number; end: number };
  plotLeft: number;
  plotWidth: number;
  coords: Array<{ x: number; y: number; dayKey: string }>;
  yTicks: Array<{ y: number; label: string }>;
};

/** One layout for the dots, the guide line, and hit testing. */
export function seriesLayout(
  plotted: Array<{ startedAt: number; value: number; dayKey?: string }>,
  range: ChartRange,
  now: number,
  width: number,
  metric: ChartMetric,
  unit: WeightUnit,
): SeriesLayout | null {
  const domain = chartDomain(range, plotted, now);
  if (!domain || !(width > 0) || plotted.length === 0) return null;
  const prepared = prepareYScale(
    plotted.map((point) => point.value),
    metric,
    unit,
  );
  const plotLeft = yAxisGutter(prepared, width);
  const plotWidth = Math.max(32, width - plotLeft - CHART_PLOT_RIGHT);
  const coords = plotted.map((point) => ({
    x: timeToX(point.startedAt, domain, plotLeft, plotWidth),
    y: valueToY(prepared.toDisplay(point.value), prepared.scale, CHART_PLOT_TOP, CHART_PLOT_HEIGHT),
    dayKey: point.dayKey ?? "",
  }));
  const labels = yAxisLabels(prepared);
  const yTicks = prepared.scale.ticks.map((tick, index) => ({
    y: valueToY(tick, prepared.scale, CHART_PLOT_TOP, CHART_PLOT_HEIGHT),
    label: labels[index] ?? "",
  }));
  return { domain, plotLeft, plotWidth, coords, yTicks };
}

export function formatYTick(value: number, kind: "number" | "time"): string {
  if (!Number.isFinite(value)) return "";
  if (kind === "time") return formatClock(value);
  const abs = Math.abs(value);
  if (abs >= 10000) {
    const thousands = Math.round((value / 1000) * 10) / 10;
    return `${thousands}k`;
  }
  if (Math.abs(value - Math.round(value)) < 1e-6) return String(Math.round(value));
  return String(Math.round(value * 10) / 10);
}

const chartDateFormatters = new Map<string, Intl.DateTimeFormat>();

export function formatChartDate(timestamp: number, timeZone: string, withWeekday = false): string {
  const key = `${timeZone}:${withWeekday ? "weekday" : "day"}`;
  let formatter = chartDateFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: withWeekday ? "short" : undefined,
      month: "short",
      day: "numeric",
    });
    chartDateFormatters.set(key, formatter);
  }
  return formatter.format(timestamp);
}

const CHART_MINUS = "−";

/** Whole pounds, or the nearest 0.5 kg. Chart readouts only; logged sets stay exact. */
function roundChartWeight(weightLb: number, unit: WeightUnit): number {
  const display = fromPounds(Math.abs(weightLb), unit);
  if (unit === "kg") return Math.round(display * 2) / 2;
  return Math.round(display);
}

function formatChartWeight(weightLb: number, unit: WeightUnit): string {
  if (weightLb === 0) return "bodyweight";
  const rounded = roundChartWeight(weightLb, unit);
  if (rounded === 0) return `0 ${unit}`;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${text} ${unit}`;
}

function formatChartDistance(meters: number): string {
  const safe = Math.abs(meters);
  const miles = safe / M_PER_MI;
  const milesRounded = Math.round(miles * 100) / 100;
  if (milesRounded >= 0.1 && Math.abs(milesRounded * M_PER_MI - safe) <= 1) {
    return `${milesRounded.toFixed(2)} mi`;
  }
  if (safe >= M_PER_KM) {
    return `${(Math.round((safe / M_PER_KM) * 100) / 100).toFixed(2)} km`;
  }
  return `${(Math.round(safe * 100) / 100).toFixed(2)} m`;
}

/** Magnitude used for a change, where 0 lb is zero rather than bodyweight. */
function formatChartMagnitude(value: number, metric: ChartMetric, unit: WeightUnit): string {
  if (metric === "epley" || metric === "weight" || metric === "body") {
    const rounded = roundChartWeight(value, unit);
    if (rounded === 0) return `0 ${unit}`;
    const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
    return `${text} ${unit}`;
  }
  return formatChartValue(value, metric, unit);
}

export function formatChartValue(value: number, metric: ChartMetric, unit: WeightUnit): string {
  if (!Number.isFinite(value)) return "";
  if (metric === "volume") return formatVolumeLb(value, unit);
  if (metric === "epley" || metric === "weight" || metric === "body") return formatChartWeight(value, unit);
  if (metric === "reps") return pluralize(Math.round(value), "rep");
  if (metric === "time") return formatClock(value);
  if (metric === "calories") return formatCalories(value);
  return formatChartDistance(value);
}

export function formatChartDelta(delta: number, metric: ChartMetric, unit: WeightUnit): string {
  if (!Number.isFinite(delta)) return "";
  const magnitude = formatChartMagnitude(Math.abs(delta), metric, unit);
  const zero = formatChartMagnitude(0, metric, unit);
  if (magnitude === zero) return zero;
  return delta > 0 ? `+${magnitude}` : `${CHART_MINUS}${magnitude}`;
}

export function formatChartSet(set: ChartSetSnap | null, metric: ChartMetric, unit: WeightUnit): string | null {
  if (!set || metric === "body" || metric === "calories") return null;
  if (metric === "time") {
    const clock = formatClock(set.durationSec ?? 0);
    return set.weightLb > 0 ? `${clock} @ ${formatChartWeight(set.weightLb, unit)}` : clock;
  }
  if (metric === "distance") {
    const distance = formatChartDistance(set.distanceM ?? 0);
    return set.durationSec ? `${distance} in ${formatClock(set.durationSec)}` : distance;
  }
  if ((set.reps ?? 0) <= 0) return null;
  if (set.weightLb <= 0) return `${set.reps}×BW`;
  return `${set.reps}×${formatChartWeight(set.weightLb, unit)}`;
}

export function metricValue(
  point: ProgressPoint,
  metric: ChartMetric,
  recordUnit: TrendUnit,
): number | null {
  switch (metric) {
    case "body":
      return finiteOrNull(point.value);
    case "epley":
      if (point.epleyLb != null) return finiteOrNull(point.epleyLb);
      return recordUnit === "lb" ? finiteOrNull(point.value) : null;
    case "weight":
      return point.topWeightLb != null && point.topWeightLb > 0 ? point.topWeightLb : null;
    case "volume":
      return point.volumeLb > 0 ? point.volumeLb : null;
    case "reps":
      if (point.reps != null && point.reps > 0) return point.reps;
      return recordUnit === "reps" ? finiteOrNull(point.value) : null;
    case "time":
      if (point.durationSec != null && point.durationSec > 0) return point.durationSec;
      return recordUnit === "sec" ? finiteOrNull(point.value) : null;
    case "distance":
      if (point.distanceM != null && point.distanceM > 0) return point.distanceM;
      return recordUnit === "m" ? finiteOrNull(point.value) : null;
    case "calories":
      return point.calories != null && point.calories > 0 ? point.calories : null;
    default: {
      const unreachable: never = metric;
      return unreachable;
    }
  }
}

export function bestSetFor(point: ProgressPoint, metric: ChartMetric): ChartSetSnap | null {
  if (metric === "epley") return point.bestEpleySet ?? null;
  if (metric === "weight") return point.bestWeightSet ?? null;
  if (metric === "reps") return point.bestRepsSet ?? null;
  if (metric === "time") return point.bestDurationSet ?? null;
  if (metric === "distance") return point.bestDistanceSet ?? null;
  if (metric === "volume") return point.bestWeightSet ?? point.bestEpleySet ?? point.bestRepsSet ?? null;
  return null;
}

export function availableMetrics(
  points: ProgressPoint[],
  recordUnit: TrendUnit,
  series: ChartSeries,
): ChartMetric[] {
  if (series === "body") return ["body"];
  const has = (metric: ChartMetric) =>
    points.some((point) => metricValue(point, metric, recordUnit) !== null);
  const metrics: ChartMetric[] = [];
  if (recordUnit === "lb" && has("epley")) metrics.push("epley");
  if (has("weight")) metrics.push("weight");
  if (has("volume")) metrics.push("volume");
  if (recordUnit === "reps" && has("reps")) metrics.push("reps");
  if (recordUnit === "sec" || recordUnit === "m") {
    if (has("calories")) metrics.push("calories");
    if (recordUnit === "sec" && has("time")) metrics.push("time");
    if (recordUnit === "m" && has("distance")) metrics.push("distance");
    return metrics;
  }
  if (has("calories")) metrics.push("calories");
  return metrics;
}

/** Cardio with calories opens on that total. Lifting keeps its first strength metric. */
export function defaultChartMetric(metrics: ChartMetric[], recordUnit: TrendUnit): ChartMetric {
  if ((recordUnit === "m" || recordUnit === "sec") && metrics.includes("calories")) {
    return "calories";
  }
  return metrics[0] ?? "epley";
}

/**
 * One point per local day. Strength metrics keep the day's best, volume adds
 * the sessions, and a weigh-in keeps the latest reading.
 */
export function buildSeries(
  points: ProgressPoint[],
  metric: ChartMetric,
  recordUnit: TrendUnit,
  timeZone: string,
): PlottedPoint[] {
  const raw: RawPoint[] = [];
  for (const point of points) {
    const value = metricValue(point, metric, recordUnit);
    if (value === null) continue;
    raw.push({
      sessionId: point.sessionId,
      startedAt: point.startedAt,
      value,
      bestSet: bestSetFor(point, metric),
    });
  }
  raw.sort((left, right) => left.startedAt - right.startedAt || compareId(left.sessionId, right.sessionId));
  const mode = metric === "volume" || metric === "calories" ? "sum" : metric === "body" ? "latest" : "max";
  const combined = combineByDay(raw, timeZone, mode);
  const marked = metric === "body" ? combined.map((point) => ({ ...point, pr: false })) : markRecords(combined);
  return marked.map((point) => ({
    ...point,
    dayKey: calendarDayKey(point.startedAt, timeZone),
  }));
}

export function rangeStats(points: Array<{ value: number }>): {
  current: number;
  best: number;
  delta: number | null;
} | null {
  const last = points[points.length - 1];
  const first = points[0];
  if (!last || !first) return null;
  let best = last.value;
  for (const point of points) {
    if (point.value > best) best = point.value;
  }
  return {
    current: last.value,
    best,
    delta: points.length < 2 ? null : last.value - first.value,
  };
}

/** Break the line across a layoff so a long gap does not look like steady progress. */
export function gapThresholdMs(domainStart: number, domainEnd: number): number {
  const span = Math.max(domainEnd - domainStart, DAY_MS);
  return Math.min(45 * DAY_MS, Math.max(14 * DAY_MS, span * 0.18));
}

export function splitSegments<T extends { startedAt: number }>(points: T[], thresholdMs: number): T[][] {
  const groups: T[][] = [];
  for (const point of points) {
    const last = groups[groups.length - 1];
    const previous = last?.[last.length - 1];
    if (!last || !previous || point.startedAt - previous.startedAt > thresholdMs) {
      groups.push([point]);
    } else {
      last.push(point);
    }
  }
  return groups;
}

/** Monotone cubic so the curve stays smooth without overshooting a day's value. */
export function monotonePath(points: Array<{ x: number; y: number }>): string {
  const first = points[0];
  if (!first) return "";
  if (points.length === 1) return `M ${roundCoord(first.x)} ${roundCoord(first.y)}`;
  const second = points[1];
  if (points.length === 2 && second) {
    return `M ${roundCoord(first.x)} ${roundCoord(first.y)} L ${roundCoord(second.x)} ${roundCoord(second.y)}`;
  }
  const slopes = monotoneSlopes(points);
  let path = `M ${roundCoord(first.x)} ${roundCoord(first.y)}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const from = points[index];
    const to = points[index + 1];
    if (!from || !to) continue;
    const width = to.x - from.x;
    if (width < 0.5) {
      path += ` L ${roundCoord(to.x)} ${roundCoord(to.y)}`;
      continue;
    }
    const slopeStart = slopes[index] ?? 0;
    const slopeEnd = slopes[index + 1] ?? 0;
    const c1x = from.x + width / 3;
    const c1y = from.y + (slopeStart * width) / 3;
    const c2x = to.x - width / 3;
    const c2y = to.y - (slopeEnd * width) / 3;
    path += ` C ${roundCoord(c1x)} ${roundCoord(c1y)} ${roundCoord(c2x)} ${roundCoord(c2y)} ${roundCoord(to.x)} ${roundCoord(to.y)}`;
  }
  return path;
}

export function areaPath(line: string, points: Array<{ x: number; y: number }>, baseline: number): string {
  const first = points[0];
  const last = points[points.length - 1];
  if (!line || !first || !last || points.length < 2) return "";
  return `${line} L ${roundCoord(last.x)} ${roundCoord(baseline)} L ${roundCoord(first.x)} ${roundCoord(baseline)} Z`;
}

export function linearTrend(
  points: Array<{ x: number; y: number }>,
): { x1: number; y1: number; x2: number; y2: number } | null {
  if (points.length < 3) return null;
  let sumX = 0;
  let sumY = 0;
  let sumXX = 0;
  let sumXY = 0;
  for (const point of points) {
    sumX += point.x;
    sumY += point.y;
    sumXX += point.x * point.x;
    sumXY += point.x * point.y;
  }
  const count = points.length;
  const denom = count * sumXX - sumX * sumX;
  if (Math.abs(denom) < 1e-6) return null;
  const slope = (count * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / count;
  const first = points[0];
  const last = points[count - 1];
  if (!first || !last) return null;
  return {
    x1: first.x,
    y1: slope * first.x + intercept,
    x2: last.x,
    y2: slope * last.x + intercept,
  };
}

type RawPoint = {
  sessionId: string;
  startedAt: number;
  value: number;
  bestSet: ChartSetSnap | null;
};

type TickStyle = "day" | "month" | "quarter" | "year";

function finiteOrNull(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return value;
}

function compareId(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function combineByDay(points: RawPoint[], timeZone: string, mode: "max" | "sum" | "latest"): RawPoint[] {
  const order: string[] = [];
  const groups = new Map<string, RawPoint[]>();
  for (const point of points) {
    const key = calendarDayKey(point.startedAt, timeZone);
    const group = groups.get(key);
    if (group) {
      group.push(point);
    } else {
      groups.set(key, [point]);
      order.push(key);
    }
  }
  const combined: RawPoint[] = [];
  for (const key of order) {
    const group = groups.get(key);
    if (!group || group.length === 0) continue;
    const only = group[0];
    if (group.length === 1 && only) {
      combined.push(only);
      continue;
    }
    if (mode === "latest") {
      combined.push(group.reduce((best, point) => (point.startedAt >= best.startedAt ? point : best)));
      continue;
    }
    if (mode === "sum") {
      const host = group.reduce((best, point) => (point.value > best.value ? point : best));
      const latest = group.reduce((best, point) => (point.startedAt >= best.startedAt ? point : best));
      combined.push({
        sessionId: latest.sessionId,
        startedAt: latest.startedAt,
        value: Math.round(group.reduce((sum, point) => sum + point.value, 0) * 100) / 100,
        bestSet: host.bestSet,
      });
      continue;
    }
    combined.push(
      group.reduce((best, point) => {
        if (point.value > best.value) return point;
        if (point.value === best.value && point.startedAt > best.startedAt) return point;
        return best;
      }),
    );
  }
  return combined;
}

function markRecords(points: RawPoint[]): Array<RawPoint & { pr: boolean }> {
  let best = Number.NEGATIVE_INFINITY;
  return points.map((point) => {
    const pr = point.value > best;
    if (pr) best = point.value;
    return { ...point, pr };
  });
}

function tickStyle(spanMs: number): TickStyle {
  const days = spanMs / DAY_MS;
  if (days <= 100) return "day";
  if (days <= 420) return "month";
  if (days <= 1200) return "quarter";
  return "year";
}

function candidateTimes(style: TickStyle, start: number, end: number, timeZone: string): number[] {
  if (style === "day") return dayTimes(start, end, timeZone);
  if (style === "year") return monthTimes(start, end, timeZone, (month) => month === 1);
  if (style === "quarter") return monthTimes(start, end, timeZone, (month) => month % 3 === 1);
  return monthTimes(start, end, timeZone, () => true);
}

function dayTimes(start: number, end: number, timeZone: string): number[] {
  const times: number[] = [];
  let key = calendarDayKey(start, timeZone);
  for (let guard = 0; guard < 420; guard += 1) {
    const bounds = calendarDayBounds(key, timeZone);
    if (!bounds || bounds.start > end) break;
    if (bounds.start >= start && bounds.start <= end) times.push(bounds.start);
    const next = shiftDayKey(key, 1);
    if (!next || next === key) break;
    key = next;
  }
  return times;
}

function monthTimes(
  start: number,
  end: number,
  timeZone: string,
  include: (month: number) => boolean,
): number[] {
  const times: number[] = [];
  const startKey = calendarDayKey(start, timeZone);
  const endKey = calendarDayKey(end, timeZone);
  let year = Number(startKey.slice(0, 4));
  let month = Number(startKey.slice(5, 7));
  const endYear = Number(endKey.slice(0, 4));
  const endMonth = Number(endKey.slice(5, 7));
  for (let guard = 0; guard < 80; guard += 1) {
    if (include(month)) {
      const monthKey = `${year}-${String(month).padStart(2, "0")}-01`;
      const bounds = calendarDayBounds(monthKey, timeZone);
      if (bounds) {
        const tick = Math.min(end, Math.max(bounds.start, start));
        if (tick >= start && tick <= end) times.push(tick);
      }
    }
    if (year === endYear && month === endMonth) break;
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return times;
}

function shiftDayKey(dayKey: string, days: number): string | null {
  const date = parseDayKey(dayKey);
  if (!date) return null;
  const probe = new Date(Date.UTC(date.year, date.month - 1, date.day));
  probe.setUTCDate(probe.getUTCDate() + days);
  const month = String(probe.getUTCMonth() + 1).padStart(2, "0");
  const day = String(probe.getUTCDate()).padStart(2, "0");
  return `${probe.getUTCFullYear()}-${month}-${day}`;
}

/** A padded domain can clip a day of the previous month. Don't label that sliver. */
function dropEdgeSlivers(
  times: number[],
  start: number,
  end: number,
  timeZone: string,
  style: TickStyle,
): number[] {
  if (style === "day") return times;
  const minimum = style === "year" ? 60 * DAY_MS : 10 * DAY_MS;
  return times.filter((time) => {
    const key = calendarDayKey(time, timeZone);
    const year = Number(key.slice(0, 4));
    const month = Number(key.slice(5, 7));
    const bucketStartKey = style === "year" ? `${year}-01-01` : `${year}-${String(month).padStart(2, "0")}-01`;
    const bucketStart = calendarDayBounds(bucketStartKey, timeZone)?.start ?? time;
    const nextKey =
      style === "year"
        ? `${year + 1}-01-01`
        : month === 12
          ? `${year + 1}-01-01`
          : `${year}-${String(month + 1).padStart(2, "0")}-01`;
    const bucketEnd = calendarDayBounds(nextKey, timeZone)?.start ?? end;
    const visibleStart = Math.max(bucketStart, start);
    const visibleEnd = Math.min(bucketEnd, end);
    return visibleEnd - visibleStart >= minimum;
  });
}

function dedupeTimes(times: number[]): number[] {
  const seen = new Set<number>();
  const unique: number[] = [];
  for (const time of times) {
    if (seen.has(time)) continue;
    seen.add(time);
    unique.push(time);
  }
  return unique;
}

function tickLabel(time: number, style: TickStyle, withYear: boolean, timeZone: string): string {
  const key = calendarDayKey(time, timeZone);
  const year = key.slice(0, 4);
  const month = Number(key.slice(5, 7));
  const day = Number(key.slice(8, 10));
  const name = MONTHS[month - 1] ?? "";
  if (style === "year") return year;
  if (style === "day") return `${name} ${day}`;
  if (withYear) return `${name} '${year.slice(2)}`;
  return name;
}

function sampleEven<T>(items: T[], count: number): T[] {
  if (count >= items.length) return items.slice();
  if (count <= 1) {
    const middle = items[Math.floor(items.length / 2)];
    return middle ? [middle] : [];
  }
  const chosen: T[] = [];
  let previous = -1;
  for (let index = 0; index < count; index += 1) {
    const pick = Math.round((index * (items.length - 1)) / (count - 1));
    if (pick === previous) continue;
    previous = pick;
    const item = items[pick];
    if (item) chosen.push(item);
  }
  return chosen;
}

function assignAnchor(tick: DateTick, plotLeft: number, plotRight: number, fontSize: number): DateTick {
  const order: Array<DateTick["anchor"]> = ["middle", "start", "end"];
  for (const anchor of order) {
    const next = { ...tick, anchor };
    const box = tickBox(next, fontSize);
    if (box.left >= plotLeft - 0.5 && box.right <= plotRight + 0.5) return next;
  }
  const width = estimateLabelWidth(tick.label, fontSize);
  return { ...tick, anchor: tick.x - width / 2 < plotLeft ? "start" : "end" };
}

function tickBox(tick: DateTick, fontSize: number): { left: number; right: number } {
  const width = estimateLabelWidth(tick.label, fontSize);
  if (tick.anchor === "start") return { left: tick.x, right: tick.x + width };
  if (tick.anchor === "end") return { left: tick.x - width, right: tick.x };
  return { left: tick.x - width / 2, right: tick.x + width / 2 };
}

function ticksFit(ticks: DateTick[], plotLeft: number, plotRight: number, fontSize: number): boolean {
  const boxes = ticks.map((tick) => tickBox(tick, fontSize)).sort((left, right) => left.left - right.left);
  for (const box of boxes) {
    if (box.left < plotLeft - 0.5 || box.right > plotRight + 0.5) return false;
  }
  for (let index = 1; index < boxes.length; index += 1) {
    const previous = boxes[index - 1];
    const current = boxes[index];
    if (!previous || !current) continue;
    if (current.left < previous.right + TICK_GAP_PX - 0.5) return false;
  }
  return true;
}

function niceNumber(range: number, round: boolean): number {
  if (!(range > 0) || !Number.isFinite(range)) return 1;
  const exponent = Math.floor(Math.log10(range));
  const fraction = range / 10 ** exponent;
  let nice: number;
  if (round) {
    if (fraction < 1.5) nice = 1;
    else if (fraction < 3) nice = 2;
    else if (fraction < 7) nice = 5;
    else nice = 10;
  } else if (fraction <= 1) nice = 1;
  else if (fraction <= 2) nice = 2;
  else if (fraction <= 5) nice = 5;
  else nice = 10;
  return nice * 10 ** exponent;
}

function niceTimeStep(rough: number): number {
  for (const step of TIME_STEPS) {
    if (step >= rough - 1e-9) return step;
  }
  return Math.ceil(rough / 3600) * 3600;
}

function roundCoord(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return String(Math.round(value * 100) / 100);
}

function roundToStep(value: number, step: number): number {
  if (!(step > 0) || !Number.isFinite(value)) return value;
  const places = step >= 1 ? 0 : Math.min(6, Math.ceil(-Math.log10(step)) + 1);
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function buildTicks(min: number, max: number, step: number): number[] {
  if (!(step > 0) || !Number.isFinite(min) || !Number.isFinite(max)) return [];
  const count = Math.max(0, Math.round((max - min) / step));
  const ticks: number[] = [];
  for (let index = 0; index <= count && index < 12; index += 1) {
    ticks.push(roundToStep(min + index * step, step));
  }
  const last = ticks[ticks.length - 1];
  if (last === undefined || last < max - step * 0.01) ticks.push(roundToStep(max, step));
  return ticks;
}

function finishScale(ticks: number[], min: number, max: number): YScale {
  const first = ticks[0] ?? min;
  const last = ticks[ticks.length - 1] ?? max;
  return { min: first, max: last, ticks };
}

function scaleBetween(
  dataMin: number,
  dataMax: number,
  target: number,
  options: { integers?: boolean; time?: boolean } | undefined,
  nonNegative: boolean,
): YScale {
  const pad = (dataMax - dataMin) * 0.1;
  let min = dataMin - pad;
  const max = dataMax + pad;
  if (nonNegative && min < 0) min = 0;
  let step = niceNumber((max - min) / Math.max(1, target - 1), true);
  if (options?.time) step = niceTimeStep(step);
  if (options?.integers) step = Math.max(1, Math.ceil(step - 1e-9));
  let niceMin = Math.floor(min / step) * step;
  let niceMax = Math.ceil((max - 1e-9) / step) * step;
  if (niceMin > dataMin) niceMin -= step;
  if (nonNegative && niceMin < 0) niceMin = 0;
  if (niceMax < dataMax) niceMax += step;
  return finishScale(buildTicks(niceMin, niceMax, step), niceMin, niceMax);
}

function monotoneSlopes(points: Array<{ x: number; y: number }>): number[] {
  const count = points.length;
  const delta: number[] = [];
  for (let index = 0; index < count - 1; index += 1) {
    const from = points[index];
    const to = points[index + 1];
    if (!from || !to) {
      delta.push(0);
      continue;
    }
    const width = to.x - from.x;
    delta.push(width === 0 ? 0 : (to.y - from.y) / width);
  }
  const firstDelta = delta[0] ?? 0;
  const slopes = [firstDelta];
  for (let index = 1; index < count - 1; index += 1) {
    const previous = delta[index - 1] ?? 0;
    const next = delta[index] ?? 0;
    slopes.push(previous * next <= 0 ? 0 : (previous + next) / 2);
  }
  slopes.push(delta[count - 2] ?? 0);
  for (let index = 0; index < count - 1; index += 1) {
    const slope = delta[index] ?? 0;
    if (Math.abs(slope) < 1e-12) {
      slopes[index] = 0;
      slopes[index + 1] = 0;
      continue;
    }
    const start = (slopes[index] ?? 0) / slope;
    const end = (slopes[index + 1] ?? 0) / slope;
    const sum = start * start + end * end;
    if (sum > 9) {
      const scale = 3 / Math.sqrt(sum);
      slopes[index] = scale * start * slope;
      slopes[index + 1] = scale * end * slope;
    }
  }
  return slopes;
}
