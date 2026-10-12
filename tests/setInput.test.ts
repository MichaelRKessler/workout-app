import assert from "node:assert/strict";
import test from "node:test";
import { parseSetInput, type SetInputFields } from "../convex/lib/setInput.ts";
import { DISTANCE_MESSAGE, REPS_MESSAGE, RPE_BLANK_MESSAGE } from "../convex/lib/setLimits.ts";

const blank: SetInputFields = {
  kind: "strength",
  reps: "",
  weight: "",
  duration: "",
  distance: "",
  calories: "",
  rpe: "",
  setType: "working",
};

test("every set form reads a strength set the same way", () => {
  assert.deepEqual(parseSetInput({ ...blank, reps: "5", weight: "225", rpe: "8" }, "lb"), {
    ok: true,
    set: { reps: 5, weightLb: 225, durationSec: null, distanceM: null, calories: null, rpe: 8, setType: "working" },
  });
  assert.deepEqual(parseSetInput({ ...blank, reps: "0", weight: "225" }, "lb"), { ok: false, message: REPS_MESSAGE });
  assert.deepEqual(parseSetInput({ ...blank, reps: "5", weight: "225", rpe: "11" }, "lb"), {
    ok: false,
    message: RPE_BLANK_MESSAGE,
  });
});

test("a blank weight is zero only where the form says so", () => {
  assert.equal(parseSetInput({ ...blank, reps: "10" }, "lb").ok, false);
  const past = parseSetInput({ ...blank, reps: "10" }, "lb", { blankWeightIsZero: true });
  assert.equal(past.ok && past.set.weightLb, 0);
});

test("timed and distance sets keep their own fields", () => {
  const timed = parseSetInput({ ...blank, kind: "timed", weight: "0", duration: "1:30" }, "lb");
  assert.equal(timed.ok && timed.set.durationSec, 90);
  assert.equal(timed.ok && timed.set.reps, null);
  const run = parseSetInput({ ...blank, kind: "distance", weight: "0", distance: "2 km", duration: "" }, "lb");
  assert.equal(run.ok && run.set.distanceM, 2000);
  assert.equal(run.ok && run.set.durationSec, null);
  assert.deepEqual(parseSetInput({ ...blank, kind: "distance", weight: "0", distance: "" }, "lb"), {
    ok: false,
    message: DISTANCE_MESSAGE,
  });
});

test("an unchanged kg weight keeps its stored pounds", () => {
  const kept = parseSetInput({ ...blank, reps: "5", weight: "61.23", weightLb: 135 }, "kg");
  assert.equal(kept.ok && kept.set.weightLb, 135);
});
