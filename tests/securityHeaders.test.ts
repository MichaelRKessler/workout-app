import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { contentSecurityPolicy, securityHeaders } from "../lib/securityHeaders.ts";

test("responses send the clickjacking, referrer, and microphone policy", () => {
  const headers = new Map(securityHeaders.map((header) => [header.key, header.value]));
  assert.equal(headers.get("Referrer-Policy"), "same-origin");
  assert.equal(headers.get("Permissions-Policy"), "microphone=(self)");
  assert.equal(headers.get("Content-Security-Policy"), contentSecurityPolicy);
  assert.match(contentSecurityPolicy, /frame-ancestors 'none'/);
  assert.match(contentSecurityPolicy, /connect-src[^;]*wss:\/\/\*\.convex\.cloud/);
  assert.match(contentSecurityPolicy, /connect-src[^;]*https:\/\/\*\.convex\.cloud/);
  assert.doesNotMatch(headers.get("Permissions-Policy") ?? "", /screen-wake-lock/);
  assert.doesNotMatch(contentSecurityPolicy, /navigate-to/);
  assert.match(contentSecurityPolicy, /img-src[^;]*https:\/\/cdn\.jsdelivr\.net/);

  const config = fs.readFileSync(path.resolve(import.meta.dirname, "../next.config.ts"), "utf8");
  assert.match(config, /securityHeaders/);
  assert.match(config, /headers\(\)/);
});
