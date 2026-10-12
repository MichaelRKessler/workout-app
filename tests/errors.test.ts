import assert from "node:assert/strict";
import test from "node:test";
import { ConvexError } from "convex/values";
import { errorPageMessage, isArgumentValidationError, readableError } from "../lib/errors.ts";

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

test("ConvexError data is shown even when the message is the production wrapper", () => {
  const error = new ConvexError("This workout is already finished");
  error.message = "[CONVEX M(sessions:complete)] [Request ID: abc123] Server Error";
  assert.equal(readableError(error), "This workout is already finished");
  assert.equal(errorPageMessage(error), "This workout is already finished");

  const structured = new ConvexError({ message: "Choose two different exercises" });
  structured.message = "[CONVEX M(exercises:merge)] [Request ID: abc123] Server Error";
  assert.equal(readableError(structured), "Choose two different exercises");
});

test("a production wrapper without an Uncaught line is a generic sentence", () => {
  const wrapped = new Error("[CONVEX M(sessions:complete)] [Request ID: abc123] Server Error");
  assert.equal(readableError(wrapped), "Something went wrong. Try again.");
  assert.equal(errorPageMessage(wrapped), "Something went wrong");
});

test("an Uncaught ConvexError line is shown, including the JSON form", () => {
  assert.equal(
    readableError(new Error("Uncaught ConvexError: Email already registered")),
    "Email already registered",
  );
  assert.equal(
    readableError(new Error('Uncaught ConvexError: {"message":"Invalid coupon code"}')),
    "Invalid coupon code",
  );
});

test("argument validation is not the same as a user-facing ConvexError", () => {
  const named = new Error("Server Error");
  named.name = "ArgumentValidationError";
  assert.equal(isArgumentValidationError(named), true);
  assert.equal(
    isArgumentValidationError(new Error("Uncaught Error: ArgumentValidationError: reps")),
    true,
  );
  assert.equal(isArgumentValidationError(new ConvexError("Workout not found")), false);
  assert.equal(isArgumentValidationError(new Error("Server Error")), false);
});
