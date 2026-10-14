import assert from "node:assert/strict";
import test from "node:test";
import { activeTab } from "../lib/tabBar.ts";

test("each page lights up the tab it belongs to", () => {
  assert.equal(activeTab("/"), "home");
  assert.equal(activeTab("/history"), "history");
  assert.equal(activeTab("/history/day/2026-10-14"), "history");
  assert.equal(activeTab("/history/log"), "history");
  assert.equal(activeTab("/exercises"), "exercises");
  assert.equal(activeTab("/exercises/abc"), "exercises");
  assert.equal(activeTab("/body"), "body");
});

test("settings, routines and look-alike paths light up no tab", () => {
  assert.equal(activeTab("/settings"), null);
  assert.equal(activeTab("/routines/new"), null);
  assert.equal(activeTab("/bodyweight"), null);
  assert.equal(activeTab("/start"), null);
});
