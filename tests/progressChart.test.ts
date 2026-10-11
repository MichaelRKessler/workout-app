import assert from "node:assert/strict";
import test from "node:test";
import {
  ONE_MONTH_MS,
  ONE_YEAR_MS,
  SIX_MONTHS_MS,
  THREE_MONTHS_MS,
  availableMetrics,
  buildSeries,
  chartDomain,
  dateTickBoxes,
  defaultChartRange,
  filterByRange,
  formatChartDelta,
  formatChartSet,
  formatChartValue,
  formatYTick,
  gapThresholdMs,
  layoutDateTicks,
  linearTrend,
  monotonePath,
  nearestPointIndex,
  niceYScale,
  plotSizeAtViewport,
  pointerMoved,
  pointerXInView,
  prepareYScale,
  recordPoints,
  selectionAfter,
  seriesLayout,
  splitSegments,
  timeToX,
  type ChartRange,
  type DateTick,
} from "../lib/progressChart.ts";

const DAY = 24 * 60 * 60 * 1000;

test("ranges keep recent points and the record series drops empty values", () => {
  const now = Date.UTC(2026, 9, 11);
  const points = [
    { sessionId: "old", startedAt: now - ONE_YEAR_MS - DAY, value: 100, volumeLb: 1000 },
    { sessionId: "year", startedAt: now - SIX_MONTHS_MS - DAY, value: 105, volumeLb: 0 },
    { sessionId: "half", startedAt: now - THREE_MONTHS_MS - DAY, value: 110, volumeLb: 0 },
    { sessionId: "month", startedAt: now - ONE_MONTH_MS - DAY, value: 115, volumeLb: 100 },
    { sessionId: "recent", startedAt: now - DAY, value: 120, volumeLb: 500 },
    { sessionId: "drops", startedAt: now - 2 * DAY, value: null, volumeLb: 800 },
  ];
  assert.deepEqual(
    filterByRange(points, "1m", now).map((point) => point.sessionId),
    ["recent", "drops"],
  );
  assert.deepEqual(
    filterByRange(points, "3m", now).map((point) => point.sessionId),
    ["month", "recent", "drops"],
  );
  assert.deepEqual(
    filterByRange(points, "6m", now).map((point) => point.sessionId),
    ["half", "month", "recent", "drops"],
  );
  assert.deepEqual(
    filterByRange(points, "1y", now).map((point) => point.sessionId),
    ["year", "half", "month", "recent", "drops"],
  );
  assert.equal(filterByRange(points, "all", now).length, 6);
  assert.deepEqual(
    recordPoints(filterByRange(points, "1m", now)).map((point) => point.sessionId),
    ["recent"],
  );
});

test("points sit on a time axis, not on even indexes", () => {
  const domain = { start: 0, end: 30 * DAY };
  const start = timeToX(0, domain, 10, 300);
  const nextDay = timeToX(DAY, domain, 10, 300);
  const end = timeToX(30 * DAY, domain, 10, 300);
  assert.equal(start, 10);
  assert.ok(Math.abs(nextDay - 20) < 0.001);
  assert.equal(end, 310);
  const coords = [
    { x: timeToX(0, domain, 0, 300) },
    { x: timeToX(DAY, domain, 0, 300) },
    { x: timeToX(30 * DAY, domain, 0, 300) },
  ];
  assert.ok((coords[1]?.x ?? 0) < 20);
  assert.equal(nearestPointIndex(coords, 0), 0);
  assert.equal(nearestPointIndex(coords, 8), 1);
  assert.equal(nearestPointIndex(coords, 300), 2);
});

test("a single all-time point is given a real date span instead of an index slot", () => {
  const domain = chartDomain("all", [{ startedAt: 1_000_000 }], 2_000_000);
  assert.ok(domain);
  assert.ok(domain.start < 1_000_000);
  assert.ok(domain.end > 1_000_000);
  const fixed = chartDomain("3m", [], Date.UTC(2026, 9, 11));
  assert.equal(fixed?.end, Date.UTC(2026, 9, 11));
  assert.equal(fixed?.start, Date.UTC(2026, 9, 11) - THREE_MONTHS_MS);
});

test("the default range is 3 months, all of a short history, or all when nothing is recent", () => {
  const now = Date.UTC(2026, 9, 11);
  assert.equal(
    defaultChartRange(
      [
        { startedAt: now - 120 * DAY },
        { startedAt: now - DAY },
      ],
      now,
    ),
    "3m",
  );
  assert.equal(
    defaultChartRange(
      [
        { startedAt: now - 10 * DAY },
        { startedAt: now - DAY },
      ],
      now,
    ),
    "all",
  );
  assert.equal(defaultChartRange([{ startedAt: now - 400 * DAY }], now), "all");
  assert.equal(defaultChartRange([], now), "3m");
});

test("date ticks read as days, months, or years and do not overlap on a phone", () => {
  const now = Date.UTC(2026, 9, 11, 18);
  const ranges: ChartRange[] = ["1m", "3m", "6m", "1y"];
  for (const viewport of [360, 390, 412]) {
    for (const gutter of [56, 80]) {
      const { plotLeft, plotWidth } = plotSizeAtViewport(viewport, gutter);
      for (const range of ranges) {
        const domain = chartDomain(range, [], now);
        assert.ok(domain);
        const ticks = layoutDateTicks(domain.start, domain.end, plotLeft, plotWidth, "UTC");
        assert.ok(ticks.length >= 2, `${range} at ${viewport}px gutter ${gutter} produced ${ticks.length}`);
        assertNoOverlap(ticks, plotLeft, plotLeft + plotWidth, `${range} ${viewport} ${gutter}`);
      }
    }
  }

  const month = layoutDateTicks(now - 31 * DAY, now, 56, 215, "UTC");
  assert.ok(month.every((tick) => /^[A-Z][a-z]{2} \d{1,2}$/.test(tick.label)));
  assert.ok(month.some((tick) => tick.label.startsWith("Oct") || tick.label.startsWith("Sep")));

  const halfYear = layoutDateTicks(Date.UTC(2026, 3, 11), Date.UTC(2026, 9, 11), 56, 215, "UTC");
  assert.ok(halfYear.every((tick) => /^[A-Z][a-z]{2}$/.test(tick.label)));

  const year = layoutDateTicks(Date.UTC(2025, 9, 11), Date.UTC(2026, 9, 11), 56, 215, "UTC");
  assert.ok(year.every((tick) => /^[A-Z][a-z]{2} '\d{2}$/.test(tick.label)));

  const years = layoutDateTicks(Date.UTC(2023, 0, 1), Date.UTC(2026, 9, 11), 56, 215, "UTC");
  assert.ok(years.every((tick) => /^\d{4}$/.test(tick.label)));
  assertNoOverlap(years, 56, 271, "multi-year");

  const domain = chartDomain(
    "all",
    [{ startedAt: Date.UTC(2026, 0, 8) }, { startedAt: Date.UTC(2026, 9, 8) }],
    now,
  );
  assert.ok(domain);
  const season = layoutDateTicks(domain.start, domain.end, 56, 215, "UTC");
  assert.ok(season.length >= 3);
  assert.ok(season.every((tick) => /^[A-Z][a-z]{2}$/.test(tick.label)));
  assert.ok(!season.some((tick) => tick.label.startsWith("Dec")));
});

test("y ticks are rounded, cover the data, and stay finite around outliers", () => {
  const weights = niceYScale([185, 210, 248]);
  assert.ok(weights.min <= 185);
  assert.ok(weights.max >= 248);
  assertEvenTicks(weights.ticks);
  assert.ok(weights.ticks.length >= 2 && weights.ticks.length <= 6);

  const flat = niceYScale([220, 220, 220]);
  assert.ok(flat.min < 220 && flat.max > 220);
  assert.ok(flat.ticks.every((tick) => Number.isFinite(tick)));

  const reps = niceYScale([8, 10, 12], { integers: true });
  assert.ok(reps.ticks.every((tick) => Number.isInteger(tick)));
  assert.ok(reps.min <= 8 && reps.max >= 12);

  const clocks = niceYScale([90, 150, 240], { time: true });
  assert.ok(clocks.ticks.every((tick) => formatYTick(tick, "time").includes(":")));
  assertEvenTicks(clocks.ticks);

  const outlier = niceYScale([100, 101, 102, 900]);
  assert.ok(outlier.min <= 100);
  assert.ok(outlier.max >= 900);
  assert.ok(outlier.ticks.every((tick) => Number.isFinite(tick)));
  assert.ok(outlier.ticks.length <= 6);
  assert.deepEqual(niceYScale([]).ticks, [0, 1]);
});

test("weight ticks are nice in the display unit", () => {
  const kilograms = prepareYScale([200, 225, 250], "epley", "kg");
  assert.equal(kilograms.caption, "kg");
  assert.ok(kilograms.scale.min <= kilograms.toDisplay(200));
  assert.ok(kilograms.scale.max >= kilograms.toDisplay(250));
  const step = (kilograms.scale.ticks[1] ?? 0) - (kilograms.scale.ticks[0] ?? 0);
  assert.ok(step >= 1);
  assert.ok(kilograms.scale.ticks.every((tick) => Math.abs(tick / step - Math.round(tick / step)) < 0.001));
  assert.ok(kilograms.scale.ticks.every((tick) => !String(tick).includes("99.7")));

  const pounds = prepareYScale([200, 225, 250], "weight", "lb");
  assert.equal(pounds.caption, "lb");
  assert.ok(pounds.scale.ticks.every((tick) => Number.isInteger(tick)));

  const distance = prepareYScale([400, 800, 1200], "distance", "lb");
  assert.equal(distance.caption, "km");
  assert.ok(distance.scale.max >= 1.2);

  const miles = prepareYScale([1609.344, 3218.688], "distance", "lb");
  assert.equal(miles.caption, "mi");
});

test("same-day sessions collapse to the day's best, summed volume, or latest weigh-in", () => {
  const morning = Date.UTC(2026, 9, 3, 15);
  const evening = Date.UTC(2026, 9, 3, 20);
  const set = (reps: number, weightLb: number) => ({
    reps,
    weightLb,
    durationSec: null,
    distanceM: null,
  });
  const sessions = [
    {
      sessionId: "am",
      startedAt: morning,
      value: 200,
      epleyLb: 200,
      topWeightLb: 180,
      volumeLb: 1000,
      bestEpleySet: set(5, 170),
      bestWeightSet: set(3, 180),
    },
    {
      sessionId: "pm",
      startedAt: evening,
      value: 230,
      epleyLb: 230,
      topWeightLb: 205,
      volumeLb: 1500,
      bestEpleySet: set(3, 205),
      bestWeightSet: set(1, 205),
    },
  ];
  const epley = buildSeries(sessions, "epley", "lb", "UTC");
  assert.equal(epley.length, 1);
  assert.equal(epley[0]?.value, 230);
  assert.equal(epley[0]?.bestSet?.reps, 3);
  assert.equal(epley[0]?.bestSet?.weightLb, 205);
  assert.equal(epley[0]?.pr, true);
  assert.equal(epley[0]?.dayKey, "2026-10-03");

  const volume = buildSeries(sessions, "volume", "lb", "UTC");
  assert.equal(volume[0]?.value, 2500);
  assert.equal(volume[0]?.bestSet?.weightLb, 205);

  const body = buildSeries(
    [
      { sessionId: "a", startedAt: morning, value: 200, volumeLb: 0 },
      { sessionId: "b", startedAt: evening, value: 198, volumeLb: 0 },
    ],
    "body",
    "lb",
    "UTC",
  );
  assert.equal(body.length, 1);
  assert.equal(body[0]?.value, 198);
  assert.equal(body[0]?.pr, false);

  const losAngeles = buildSeries(
    [
      {
        sessionId: "1",
        startedAt: Date.parse("2026-10-03T16:00:00Z"),
        value: 100,
        epleyLb: 100,
        volumeLb: 0,
      },
      {
        sessionId: "2",
        startedAt: Date.parse("2026-10-04T06:30:00Z"),
        value: 140,
        epleyLb: 140,
        volumeLb: 0,
      },
    ],
    "epley",
    "lb",
    "America/Los_Angeles",
  );
  assert.equal(losAngeles.length, 1);
  assert.equal(losAngeles[0]?.value, 140);
  assert.equal(buildSeries(
    [
      { sessionId: "1", startedAt: Date.parse("2026-10-03T16:00:00Z"), value: 100, epleyLb: 100, volumeLb: 0 },
      { sessionId: "2", startedAt: Date.parse("2026-10-04T06:30:00Z"), value: 140, epleyLb: 140, volumeLb: 0 },
    ],
    "epley",
    "lb",
    "UTC",
  ).length, 2);
});

test("personal records are the days that beat every earlier day", () => {
  const start = Date.UTC(2026, 0, 1);
  const series = buildSeries(
    [100, 110, 105, 120].map((value, index) => ({
      sessionId: String(index),
      startedAt: start + index * 7 * DAY,
      value,
      epleyLb: value,
      volumeLb: 0,
    })),
    "epley",
    "lb",
    "UTC",
  );
  assert.deepEqual(
    series.map((point) => point.pr),
    [true, true, false, true],
  );
  const metrics = availableMetrics(
    [{ sessionId: "a", startedAt: start, value: 200, epleyLb: 200, topWeightLb: 185, volumeLb: 3000 }],
    "lb",
    "effort",
  );
  assert.deepEqual(metrics, ["epley", "weight", "volume"]);
  assert.deepEqual(availableMetrics([], "lb", "body"), ["body"]);
});

test("a layoff splits the line, and the curve and trend stay defined", () => {
  const groups = splitSegments(
    [{ startedAt: 0 }, { startedAt: 2 * DAY }, { startedAt: 80 * DAY }],
    gapThresholdMs(0, 90 * DAY),
  );
  assert.equal(groups.length, 2);
  assert.equal(groups[0]?.length, 2);
  const path = monotonePath([
    { x: 0, y: 10 },
    { x: 10, y: 0 },
    { x: 20, y: 8 },
  ]);
  assert.ok(path.startsWith("M 0 10"));
  assert.ok(path.includes("C "));
  const trend = linearTrend([
    { x: 0, y: 1 },
    { x: 10, y: 2 },
    { x: 20, y: 3 },
  ]);
  assert.ok(trend);
  assert.ok(trend.y2 > trend.y1);
  assert.equal(linearTrend([{ x: 0, y: 1 }, { x: 1, y: 2 }]), null);
});

test("chart values round onto one line and keep a sign on the change", () => {
  assert.equal(formatChartValue(800 / 3, "epley", "lb"), "267 lb");
  assert.equal(formatChartValue(180, "weight", "lb"), "180 lb");
  assert.equal(formatChartValue(180, "body", "kg"), "81.5 kg");
  assert.equal(formatChartValue(220.46, "body", "kg"), "100 kg");
  assert.equal(formatChartValue(0, "weight", "lb"), "bodyweight");
  assert.equal(formatChartValue(9420.6, "volume", "lb"), "9,421 lb");
  assert.equal(formatChartValue(8.6, "reps", "lb"), "9 reps");
  assert.equal(formatChartValue(90, "time", "lb"), "1:30");
  assert.equal(formatChartValue(5000, "distance", "lb"), "5.00 km");
  assert.equal(formatChartValue(1.25 * 1609.344, "distance", "lb"), "1.25 mi");

  assert.equal(formatChartDelta(85.83, "epley", "lb"), "+86 lb");
  assert.equal(formatChartDelta(-7.2, "body", "lb"), "−7 lb");
  assert.equal(formatChartDelta(0.2, "weight", "lb"), "0 lb");
  assert.equal(formatChartDelta(1500.4, "volume", "lb"), "+1,500 lb");
  assert.equal(formatChartDelta(-45, "time", "lb"), "−0:45");
  assert.equal(formatChartDelta(0, "reps", "lb"), "0 reps");

  const set = formatChartSet(
    { reps: 5, weightLb: 180, durationSec: null, distanceM: null },
    "epley",
    "lb",
  );
  assert.equal(set, "5×180 lb");
  assert.equal(formatChartSet(null, "body", "lb"), null);

  for (const viewport of [360, 390, 412]) {
    const inner = viewport - 45 - 36;
    const column = (inner - 9 * 2) / 3;
    const text = formatChartValue(800 / 3, "epley", "lb");
    assert.ok(
      estimateFits(text, column),
      `${text} is wider than a ${viewport}px stat column (${column})`,
    );
  }
});

test("a tap selects, a second tap or a tap away clears, and a drag keeps the point", () => {
  assert.equal(selectionAfter(null, { type: "tap", key: "2026-10-05" }), "2026-10-05");
  assert.equal(selectionAfter("2026-10-05", { type: "tap", key: "2026-10-05" }), null);
  assert.equal(selectionAfter("2026-10-05", { type: "tap", key: "2026-10-08" }), "2026-10-08");
  assert.equal(selectionAfter("2026-10-05", { type: "scrub", key: "2026-10-08" }), "2026-10-08");
  assert.equal(selectionAfter("2026-10-05", { type: "scrub", key: "2026-10-05" }), "2026-10-05");
  assert.equal(selectionAfter("2026-10-05", { type: "outside" }), null);
  assert.equal(selectionAfter("2026-10-05", { type: "scroll" }), null);
  assert.equal(selectionAfter(null, { type: "scroll" }), null);
  assert.equal(pointerMoved(0, 0, 4, 4), false);
  assert.equal(pointerMoved(0, 0, 12, 0), true);
});

test("the guide, the dot, and a hit at that x are the same point", () => {
  const now = Date.UTC(2026, 9, 11, 18);
  const day = 24 * 60 * 60 * 1000;
  const plotted = [
    { startedAt: now - 36 * day, value: 180, dayKey: "2026-09-05" },
    { startedAt: now - 20 * day, value: 210, dayKey: "2026-09-21" },
    { startedAt: now - 6 * day, value: 800 / 3, dayKey: "2026-10-05" },
  ];
  for (const viewport of [360, 390, 412]) {
    const width = Math.round(viewport - 45 - 36);
    const layout = seriesLayout(plotted, "3m", now, width, "epley", "lb");
    assert.ok(layout);
    layout.coords.forEach((coord, index) => {
      assert.equal(nearestPointIndex(layout.coords, coord.x), index);
      assert.equal(coord.x, layout.coords[index]?.x);
      assert.ok(coord.x >= layout.plotLeft - 0.01);
    });
    const oct5 = layout.coords[2];
    assert.ok(oct5);
    assert.equal(nearestPointIndex(layout.coords, pointerXInView(oct5.x, 0, width, width)), 2);
    const scaledWidth = width * 0.92;
    const finger = oct5.x * 0.92;
    assert.equal(
      nearestPointIndex(layout.coords, pointerXInView(finger, 0, scaledWidth, width)),
      2,
    );
    const unscaled = nearestPointIndex(layout.coords, finger);
    assert.notEqual(unscaled, 2);
  }
});

function estimateFits(text: string, column: number): boolean {
  let em = 0;
  for (const char of text) {
    if (char === " ") em += 0.34;
    else if (char === "," || char === ".") em += 0.3;
    else em += 0.62;
  }
  return em * 22 <= column;
}

function assertNoOverlap(ticks: DateTick[], plotLeft: number, plotRight: number, label: string) {
  const boxes = dateTickBoxes(ticks).sort((left, right) => left.left - right.left);
  for (const box of boxes) {
    assert.ok(box.left >= plotLeft - 0.5, `${label} label starts at ${box.left}`);
    assert.ok(box.right <= plotRight + 0.5, `${label} label ends at ${box.right}`);
  }
  for (let index = 1; index < boxes.length; index += 1) {
    const previous = boxes[index - 1];
    const current = boxes[index];
    assert.ok(previous && current);
    assert.ok(current.left >= previous.right + 8 - 0.5, `${label} ticks overlap`);
  }
}

function assertEvenTicks(ticks: number[]) {
  assert.ok(ticks.length >= 2);
  const step = (ticks[1] ?? 0) - (ticks[0] ?? 0);
  assert.ok(step > 0);
  for (let index = 1; index < ticks.length; index += 1) {
    const previous = ticks[index - 1] ?? 0;
    const current = ticks[index] ?? 0;
    assert.ok(Math.abs(current - previous - step) < 0.001);
  }
}
