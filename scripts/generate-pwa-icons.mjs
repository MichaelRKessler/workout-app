/**
 * Rasterize public/icons/icon.svg into the PWA icon set.
 *
 * Usage: node scripts/generate-pwa-icons.mjs
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const svg = readFileSync(resolve(root, "public/icons/icon.svg"));

function render(size) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: size },
    shapeRendering: 2,
  });
  const image = resvg.render();
  if (image.width !== size || image.height !== size) {
    throw new Error(`expected ${size}px, got ${image.width}x${image.height}`);
  }
  return image.asPng();
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
