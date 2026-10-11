import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import zlib from "node:zlib";
import { installOffer, isIosSafari } from "../lib/pwa/installOffer.ts";
import {
  pwaBackgroundColor,
  pwaThemeColor,
  webAppManifest,
} from "../lib/pwa/manifest.ts";

const root = path.resolve(import.meta.dirname, "..");

test("manifest meets Chrome installability criteria", () => {
  assert.equal(webAppManifest.name, "Workout");
  assert.equal(webAppManifest.short_name, "Workout");
  assert.ok(webAppManifest.name && webAppManifest.short_name);
  assert.equal(webAppManifest.start_url, "/");
  assert.equal(webAppManifest.scope, "/");
  assert.equal(webAppManifest.id, "/");
  assert.equal(webAppManifest.display, "standalone");
  assert.equal(webAppManifest.theme_color, pwaThemeColor);
  assert.equal(webAppManifest.background_color, pwaBackgroundColor);
  assert.equal(webAppManifest.theme_color, "#f7f7f5");
  assert.equal(webAppManifest.background_color, "#f7f7f5");
  assert.notEqual(webAppManifest.prefer_related_applications, true);

  const icons = webAppManifest.icons ?? [];
  for (const size of ["192x192", "512x512"]) {
    assert.ok(
      icons.some(
        (icon) =>
          icon.sizes === size &&
          icon.type === "image/png" &&
          icon.purpose === "any",
      ),
      `missing purpose any ${size} icon`,
    );
    assert.ok(
      icons.some(
        (icon) =>
          icon.sizes === size &&
          icon.type === "image/png" &&
          icon.purpose === "maskable",
      ),
      `missing maskable ${size} icon`,
    );
  }
});

test("icons are opaque PNGs with the glyph inside the maskable safe zone", () => {
  const icons = webAppManifest.icons ?? [];
  assert.ok(icons.length >= 4);
  for (const icon of icons) {
    const file = path.join(root, "public", icon.src);
    const image = readPng(file);
    const [width, height] = (icon.sizes ?? "0x0").split("x").map(Number);
    assert.equal(image.width, width);
    assert.equal(image.height, height);
    assert.deepEqual(pixel(image, 0, 0), [0x0e, 0x0f, 0x11]);
    assert.deepEqual(pixel(image, width - 1, height - 1), [0x0e, 0x0f, 0x11]);

    let glyph = 0;
    const limit = 0.4 * width;
    const center = width / 2;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const [red, green, blue] = pixel(image, x, y);
        const background = red === 0x0e && green === 0x0f && blue === 0x11;
        if (background) {
          continue;
        }
        const distance = Math.hypot(x + 0.5 - center, y + 0.5 - center);
        assert.ok(
          distance <= limit + 1,
          `${icon.src} paints outside the maskable safe zone`,
        );
        if (red === 0xf7 && green === 0xf7 && blue === 0xf5) {
          glyph += 1;
        }
      }
    }
    assert.ok(glyph > 0, `${icon.src} has no off-white glyph pixels`);
  }
});

test("the manifest link is in the initial document head", () => {
  const layout = fs.readFileSync(path.join(root, "app/layout.tsx"), "utf8");
  assert.match(layout, /<link rel="manifest" href="\/manifest\.webmanifest" \/>/);
  assert.equal(fs.existsSync(path.join(root, "app/manifest.ts")), false);
  assert.equal(
    fs.existsSync(path.join(root, "app/manifest.webmanifest/route.ts")),
    true,
  );
});

test("no service worker is shipped that could cache workouts", () => {
  for (const relative of [
    "public/sw.js",
    "public/service-worker.js",
    "app/sw.ts",
    "app/sw.js",
  ]) {
    assert.equal(fs.existsSync(path.join(root, relative)), false, relative);
  }
});

test("install offer is hidden once the app is installed", () => {
  assert.equal(
    installOffer({
      installed: true,
      promptAvailable: true,
      iosSafari: true,
    }),
    "hidden",
  );
});

test("install button shows only when the browser offers installation", () => {
  assert.equal(
    installOffer({
      installed: false,
      promptAvailable: true,
      iosSafari: false,
    }),
    "install",
  );
  assert.equal(
    installOffer({
      installed: false,
      promptAvailable: false,
      iosSafari: false,
    }),
    "hidden",
  );
  assert.equal(
    installOffer({
      installed: false,
      promptAvailable: true,
      iosSafari: true,
    }),
    "install",
  );
});

test("iOS Safari gets an Add to Home Screen hint and other browsers do not", () => {
  const iphoneSafari =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";
  const iphoneChrome =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/128.0.6613.98 Mobile/15E148 Safari/604.1";
  const ipadSafari =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15";
  const androidChrome =
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36";
  const desktopChrome =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

  assert.equal(
    isIosSafari({
      userAgent: iphoneSafari,
      platform: "iPhone",
      maxTouchPoints: 5,
    }),
    true,
  );
  assert.equal(
    isIosSafari({
      userAgent: iphoneChrome,
      platform: "iPhone",
      maxTouchPoints: 5,
    }),
    false,
  );
  assert.equal(
    isIosSafari({
      userAgent: ipadSafari,
      platform: "MacIntel",
      maxTouchPoints: 5,
    }),
    true,
  );
  assert.equal(
    isIosSafari({
      userAgent: ipadSafari,
      platform: "MacIntel",
      maxTouchPoints: 0,
    }),
    false,
  );
  assert.equal(
    isIosSafari({
      userAgent: androidChrome,
      platform: "Linux armv8l",
      maxTouchPoints: 5,
    }),
    false,
  );
  assert.equal(
    isIosSafari({
      userAgent: desktopChrome,
      platform: "Win32",
      maxTouchPoints: 0,
    }),
    false,
  );

  assert.equal(
    installOffer({
      installed: false,
      promptAvailable: false,
      iosSafari: isIosSafari({
        userAgent: iphoneSafari,
        platform: "iPhone",
        maxTouchPoints: 5,
      }),
    }),
    "ios-hint",
  );
});

type RgbImage = {
  width: number;
  height: number;
  pixels: Buffer;
};

function readPng(file: string): RgbImage {
  const buf = fs.readFileSync(file);
  assert.equal(buf.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  let offset = 8;
  let width = 0;
  let height = 0;
  const idats: Buffer[] = [];
  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString("ascii", offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      assert.equal(data[8], 8);
      assert.equal(data[9], 2);
    } else if (type === "IDAT") {
      idats.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length;
  }
  const raw = zlib.inflateSync(Buffer.concat(idats));
  const pixels = Buffer.alloc(width * height * 3);
  let source = 0;
  for (let y = 0; y < height; y += 1) {
    assert.equal(raw[source], 0);
    source += 1;
    raw.copy(pixels, y * width * 3, source, source + width * 3);
    source += width * 3;
  }
  return { width, height, pixels };
}

function pixel(image: RgbImage, x: number, y: number): [number, number, number] {
  const index = (y * image.width + x) * 3;
  return [
    image.pixels[index] ?? 0,
    image.pixels[index + 1] ?? 0,
    image.pixels[index + 2] ?? 0,
  ];
}
