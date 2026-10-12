import assert from "node:assert/strict";
import test from "node:test";
import { safeNextPath } from "../lib/safeNext.ts";

const origin = "https://repsandsets.vercel.app";

test("only a same-app path is kept", () => {
  assert.equal(safeNextPath("/start?action=repeat", origin), "/start?action=repeat");
  assert.equal(safeNextPath("/routines", origin), "/routines");
  assert.equal(safeNextPath("/routines?x=1#spot", origin), "/routines?x=1#spot");
  assert.equal(safeNextPath(null, origin), "/");
  assert.equal(safeNextPath(undefined, origin), "/");
  assert.equal(safeNextPath("", origin), "/");
  assert.equal(safeNextPath("https://evil.example/start", origin), "/");
  assert.equal(safeNextPath("//evil.example", origin), "/");
  assert.equal(safeNextPath("/\\evil", origin), "/");
  assert.equal(safeNextPath("/\\/evil.com", origin), "/");
  assert.equal(safeNextPath("javascript:alert(1)", origin), "/");
  assert.equal(safeNextPath("https://user:pass@evil.example/", origin), "/");
  assert.equal(safeNextPath(`/${"a".repeat(200)}`, origin), "/");
});

test("tab, CR, and LF cannot turn the return path into another site", () => {
  assert.equal(safeNextPath("/\t/evil.com", origin), "/");
  assert.equal(safeNextPath("/\n/evil.com", origin), "/");
  assert.equal(safeNextPath("/\r/evil.com", origin), "/");
  assert.equal(safeNextPath("/\u000b/evil.com", origin), "/");
  assert.equal(safeNextPath("/%09/evil.com", origin), "/");
  assert.equal(safeNextPath("/%0a/evil.com", origin), "/");
  assert.equal(safeNextPath("/%0d/evil.com", origin), "/");
  assert.equal(safeNextPath("/%00/secret", origin), "/");
});

test("dot segments cannot collapse the return path into another site", () => {
  for (const value of [
    "/.//evil.com",
    "/..//evil.com",
    "/a/..//evil.com",
    "/%2e//evil.com",
    "/%2E//evil.com",
    "/.%2e//evil.com",
    "/./\\evil.com",
    "/.\\/evil.com",
    "/./%5Cevil.com",
  ]) {
    const result = safeNextPath(value, origin);
    assert.equal(new URL(result, origin).origin, origin, value);
    assert.equal(result.startsWith("//"), false, value);
  }
  assert.equal(safeNextPath("/./history", origin), "/history");
  assert.equal(safeNextPath("/routines/../history", origin), "/history");
});

test("a same-origin absolute URL becomes a path, and a query is not a redirect", () => {
  assert.equal(safeNextPath("https://repsandsets.vercel.app/history?day=1", origin), "/history?day=1");
  assert.equal(
    safeNextPath("/start?next=https://evil.example", origin),
    "/start?next=https://evil.example",
  );
  assert.equal(safeNextPath("/body", "http://localhost:3000"), "/body");
  assert.equal(safeNextPath("//evil.example", "http://localhost:3000"), "/");
  assert.equal(safeNextPath("/\t/evil.com"), "/");
});
