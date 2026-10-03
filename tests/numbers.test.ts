import assert from "node:assert/strict";
import test from "node:test";
import { parseReps, parseWeightLb } from "../lib/numbers.ts";
import { formatWeightLb } from "../lib/format.ts";

test("parses whole-number reps", () => {
  assert.equal(parseReps("8"), 8);
  assert.equal(parseReps("0"), null);
  assert.equal(parseReps("8.5"), null);
});

test("parses pounds including bodyweight", () => {
  assert.equal(parseWeightLb("0"), 0);
  assert.equal(parseWeightLb("132.5"), 132.5);
  assert.equal(parseWeightLb("135."), null);
  assert.equal(formatWeightLb(0), "bodyweight");
  assert.equal(formatWeightLb(135), "135 lb");
});
