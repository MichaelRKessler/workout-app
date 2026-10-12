import assert from "node:assert/strict";
import test from "node:test";
import {
  isInstalledDisplayMode,
  startConfirmCopy,
  startNeedsConfirmation,
} from "../lib/startConfirm.ts";

const pageOrigin = "https://repsandsets.vercel.app";

test("a browser visit must confirm before starting a workout", () => {
  assert.equal(
    startNeedsConfirmation({ installed: false, referrer: "", pageOrigin, source: "shortcut" }),
    true,
  );
  assert.equal(
    startNeedsConfirmation({
      installed: false,
      referrer: "https://evil.example/link",
      pageOrigin,
      source: "shortcut",
    }),
    true,
  );
  assert.equal(
    startNeedsConfirmation({
      installed: true,
      referrer: "https://evil.example/link",
      pageOrigin,
      source: "shortcut",
    }),
    true,
  );
});

test("an installed shortcut starts without a second confirmation", () => {
  assert.equal(
    startNeedsConfirmation({ installed: true, referrer: "", pageOrigin, source: "shortcut" }),
    false,
  );
  assert.equal(
    startNeedsConfirmation({
      installed: true,
      referrer: "android-app://com.chrome",
      pageOrigin,
      source: "shortcut",
    }),
    false,
  );
  assert.equal(
    startNeedsConfirmation({
      installed: true,
      referrer: `${pageOrigin}/`,
      pageOrigin,
      source: null,
    }),
    false,
  );
  assert.equal(isInstalledDisplayMode("standalone"), true);
  assert.equal(isInstalledDisplayMode("browser"), false);
});

test("a link another app opens in the installed app still asks first", () => {
  assert.equal(
    startNeedsConfirmation({
      installed: true,
      referrer: "android-app://com.google.android.gm/",
      pageOrigin,
      source: null,
    }),
    true,
  );
  assert.equal(
    startNeedsConfirmation({ installed: true, referrer: "", pageOrigin, source: null }),
    true,
  );
});

test("the confirm copy names the shortcut", () => {
  assert.equal(startConfirmCopy({ action: "repeat", routineId: null }).confirmLabel, "Repeat workout");
  assert.equal(startConfirmCopy({ action: "new", routineId: "routine-1" }).title, "Start this routine?");
  assert.equal(startConfirmCopy({ action: "new", routineId: null }).confirmLabel, "Start workout");
});
