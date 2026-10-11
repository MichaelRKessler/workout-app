import assert from "node:assert/strict";
import test from "node:test";
import {
  carrySupersetIds,
  formatSupersetNames,
  linkWithNext,
  mergeSupersetMembers,
  normalizeSupersetItems,
  restAfterSet,
  restOwnerId,
  supersetNextId,
  unlinkSuperset,
} from "../convex/lib/superset.ts";

test("a shared id needs two adjacent exercises", () => {
  const items = normalizeSupersetItems([
    { name: "Curl", supersetId: "arms" },
    { name: "Pushdown", supersetId: "arms" },
    { name: "Squat" },
    { name: "Shrug", supersetId: "arms" },
  ]);
  assert.equal(items[0]?.supersetId, "arms");
  assert.equal(items[1]?.supersetId, "arms");
  assert.equal(items[2]?.supersetId, undefined);
  assert.equal(items[3]?.supersetId, undefined);
});

test("linking and unlinking keep the rest of the plan", () => {
  const linked = linkWithNext(
    [
      { exerciseId: "a", supersetId: null },
      { exerciseId: "b", supersetId: null },
      { exerciseId: "c", supersetId: null },
    ],
    0,
  );
  assert.equal(linked[0]?.supersetId, linked[1]?.supersetId);
  assert.equal(linked[2]?.supersetId, undefined);
  const cleared = unlinkSuperset(linked, 1);
  assert.equal(cleared[0]?.supersetId, undefined);
  assert.equal(cleared[1]?.supersetId, undefined);
});

test("rest waits for the round and uses the longest rest", () => {
  const plan = [
    { exerciseId: "curl", supersetId: "arms" },
    { exerciseId: "push", supersetId: "arms", skipped: false },
  ];
  const mid = restAfterSet(plan, new Map([["curl", 1], ["push", 0]]), "curl");
  assert.equal(mid.start, false);
  const done = restAfterSet(plan, new Map([["curl", 1], ["push", 1]]), "push");
  assert.equal(done.start, true);
  assert.deepEqual(done.exerciseIds, ["curl", "push"]);
  const owner = restOwnerId(["curl", "push"], new Map([["curl", 60], ["push", null]]), "push", 90);
  assert.equal(owner, "push");
  const longer = restOwnerId(["curl", "push"], new Map([["curl", 120], ["push", 90]]), "push", 60);
  assert.equal(owner, "push");
  assert.equal(longer, "curl");
});

test("the checklist highlights whoever is behind", () => {
  const next = supersetNextId([
    { exerciseId: "curl", supersetId: "arms", setCount: 2, targetSets: 3 },
    { exerciseId: "push", supersetId: "arms", setCount: 1, targetSets: 3 },
  ]);
  assert.equal(next, "push");
});

test("names join a superset with a plus", () => {
  assert.equal(
    formatSupersetNames([
      { name: "Curl", supersetId: "arms" },
      { name: "Pushdown", supersetId: "arms" },
      { name: "Squat" },
    ]),
    "Curl + Pushdown, Squat",
  );
});

test("repeat keeps a group only while those exercises stay adjacent", () => {
  const carried = carrySupersetIds(
    [{ exerciseId: "curl" }, { exerciseId: "push" }, { exerciseId: "squat" }],
    [[
      { exerciseId: "curl", supersetId: "arms" },
      { exerciseId: "squat" },
      { exerciseId: "push", supersetId: "arms" },
    ]],
  );
  assert.equal(carried[0]?.supersetId, undefined);
  const adjacent = carrySupersetIds(
    [{ exerciseId: "curl" }, { exerciseId: "push" }],
    [[
      { exerciseId: "curl", supersetId: "arms" },
      { exerciseId: "push", supersetId: "arms" },
    ]],
  );
  assert.equal(adjacent[0]?.supersetId, "arms");
  assert.equal(adjacent[1]?.supersetId, "arms");
});

test("a confirmed voice group is appended without reusing an existing id", () => {
  const merged = mergeSupersetMembers(
    [{ exerciseId: "bench", supersetId: "1" }, { exerciseId: "row", supersetId: "1" }],
    [
      { exerciseId: "curl", supersetId: "1" },
      { exerciseId: "push", supersetId: "1" },
    ],
    (exerciseId) => ({ exerciseId }),
  );
  assert.equal(merged[0]?.supersetId, "1");
  assert.equal(merged[1]?.supersetId, "1");
  assert.equal(merged[2]?.exerciseId, "curl");
  assert.equal(merged[3]?.exerciseId, "push");
  assert.notEqual(merged[2]?.supersetId, "1");
  assert.equal(merged[2]?.supersetId, merged[3]?.supersetId);
});
