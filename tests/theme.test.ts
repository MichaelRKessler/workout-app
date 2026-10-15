import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { pwaBackgroundColor, pwaThemeColor } from "../lib/pwa/manifest.ts";
import {
  appleStatusBarStyle,
  parseTheme,
  THEME_COLORS,
  themeCookie,
} from "../lib/theme.ts";

test("matching the phone is the default and only exact values pick a theme", () => {
  assert.equal(parseTheme(undefined), "system");
  assert.equal(parseTheme(""), "system");
  assert.equal(parseTheme("system"), "system");
  assert.equal(parseTheme("DARK"), "system");
  assert.equal(parseTheme("light"), "light");
  assert.equal(parseTheme("dark"), "dark");
});

test("the match-phone block uses exactly the dark tokens", () => {
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  const tokens = (block: string) =>
    [...block.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((match) => `${match[1]}:${match[2]}`);
  const dark = css.match(/:root\[data-theme="dark"\]\s*\{([^}]+)\}/)?.[1] ?? "";
  const system = css.match(/:root\[data-theme="system"\]\s*\{([^}]+)\}/)?.[1] ?? "";
  assert.ok(tokens(dark).length > 10);
  assert.deepEqual(tokens(system), tokens(dark));
});

test("the cookie lasts a year and is readable by the server on every path", () => {
  const cookie = themeCookie("dark");
  assert.match(cookie, /^theme=dark;/);
  assert.match(cookie, /Path=\//);
  assert.match(cookie, /Max-Age=31536000/);
  assert.match(cookie, /SameSite=Lax/);
});

test("browser chrome matches the page background", () => {
  assert.equal(THEME_COLORS.light, pwaThemeColor);
  assert.equal(THEME_COLORS.light, pwaBackgroundColor);
  assert.equal(appleStatusBarStyle("light"), "default");
  assert.equal(appleStatusBarStyle("dark"), "black");
  assert.equal(appleStatusBarStyle("system"), "default");
});
