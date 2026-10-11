/**
 * Rasterize public/icons/icon.svg into the PWA icon set.
 *
 * Usage: node scripts/generate-pwa-icons.mjs
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateSync } from "node:zlib";
import { Resvg } from "@resvg/resvg-js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const svg = readFileSync(resolve(root, "public/icons/icon.svg"));

// Matches the <rect> fill in icon.svg. Edge pixels are blended onto it.
const BACKGROUND = [0x0e, 0x0f, 0x11];

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const name = Buffer.from(type);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])) >>> 0);
  return Buffer.concat([length, name, data, checksum]);
}

/** Opaque RGB PNG. The icon test and install surfaces expect color type 2. */
function rgbPng(width, height, rgba) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const source = (y * width + x) * 4;
      const dest = row + 1 + x * 3;
      const alpha = rgba[source + 3] / 255;
      for (let channel = 0; channel < 3; channel += 1) {
        raw[dest + channel] = Math.round(
          BACKGROUND[channel] * (1 - alpha) + rgba[source + channel] * alpha,
        );
      }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function render(size) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: size },
    shapeRendering: 2,
  });
  const image = resvg.render();
  if (image.width !== size || image.height !== size) {
    throw new Error(`expected ${size}px, got ${image.width}x${image.height}`);
  }
  return rgbPng(size, size, image.pixels);
}

function writeIco(path, images) {
  const count = images.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);
  let offset = 6 + 16 * count;
  const entries = [];
  const blobs = [];
  for (const [size, png] of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size < 256 ? size : 0, 0);
    entry.writeUInt8(size < 256 ? size : 0, 1);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    blobs.push(png);
    offset += png.length;
  }
  writeFileSync(path, Buffer.concat([header, ...entries, ...blobs]));
}

const iconsDir = resolve(root, "public/icons");
mkdirSync(iconsDir, { recursive: true });

const outputs = [
  [512, "icon-512.png"],
  [192, "icon-192.png"],
  [512, "icon-maskable-512.png"],
  [192, "icon-maskable-192.png"],
  [180, "apple-touch-icon.png"],
];

const rendered = new Map();
for (const [size, name] of outputs) {
  if (!rendered.has(size)) {
    rendered.set(size, render(size));
  }
  const file = resolve(iconsDir, name);
  writeFileSync(file, rendered.get(size));
  console.log(`wrote public/icons/${name} (${rendered.get(size).length} bytes)`);
}

const favicon = resolve(root, "app/favicon.ico");
writeIco(favicon, [16, 32, 48].map((size) => [size, render(size)]));
console.log("wrote app/favicon.ico");
