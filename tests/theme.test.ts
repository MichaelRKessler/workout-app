import assert from "node:assert/strict";
import test from "node:test";
import { pwaBackgroundColor, pwaThemeColor } from "../lib/pwa/manifest.ts";
import {
  appleStatusBarStyle,
  parseTheme,
  THEME_COLORS,
  themeCookie,
} from "../lib/theme.ts";

test("light is the default and only an exact dark value switches", () => {
  assert.equal(parseTheme(undefined), "light");
  assert.equal(parseTheme(""), "light");
  assert.equal(parseTheme("light"), "light");
  assert.equal(parseTheme("DARK"), "light");
  assert.equal(parseTheme("dark"), "dark");
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
});
