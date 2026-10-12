import assert from "node:assert/strict";
import test from "node:test";
import {
  draftGroupLabel,
  draftSetsMatch,
  groupIdenticalSets,
  resizeSetGroup,
} from "../lib/confirmGroups.ts";
import type { DraftSet } from "../lib/voice/confirm.ts";

function set(patch: Partial<DraftSet> = {}): DraftSet {
  return {
    kind: "strength",
    reps: "10",
    weight: "135",
    duration: "",
    distance: "",
    calories: "",
    rpe: "",
    weightLb: 135,
    setType: "working",
    ...patch,
  };
}

test("identical sets collapse and a different load stays separate", () => {
  const sets = [set(), set(), set(), set({ reps: "8", weight: "155", weightLb: 155 })];
  assert.deepEqual(groupIdenticalSets(sets), [
    { start: 0, count: 3 },
    { start: 3, count: 1 },
  ]);
  assert.equal(draftSetsMatch(sets[0]!, sets[1]!), true);
  assert.equal(draftSetsMatch(sets[0]!, sets[3]!), false);
  assert.equal(draftGroupLabel(3, sets[0]!, "lb"), "3 × 10 @ 135 lb");
  assert.equal(draftGroupLabel(1, sets[3]!, "lb"), "8 @ 155 lb");
});

test("a split id keeps matching sets on their own rows", () => {
  const sets = [set({ draftSetId: "a" }), set({ draftSetId: "b" }), set()];
  const groups = groupIdenticalSets(sets, new Set(["a", "b"]));
  assert.deepEqual(groups, [
    { start: 0, count: 1 },
    { start: 1, count: 1 },
    { start: 2, count: 1 },
  ]);
});

test("the count can grow or shrink without dropping the last set", () => {
  const sets = [set(), set(), set({ reps: "6" })];
  const smaller = resizeSetGroup(sets, 0, 2, 1);
  assert.equal(smaller.length, 2);
  assert.equal(smaller[0]?.reps, "10");
  assert.equal(smaller[1]?.reps, "6");
  const larger = resizeSetGroup(sets, 0, 2, 4);
  assert.equal(larger.length, 5);
  assert.equal(larger[2]?.reps, "10");
  assert.equal(larger[2]?.draftSetId, undefined);
  const floored = resizeSetGroup(sets, 0, 2, 0);
  assert.equal(floored.length, 2);
  assert.equal(floored[0]?.reps, "10");
  assert.equal(floored[1]?.reps, "6");
});

test("warm-up and effort stay visible on the collapsed row", () => {
  const label = draftGroupLabel(2, set({ setType: "warmup", rpe: "8" }), "lb");
  assert.equal(label, "2 × 10 @ 135 lb · warmup · RPE 8");
});

test("a held row stays one row and does not absorb a matching neighbor", () => {
  const held = new Set(["a", "b"]);
  const sets = [set(), set({ draftSetId: "a" }), set({ draftSetId: "b" }), set()];
  assert.deepEqual(groupIdenticalSets(sets, new Set(), held), [
    { start: 0, count: 1 },
    { start: 1, count: 2 },
    { start: 3, count: 1 },
  ]);
  assert.deepEqual(groupIdenticalSets(sets), [{ start: 0, count: 4 }]);
});
