import assert from "node:assert/strict";
import test from "node:test";
import { safeNextPath } from "../lib/safeNext.ts";

test("only a same-app path is kept", () => {
  assert.equal(safeNextPath("/start?action=repeat"), "/start?action=repeat");
  assert.equal(safeNextPath("/routines"), "/routines");
  assert.equal(safeNextPath(null), "/");
  assert.equal(safeNextPath("https://evil.example/start"), "/");
  assert.equal(safeNextPath("//evil.example"), "/");
  assert.equal(safeNextPath("/\\evil"), "/");
  assert.equal(safeNextPath("/start?next=https://evil.example"), "/");
});
