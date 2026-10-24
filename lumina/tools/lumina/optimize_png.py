#!/usr/bin/env python3
"""Re-encodes Lumina stills with real deflate compression.

The runtime PNG writer is dependency-free and therefore uses *stored* deflate
blocks, which is ideal for a device with no zlib but produces large files (~4 MB
for 1280x800). This tool is the offline half: it applies the PNG "Sub" filter
and deflate level 9 using Python's zlib, typically shrinking a still by 80-95%
so screenshots can live in the repository.

    python3 tools/lumina/optimize_png.py out/02-desktop.png assets/desktop.png
    python3 tools/lumina/optimize_png.py --all out assets
"""

from __future__ import annotations

import argparse
import struct
import sys
import zlib
from pathlib import Path
from typing import List, Optional, Tuple

PNG_MAGIC = b"\x89PNG\r\n\x1a\n"


def read_chunks(data: bytes) -> List[Tuple[bytes, bytes]]:
    chunks: List[Tuple[bytes, bytes]] = []
    offset = 8
    while offset < len(data):
        (length,) = struct.unpack(">I", data[offset:offset + 4])
        kind = data[offset + 4:offset + 8]
        payload = data[offset + 8:offset + 8 + length]
        chunks.append((kind, payload))
        offset += 12 + length
    return chunks


def paeth(a: int, b: int, c: int) -> int:
    estimate = a + b - c
    pa, pb, pc = abs(estimate - a), abs(estimate - b), abs(estimate - c)
    if pa <= pb and pa <= pc:
        return a
    if pb <= pc:
        return b
    return c


def filter_sub(raw: bytes, width: int, height: int, bpp: int = 4) -> bytes:
    """Applies PNG filter type 1 (Sub) row by row."""
    stride = width * bpp
    out = bytearray()
    previous = bytes(stride)
    for y in range(height):
        row = raw[y * stride:(y + 1) * stride]
        filtered = bytearray(stride)
        for i in range(stride):
            left = row[i - bpp] if i >= bpp else 0
            filtered[i] = (row[i] - left) & 0xFF
        out.append(1)  # filter type: Sub
        out += filtered
        previous = row
    return bytes(out)


def unfilter(raw: bytes, width: int, height: int, bpp: int = 4) -> bytes:
    stride = width * bpp
    out = bytearray()
    previous = bytearray(stride)
    for y in range(height):
        start = y * (stride + 1)
        kind = raw[start]
        row = bytearray(raw[start + 1:start + 1 + stride])
        if kind == 1:
            for i in range(bpp, stride):
                row[i] = (row[i] + row[i - bpp]) & 0xFF
        elif kind == 2:
            for i in range(stride):
                row[i] = (row[i] + previous[i]) & 0xFF
        elif kind == 3:
            for i in range(stride):
                left = row[i - bpp] if i >= bpp else 0
                row[i] = (row[i] + (left + previous[i]) // 2) & 0xFF
        elif kind == 4:
            for i in range(stride):
                left = row[i - bpp] if i >= bpp else 0
                up_left = previous[i - bpp] if i >= bpp else 0
                row[i] = (row[i] + paeth(left, previous[i], up_left)) & 0xFF
        out += row
        previous = row
    return bytes(out)


def chunk(kind: bytes, payload: bytes) -> bytes:
    crc = zlib.crc32(kind + payload) & 0xFFFFFFFF
    return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", crc)


def optimize(source: Path, target: Path) -> Tuple[int, int]:
    data = source.read_bytes()
    if not data.startswith(PNG_MAGIC):
        raise ValueError(f"{source}: not a PNG")
    chunks = read_chunks(data)
    width = height = 0
    idat = b""
    for kind, payload in chunks:
        if kind == b"IHDR":
            width, height, depth, colour = struct.unpack(">IIBB", payload[:10])
            if depth != 8 or colour != 6:
                raise ValueError(f"{source}: expected 8-bit RGBA")
        elif kind == b"IDAT":
            idat += payload
    raw = zlib.decompress(idat)
    pixels = unfilter(raw, width, height)
    recompressed = zlib.compress(filter_sub(pixels, width, height), 9)

    output = bytearray(PNG_MAGIC)
    for kind, payload in chunks:
        if kind == b"IDAT":
            continue
        if kind == b"IEND":
            output += chunk(b"IDAT", recompressed)
        output += chunk(kind, payload)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(bytes(output))
    return len(data), len(output)


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Recompress Lumina PNG stills")
    parser.add_argument("source", nargs="?")
    parser.add_argument("target", nargs="?")
    parser.add_argument("--all", nargs=2, metavar=("SRC_DIR", "DST_DIR"))
    options = parser.parse_args(argv)

    if options.all:
        source_dir, target_dir = Path(options.all[0]), Path(options.all[1])
        for png in sorted(source_dir.glob("*.png")):
            before, after = optimize(png, target_dir / png.name)
            saved = 100.0 * (1 - after / before)
            print(f"  {png.name:<24}{before / 1024:8.0f} KiB -> {after / 1024:7.0f} KiB "
                  f"({saved:4.1f}% smaller)")
        return 0

    if not options.source or not options.target:
        parser.error("source and target are required (or use --all)")

    before, after = optimize(Path(options.source), Path(options.target))
    print(f"{options.source}: {before / 1024:.0f} KiB -> {after / 1024:.0f} KiB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
