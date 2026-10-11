import assert from "node:assert/strict";
import test from "node:test";
import { errorPageMessage, readableError } from "../lib/errors.ts";

test("readableError keeps the thrown Convex message and drops the wrapper", () => {
  const wrapped = new Error(
    [
      "[CONVEX M(sessions:complete)] [Request ID: abc123] Server Error",
      "Uncaught Error: This workout is already finished",
      "    at handler (convex/sessions.ts:67:0)",
    ].join("\n"),
  );
  assert.equal(readableError(wrapped), "This workout is already finished");
  assert.equal(errorPageMessage(wrapped), "This workout is already finished");
});

test("the error page uses a plain sentence when the message is only wrapper text", () => {
  assert.equal(
    errorPageMessage(
      new Error("[CONVEX Q(sessions:getOpen)] [Request ID: abc123] Server Error"),
    ),
    "Something went wrong",
  );
  assert.equal(errorPageMessage(new Error("Uncaught Error: ")), "Something went wrong");
  assert.equal(errorPageMessage(new Error("   ")), "Something went wrong");
  assert.equal(errorPageMessage("nope"), "Something went wrong");
});

test("a normal error message is shown as written", () => {
  assert.equal(errorPageMessage(new Error("Workout not found")), "Workout not found");
});
