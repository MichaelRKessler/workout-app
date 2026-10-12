import assert from "node:assert/strict";
import test from "node:test";
import {
  cachedEntryKind,
  isShellCacheName,
  LEGACY_SHELL_CACHE_NAME,
  sanitizeCachedDocument,
  shellCacheName,
} from "../lib/pwa/cachePolicy.ts";
import { serviceWorkerSource } from "../lib/pwa/serviceWorkerSource.ts";

const token = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEifQ.c2lnbmF0dXJlMTIz";

test("the shell cache name changes with the build and still matches the purge prefix", () => {
  const name = shellCacheName("dpl_abc123");
  assert.equal(name, "workout-shell-v2-dpl_abc123");
  assert.notEqual(name, LEGACY_SHELL_CACHE_NAME);
  assert.equal(isShellCacheName(name), true);
  assert.equal(isShellCacheName(LEGACY_SHELL_CACHE_NAME), true);
  assert.equal(isShellCacheName("other-cache"), false);
});

test("cached HTML loses the login token and an old fetch time", () => {
  const escaped = `<script>self.__next_f.push([1,"{\\"_state\\":{\\"token\\":\\"${token}\\",\\"refreshToken\\":\\"dummy\\"},\\"_timeFetched\\":1710000000123}"])</script>`;
  const plain = `{"token":"${token}","refreshToken":"dummy","_timeFetched":1710000000123}`;
  for (const html of [escaped, plain]) {
    const sanitized = sanitizeCachedDocument(html);
    assert.equal(typeof sanitized, "string");
    assert.equal(sanitized?.includes(token), false);
    assert.equal(sanitized?.includes("eyJ"), false);
    assert.match(sanitized ?? "", /_timeFetched\\?":0/);
  }
  assert.equal(sanitizeCachedDocument(`token=${token}`), null);
  assert.equal(sanitizeCachedDocument("<p>No session</p>"), "<p>No session</p>");
});

test("a token split across two pushes is never cached", () => {
  for (const cut of [4, 12, 20, 40]) {
    const html =
      `<script>self.__next_f.push([1,"{\\"token\\":\\"${token.slice(0, cut)}"])</script>` +
      `<script>self.__next_f.push([1,"${token.slice(cut)}\\"}"])</script>`;
    assert.equal(sanitizeCachedDocument(html), null, `cut at ${cut}`);
  }
});

test("an update copies static files, sanitizes documents, and drops other bodies", () => {
  assert.equal(cachedEntryKind("/_next/static/chunk.js", "application/javascript"), "static");
  assert.equal(cachedEntryKind("/icons/icon-192.png", "image/png"), "static");
  assert.equal(cachedEntryKind("/", "text/html; charset=utf-8"), "document");
  assert.equal(cachedEntryKind("/history", "application/octet-stream"), "drop");
});

test("the worker sanitizer matches the app and purges the legacy cache", () => {
  const source = serviceWorkerSource(shellCacheName("test-build"));
  assert.match(source, /workout-shell-v2-test-build/);
  assert.match(source, /caches\.delete\(key\)/);
  assert.match(source, /searchParams\.has\("code"\)/);
  assert.match(source, /no-store/);
  assert.match(source, /skipWaiting/);
  assert.match(source, /clients\.claim/);
  assert.match(source, /MAX_ENTRIES/);
  const start = source.indexOf("function sanitizeCachedDocument");
  const end = source.indexOf("/* end-sanitizeCachedDocument */");
  const workerSanitize = new Function(
    `${source.slice(start, end)}; return sanitizeCachedDocument;`,
  )() as (html: string) => string | null;

  const html = `{"token":"${token}","_timeFetched":42}<p>Bench</p>`;
  assert.equal(workerSanitize(html), sanitizeCachedDocument(html));
  assert.equal(workerSanitize(`token=${token}`), null);
  const split = `"${token.slice(0, 20)}"])</script><script>push(["${token.slice(20)}"`;
  assert.equal(workerSanitize(split), null);
});
