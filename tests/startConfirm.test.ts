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
    startNeedsConfirmation({ installed: false, referrer: "", pageOrigin }),
    true,
  );
  assert.equal(
    startNeedsConfirmation({
      installed: false,
      referrer: "https://evil.example/link",
      pageOrigin,
    }),
    true,
  );
  assert.equal(
    startNeedsConfirmation({
      installed: true,
      referrer: "https://evil.example/link",
      pageOrigin,
    }),
    true,
  );
});

test("an installed shortcut starts without a second confirmation", () => {
  assert.equal(
    startNeedsConfirmation({ installed: true, referrer: "", pageOrigin }),
    false,
  );
  assert.equal(
    startNeedsConfirmation({
      installed: true,
      referrer: "android-app://com.chrome",
      pageOrigin,
    }),
    false,
  );
  assert.equal(
    startNeedsConfirmation({
      installed: true,
      referrer: `${pageOrigin}/`,
      pageOrigin,
    }),
    false,
  );
  assert.equal(isInstalledDisplayMode("standalone"), true);
  assert.equal(isInstalledDisplayMode("browser"), false);
});

test("the confirm copy names the shortcut", () => {
  assert.equal(startConfirmCopy({ action: "repeat", routineId: null }).confirmLabel, "Repeat workout");
  assert.equal(startConfirmCopy({ action: "new", routineId: "routine-1" }).title, "Start this routine?");
  assert.equal(startConfirmCopy({ action: "new", routineId: null }).confirmLabel, "Start workout");
});
