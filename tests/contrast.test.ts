import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function channel(hex: string, shift: number): number {
  const value = parseInt(hex.slice(1), 16) >> shift;
  const channelValue = (value & 255) / 255;
  return channelValue <= 0.04045
    ? channelValue / 12.92
    : ((channelValue + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  return 0.2126 * channel(hex, 16) + 0.7152 * channel(hex, 8) + 0.0722 * channel(hex, 0);
}

function contrast(foreground: string, background: string): number {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

function token(css: string, block: string, name: string): string {
  const section = css.match(new RegExp(`${block}\\s*\\{([^}]+)\\}`));
  assert.ok(section, block);
  const value = section[1]?.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`));
  assert.ok(value?.[1], name);
  return value[1];
}

test("accent text and input borders clear the contrast floors", () => {
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  const light = token(css, ":root", "--background");
  const lightSurface = token(css, ":root", "--surface");
  const lightInk = token(css, ":root", "--accent-ink");
  const lightInput = token(css, ":root", "--input-line");
  assert.ok(contrast(lightInk, lightSurface) >= 4.5);
  assert.ok(contrast(lightInk, light) >= 4.5);
  assert.ok(contrast(lightInput, lightSurface) >= 3);
  assert.ok(contrast(lightInput, light) >= 3);

  const darkBlock = String.raw`:root\[data-theme="dark"\]`;
  const dark = token(css, darkBlock, "--background");
  const darkSurface = token(css, darkBlock, "--surface");
  const darkInk = token(css, darkBlock, "--accent-ink");
  const darkInput = token(css, darkBlock, "--input-line");
  assert.ok(contrast(darkInk, darkSurface) >= 4.5);
  assert.ok(contrast(darkInk, dark) >= 4.5);
  assert.ok(contrast(darkInput, darkSurface) >= 3);
  assert.ok(contrast(darkInput, dark) >= 3);
});
