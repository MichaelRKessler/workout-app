import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultLengthUnit,
  fromCentimeters,
  normalizeBodyMeasures,
  toCentimeters,
} from "../convex/lib/bodyMeasures.ts";
import { loggedAtFromDateInput, shiftDateInput } from "../lib/bodyDate.ts";
import { emptyBodyDraft, measuresFromDraft } from "../lib/bodyDraft.ts";
import { normalizeBodyProposal } from "../lib/voice/bodyProposal.ts";

const spoken = {
  bodyFatPct: 0,
  waist: 0,
  chest: 0,
  arm: 0,
  hips: 0,
  thigh: 0,
  dayOffset: 0,
  note: "",
};

test("length follows the weight unit until someone chooses", () => {
  assert.equal(defaultLengthUnit("lb"), "in");
  assert.equal(defaultLengthUnit("kg"), "cm");
  assert.equal(toCentimeters(34, "in"), 86.36);
  assert.equal(fromCentimeters(86.36, "in"), 34);
});

test("weight 232 stays in pounds and a kilo weight converts", () => {
  const pounds = normalizeBodyProposal(
    { ...spoken, weight: 232, weightUnit: "lb", lengthUnit: "in" },
    "lb",
    "in",
  );
  assert.equal(pounds.weightLb, 232);
  assert.equal(pounds.bodyFatPct, null);
  assert.equal(pounds.waistCm, null);
  assert.equal(pounds.note, null);

  const kilos = normalizeBodyProposal(
    { ...spoken, weight: 100, weightUnit: "kg", lengthUnit: "cm" },
    "lb",
    "in",
  );
  assert.equal(kilos.weightLb, 220.46);

  const waist = normalizeBodyProposal(
    { ...spoken, weight: 0, weightUnit: "lb", lengthUnit: "in", waist: 34 },
    "lb",
    "in",
  );
  assert.equal(waist.weightLb, null);
  assert.equal(waist.waistCm, 86.36);
});

test("an empty voice result is refused", () => {
  assert.throws(
    () =>
      normalizeBodyProposal(
        { ...spoken, weight: 0, weightUnit: "lb", lengthUnit: "in" },
        "lb",
        "in",
      ),
    /weight or a measurement/,
  );
});

test("a draft stores pounds and centimeters, and today uses the current time", () => {
  const now = new Date(2026, 9, 11, 15, 30, 0).getTime();
  const today = measuresFromDraft(
    { ...emptyBodyDraft(now), weight: "232" },
    "lb",
    "in",
    now,
  );
  assert.equal(today.ok, true);
  if (today.ok) {
    assert.equal(today.save.weightLb, 232);
    assert.equal(today.save.loggedAt, now);
  }

  const yesterday = loggedAtFromDateInput(shiftDateInput(-1, now), now);
  assert.equal(yesterday, new Date(2026, 9, 10, 12, 0, 0, 0).getTime());
  assert.equal(loggedAtFromDateInput("2026-10-12", now), null);

  const kilos = measuresFromDraft(
    { ...emptyBodyDraft(now), weight: "100", waist: "80" },
    "kg",
    "cm",
    now,
  );
  assert.equal(kilos.ok, true);
  if (kilos.ok) {
    assert.equal(kilos.save.weightLb, 220.46);
    assert.equal(kilos.save.waistCm, 80);
  }

  const empty = measuresFromDraft(emptyBodyDraft(now), "lb", "in", now);
  assert.equal(empty.ok, false);
  assert.throws(() => normalizeBodyMeasures({}), /Add a weight or a measurement/);
});
