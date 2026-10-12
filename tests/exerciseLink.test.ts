import assert from "node:assert/strict";
import test from "node:test";
import { exerciseBackHref, exerciseBackLabel, exerciseLink } from "../lib/exerciseLink.ts";

test("exercise links remember a same-app return path", () => {
  assert.equal(exerciseLink("abc", "/"), "/exercises/abc?from=%2F");
  assert.equal(
    exerciseLink("abc", "/history/day/2026-10-12"),
    "/exercises/abc?from=%2Fhistory%2Fday%2F2026-10-12",
  );
  assert.equal(exerciseLink("local:1", "/"), null);
  assert.equal(exerciseLink("pending:1", "/history"), null);
});

test("back returns to the page that opened the exercise", () => {
  assert.equal(exerciseBackHref(null), "/history");
  assert.equal(exerciseBackHref("/"), "/");
  assert.equal(exerciseBackHref("/exercises"), "/exercises");
  assert.equal(exerciseBackHref("https://evil.example"), "/history");
  assert.equal(exerciseBackLabel("/"), "Back to workout");
  assert.equal(exerciseBackLabel("/history/day/2026-10-12"), "Back to history");
  assert.equal(exerciseBackLabel("/exercises"), "Back");
});
