import assert from "node:assert/strict";
import test from "node:test";
import { planLogOffer, sameLoggedSet } from "../lib/planLog.ts";

const routine = { reps: 5, weightLb: 225, durationSec: null, distanceM: null, calories: null };
const previous = [{ reps: 5, weightLb: 215 }];

test("a routine target is what Log set saves, and last time stays beside it", () => {
  const offer = planLogOffer("bench press", [], previous, routine, "lb");
  assert.equal(offer.primary?.label, "Log 5 × 225");
  assert.equal(offer.primary?.set.reps, 5);
  assert.equal(offer.primary?.set.weightLb, 225);
  assert.equal(offer.lastTime?.label, "Last time: 5 × 215");
  assert.equal(offer.lastTime?.set.weightLb, 215);
});

test("last time is hidden when it matches the target", () => {
  const offer = planLogOffer("bench press", [], [{ reps: 5, weightLb: 225 }], routine, "lb");
  assert.equal(offer.primary?.label, "Log 5 × 225");
  assert.equal(offer.lastTime, null);
});

test("without a target, the button names the previous set", () => {
  const offer = planLogOffer("bench press", [], previous, null, "lb");
  assert.equal(offer.primary?.label, "Log 5 × 215");
  assert.equal(offer.lastTime, null);
});

test("with nothing to copy, the button does not invent 10 at 0", () => {
  const offer = planLogOffer("curl", [], null, null, "lb");
  assert.equal(offer.primary, null);
  assert.equal(offer.lastTime, null);
});

test("a target still wins when this workout already has a different set", () => {
  const offer = planLogOffer(
    "bench press",
    [{ exerciseName: "bench press", reps: 3, weightLb: 185 }],
    previous,
    routine,
    "lb",
  );
  assert.equal(offer.primary?.label, "Log 5 × 225");
  assert.equal(offer.lastTime?.label, "Last time: 3 × 185");
  assert.equal(sameLoggedSet(offer.primary!.set, offer.lastTime!.set), false);
});
