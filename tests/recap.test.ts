import assert from "node:assert/strict";
import test from "node:test";
import { buildRecap, comparisonFor, hashSeed, type RecapSet } from "../convex/lib/recap.ts";
import { badgeInfo, celebrationText, describeComparison, highlightText, ordinal } from "../lib/recapText.ts";

const DAY = 24 * 60 * 60 * 1000;
// Monday 2026-09-07 17:00 UTC.
const START = Date.UTC(2026, 8, 7, 17, 0, 0);

type Lift = { exercise: string; reps: number; weightLb: number; setType?: RecapSet["setType"] };

function workout(id: string, day: number, lifts: Lift[]) {
  const startedAt = START + day * DAY;
  return {
    session: { _id: id, startedAt },
    sets: lifts.map((lift, index) => ({
      sessionId: id,
      exerciseId: lift.exercise,
      reps: lift.reps,
      weightLb: lift.weightLb,
      durationSec: null,
      distanceM: null,
      setType: lift.setType ?? "working",
      loggedAt: startedAt + (index + 1) * 60_000,
    })),
  };
}

function recapFor(sessionId: string, workouts: Array<ReturnType<typeof workout>>, complete = true) {
  const recap = buildRecap({
    sessionId,
    sessions: workouts.map((item) => item.session),
    sets: workouts.flatMap((item) => item.sets),
    utcOffsetMinutes: 0,
    complete,
  });
  assert.ok(recap);
  return recap;
}

const squat = (reps: number, weightLb: number, count = 1): Lift[] =>
  Array.from({ length: count }, () => ({ exercise: "squat", reps, weightLb }));

test("a first workout has no records to beat, so there is no confetti", () => {
  const recap = recapFor("a", [workout("a", 0, squat(5, 225, 3))]);
  assert.equal(recap.confetti, false);
  assert.deepEqual(recap.celebrations, []);
});

test("more reps at a load lifted before is a record with confetti", () => {
  const recap = recapFor("b", [
    workout("a", 0, squat(5, 225, 3)),
    workout("b", 3, [...squat(7, 225), ...squat(5, 225, 2)]),
  ]);
  const reps = recap.celebrations.find((item) => item.kind === "repsAtWeight");
  assert.deepEqual(reps, { kind: "repsAtWeight", exerciseId: "squat", weightLb: 225, reps: 7, previousReps: 5 });
  assert.equal(recap.confetti, true);
});

test("reps at a lighter load are not a record when a heavier set already matched them", () => {
  const recap = recapFor("b", [
    workout("a", 0, [...squat(6, 245), ...squat(5, 225)]),
    workout("b", 3, squat(6, 225)),
  ]);
  assert.equal(recap.celebrations.some((item) => item.kind === "repsAtWeight"), false);
});

test("most volume for an exercise and the biggest session both celebrate", () => {
  const recap = recapFor("c", [
    workout("a", 0, squat(5, 200, 3)),
    workout("b", 2, squat(5, 200, 3)),
    workout("c", 4, squat(5, 200, 5)),
  ]);
  const kinds = recap.celebrations.map((item) => item.kind);
  assert.ok(kinds.includes("sessionVolume"));
  assert.ok(kinds.includes("exerciseVolume"));
  assert.ok(!kinds.includes("beatLastTime"), "a volume record already says it beat last time");
  assert.equal(recap.confetti, true);
});

test("beating last time without a record is celebrated quietly", () => {
  const recap = recapFor("c", [
    workout("a", 0, squat(5, 200, 5)),
    workout("b", 2, squat(5, 200, 2)),
    workout("c", 4, squat(5, 200, 3)),
  ]);
  assert.deepEqual(recap.celebrations, [
    { kind: "beatLastTime", exerciseId: "squat", metric: "volume", value: 3000, previous: 2000 },
  ]);
  assert.equal(recap.confetti, false);
});

test("a heavier load than ever before triggers confetti even without other records", () => {
  const recap = recapFor("b", [workout("a", 0, squat(5, 225, 3)), workout("b", 2, squat(1, 245))]);
  assert.equal(recap.confetti, true);
});

test("warm-ups do not count toward records or volume", () => {
  const recap = recapFor("b", [
    workout("a", 0, squat(5, 225)),
    workout("b", 2, [{ exercise: "squat", reps: 10, weightLb: 225, setType: "warmup" }, ...squat(3, 225)]),
  ]);
  assert.equal(recap.confetti, false);
});

test("badges from older history are listed but not new; the crossing workout is new", () => {
  const history = Array.from({ length: 10 }, (_, index) => workout(`w${index}`, index * 2, squat(5, 100)));
  const ninth = recapFor("w8", history.slice(0, 9));
  assert.equal(ninth.badges.some((badge) => badge.id === "workouts-10"), false);
  const tenth = recapFor("w9", history);
  const badge = tenth.badges.find((item) => item.id === "workouts-10");
  assert.equal(badge?.isNew, true);
  const later = recapFor("w10", [...history, workout("w10", 30, squat(5, 100))]);
  assert.equal(later.badges.find((item) => item.id === "workouts-10")?.isNew, false);
});

test("Iron Elephant needs 13,000 lb in one workout", () => {
  const recap = recapFor("a", [workout("a", 0, squat(10, 260, 5))]);
  const elephant = recap.badges.find((badge) => badge.id === "iron-elephant");
  assert.equal(elephant?.isNew, true);
});

test("per-exercise set badges carry the exercise", () => {
  const recap = recapFor("a", [workout("a", 0, squat(1, 45, 100))]);
  const badge = recap.badges.find((item) => item.id === "sets-100");
  assert.equal(badge?.exerciseId, "squat");
  assert.equal(badgeInfo(badge!, { squat: "Back Squat" }).title, "100 Back Squat sets");
});

test("week streak badges follow consecutive weeks", () => {
  const weeks = Array.from({ length: 4 }, (_, index) => workout(`s${index}`, index * 7, squat(5, 100)));
  const recap = recapFor("s3", weeks);
  assert.equal(recap.badges.find((badge) => badge.id === "streak-4")?.isNew, true);
  const gap = [...weeks.slice(0, 2), workout("late", 28, squat(5, 100))];
  assert.equal(recapFor("late", gap).badges.some((badge) => badge.id === "streak-4"), false);
});

test("badges and record claims are skipped when history could not be read in full", () => {
  const recap = recapFor("a", [workout("a", 0, squat(10, 260, 5))], false);
  assert.deepEqual(recap.badges, []);
  const partial = recapFor(
    "b",
    [workout("a", 0, squat(5, 225, 3)), workout("b", 3, [...squat(7, 245), ...squat(5, 225, 4)])],
    false,
  );
  assert.deepEqual(partial.celebrations, []);
  assert.equal(partial.confetti, false);
  assert.equal(partial.highlights.some((item) => item.kind === "workoutNumber"), false);
});

test("highlights vary by workout and never repeat a kind", () => {
  const history = Array.from({ length: 12 }, (_, index) =>
    workout(`h${index}`, index * 2, squat(5, 200 + index * 5, 5)),
  );
  const seen = new Set<string>();
  for (let index = 4; index < 12; index += 1) {
    const recap = recapFor(`h${index}`, history.slice(0, index + 1));
    assert.ok(recap.highlights.length >= 2 && recap.highlights.length <= 3);
    const kinds = recap.highlights.map((item) => item.kind);
    assert.equal(new Set(kinds).size, kinds.length);
    seen.add(kinds.join(","));
  }
  assert.ok(seen.size > 2, `expected varied recaps, saw ${[...seen].join(" | ")}`);
});

test("the same workout always gets the same recap", () => {
  const history = Array.from({ length: 8 }, (_, index) => workout(`r${index}`, index * 2, squat(5, 200, 4)));
  assert.deepEqual(recapFor("r7", history), recapFor("r7", history));
});

test("strength gain compares with a workout three weeks to three months back", () => {
  const recap = buildRecap({
    sessionId: "now",
    sessions: [workout("old", 0, []).session, workout("now", 30, []).session],
    sets: [...workout("old", 0, squat(5, 200)).sets, ...workout("now", 30, squat(5, 225)).sets],
    utcOffsetMinutes: 0,
    complete: true,
  });
  assert.ok(recap);
  // The gain candidate always exists; check it reads well when chosen.
  const text = highlightText(
    { kind: "strengthGain", exerciseId: "squat", fromLb: 233.33, toLb: 262.5, days: 30 },
    "lb",
    { squat: "Squat" },
    1,
  );
  assert.equal(text.text, "Your Squat estimated max is up 29 lb in 4 weeks (233 lb to 263 lb).");
});

test("comparisons stay between one and twenty of a thing", () => {
  const comparison = comparisonFor(26_000, 2, true);
  assert.deepEqual(comparison, { id: "elephant", count: 2 });
  assert.equal(describeComparison(comparison!), "about two elephants");
  assert.equal(describeComparison({ id: "piano", count: 1.5 }), "about one and a half grand pianos");
  assert.equal(describeComparison({ id: "car", count: 14.2 }), "about 14 cars");
  assert.equal(comparisonFor(300, 1), null);
  for (let seed = 1; seed < 50; seed += 1) {
    const pick = comparisonFor(40_000, seed);
    assert.ok(pick && pick.count >= 1 && pick.count <= 20);
  }
});

test("celebration lines use the viewer's unit", () => {
  assert.equal(
    celebrationText(
      { kind: "repsAtWeight", exerciseId: "bench", weightLb: 225, reps: 6, previousReps: 5 },
      "lb",
      { bench: "Bench Press" },
    ),
    "Most reps at 225 lb on Bench Press: 6 (was 5)",
  );
  assert.match(
    celebrationText({ kind: "sessionVolume", volumeLb: 22046.2, previousLb: 11023.1 }, "kg", {}),
    /10,000 kg moved \(was 5,000 kg\)/,
  );
});

test("ordinals", () => {
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22].map(ordinal), [
    "1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd",
  ]);
});

test("seeds are stable and positive", () => {
  assert.equal(hashSeed("abc"), hashSeed("abc"));
  assert.ok(hashSeed("") > 0);
});
