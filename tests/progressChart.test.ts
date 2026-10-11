import assert from "node:assert/strict";
import test from "node:test";
import {
  ONE_YEAR_MS,
  THREE_MONTHS_MS,
  chartCoords,
  filterByRange,
  nearestPointIndex,
  recordPoints,
} from "../lib/progressChart.ts";

const DAY = 24 * 60 * 60 * 1000;

test("ranges keep recent points and the record series drops empty values", () => {
  const now = Date.UTC(2026, 9, 11);
  const points = [
    { sessionId: "old", startedAt: now - ONE_YEAR_MS - DAY, value: 100, volumeLb: 1000 },
    { sessionId: "year", startedAt: now - THREE_MONTHS_MS - DAY, value: 110, volumeLb: 0 },
    { sessionId: "recent", startedAt: now - DAY, value: 120, volumeLb: 500 },
    { sessionId: "drops", startedAt: now - 2 * DAY, value: null, volumeLb: 800 },
  ];
  assert.deepEqual(
    filterByRange(points, "3m", now).map((point) => point.sessionId),
    ["recent", "drops"],
  );
  assert.deepEqual(
    filterByRange(points, "1y", now).map((point) => point.sessionId),
    ["year", "recent", "drops"],
  );
  assert.equal(filterByRange(points, "all", now).length, 4);
  assert.deepEqual(
    recordPoints(filterByRange(points, "3m", now)).map((point) => point.sessionId),
    ["recent"],
  );
});

test("a single point sits in the middle and the nearest tap wins", () => {
  const single = chartCoords([10], 320, 148, 12, 16);
  assert.equal(single[0]?.x, 160);
  const coords = chartCoords([1, 2, 3], 300, 100, 0, 0);
  assert.equal(nearestPointIndex(coords, 0), 0);
  assert.equal(nearestPointIndex(coords, 149), 1);
  assert.equal(nearestPointIndex(coords, 300), 2);
});