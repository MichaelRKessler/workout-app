#!/usr/bin/env python3
"""Draw the Workout app icons: dark field, lime barbell, safe-zone glyph.

Stdlib only. Run from the repo root: python3 scripts/generate-pwa-icons.py
"""

from __future__ import annotations

import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BG = (0x12, 0x11, 0x0E)
LIME = (0xD6, 0xF2, 0x5C)


def blend(coverage: float) -> tuple[int, int, int]:
    return tuple(
        round(BG[channel] + (LIME[channel] - BG[channel]) * coverage)
        for channel in range(3)
    )


def barbell(x: float, y: float, size: int) -> bool:
    center = size / 2
    plate_r = size * 0.125
    dx = size * 0.21
    outer = dx + plate_r
    limit = size * 0.36
    if outer > limit:
        plate_r *= limit / outer
        dx *= limit / outer
    bar_half = max(size * 0.018, 1.1)
    hole_r = plate_r * 0.36 if size >= 64 else 0.0
    left = center - dx
    right = center + dx

    def inside(px: float, py: float, radius: float) -> bool:
        return (x - px) ** 2 + (y - py) ** 2 <= radius**2

    on_plate = inside(left, center, plate_r) or inside(right, center, plate_r)
    on_hole = hole_r > 0 and (inside(left, center, hole_r) or inside(right, center, hole_r))
    gap_left = left + plate_r
    gap_right = right - plate_r
    on_bar = gap_left <= x <= gap_right and abs(y - center) <= bar_half
    return (on_plate and not on_hole) or on_bar


def render(size: int) -> bytes:
    samples = 4
    pixels = bytearray(size * size * 3)
    index = 0
    for y in range(size):
        for x in range(size):
            hits = 0
            for sy in range(samples):
                for sx in range(samples):
                    fx = x + (sx + 0.5) / samples
                    fy = y + (sy + 0.5) / samples
                    if barbell(fx, fy, size):
                        hits += 1
            red, green, blue = blend(hits / (samples * samples))
            pixels[index] = red
            pixels[index + 1] = green
            pixels[index + 2] = blue
            index += 3
    return png_bytes(size, size, pixels)


def chunk(tag: bytes, data: bytes) -> bytes:
    return (
        struct.pack(">I", len(data))
        + tag
        + data
        + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    )


def png_bytes(width: int, height: int, rgb: bytes) -> bytes:
    raw = bytearray()
    stride = width * 3
    for y in range(height):
        raw.append(0)
        start = y * stride
        raw.extend(rgb[start : start + stride])
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + chunk(b"IEND", b"")
    )


def write_ico(path: Path, images: list[tuple[int, bytes]]) -> None:
    count = len(images)
    header = struct.pack("<HHH", 0, 1, count)
    offset = 6 + 16 * count
    entries = bytearray()
    blobs = bytearray()
    for size, png in images:
        entries.extend(
            struct.pack(
                "<BBBBHHII",
                size if size < 256 else 0,
                size if size < 256 else 0,
                0,
                0,
                1,
                32,
                len(png),
                offset,
            )
        )
        offset += len(png)
        blobs.extend(png)
    path.write_bytes(header + entries + blobs)


def main() -> None:
    icons = ROOT / "public" / "icons"
    icons.mkdir(parents=True, exist_ok=True)
    any_sizes = {
        192: icons / "icon-192.png",
        512: icons / "icon-512.png",
    }
    maskable = {
        192: icons / "icon-maskable-192.png",
        512: icons / "icon-maskable-512.png",
    }
    rendered: dict[int, bytes] = {}
    for size, path in any_sizes.items():
        png = render(size)
        rendered[size] = png
        path.write_bytes(png)
        print(f"wrote {path.relative_to(ROOT)} ({len(png)} bytes)")
    for size, path in maskable.items():
        path.write_bytes(rendered[size])
        print(f"wrote {path.relative_to(ROOT)} ({len(rendered[size])} bytes)")
    apple = render(180)
    apple_path = icons / "apple-touch-icon.png"
    apple_path.write_bytes(apple)
    print(f"wrote {apple_path.relative_to(ROOT)} ({len(apple)} bytes)")
    favicon = ROOT / "app" / "favicon.ico"
    write_ico(favicon, [(16, render(16)), (32, render(32)), (48, render(48))])
    print(f"wrote {favicon.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
