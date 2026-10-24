/**
 * Generate the TallyCraft app icons with no dependencies.
 *
 * A PWA needs raster icons, but the sandbox has no SVG rasteriser (no
 * rsvg, no canvas, no sharp). The mark is simple enough to draw directly:
 * a navy rounded square, a gold "T" ledger rule, a baseline and a balance
 * rule. Rasterising it here keeps the icons reproducible and diffable instead
 * of being opaque binaries nobody can regenerate.
 *
 * Usage: node scripts/generate-icons.mjs [--out public/icons]
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SS = 4; // supersampling factor, box-filtered down for clean edges

/** Brand palette, matching public/styles.css. */
const NAVY_TOP = [20, 84, 143];
const NAVY_BOTTOM = [11, 47, 82];
const GOLD_TOP = [255, 210, 74];
const GOLD_BOTTOM = [242, 169, 0];

const clamp = (value) => Math.min(1, Math.max(0, value));
const mix = (a, b, t) => a.map((channel, i) => channel + (b[i] - channel) * t);

/** Signed distance to a rounded rectangle, negative inside. */
function roundedRect(x, y, rect) {
  const halfW = (rect.right - rect.left) / 2;
  const halfH = (rect.bottom - rect.top) / 2;
  const dx = Math.abs(x - (rect.left + halfW)) - (halfW - rect.radius);
  const dy = Math.abs(y - (rect.top + halfH)) - (halfH - rect.radius);
  const outside =
    Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) +
    Math.min(Math.max(dx, dy), 0);
  return outside - rect.radius;
}

const SHELL_BOX = { left: 0, top: 0, right: 1, bottom: 1, radius: 0.22 };
const CROSSBAR = {
  left: 0.293,
  top: 0.215,
  right: 0.707,
  bottom: 0.295,
  radius: 0.04,
};
const STEM = {
  left: 0.452,
  top: 0.255,
  right: 0.548,
  bottom: 0.72,
  radius: 0.048,
};
const BASELINE = {
  left: 0.25,
  top: 0.76,
  right: 0.75,
  bottom: 0.81,
  radius: 0.025,
};
const BALANCE = {
  left: 0.25,
  top: 0.65,
  right: 0.75,
  bottom: 0.675,
  radius: 0.012,
};

/** Colour of the mark at unit coordinates (0..1), or null for transparent. */
function sample(u, v) {
  if (roundedRect(u, v, SHELL_BOX) > 0) return null;
  const background = mix(NAVY_TOP, NAVY_BOTTOM, clamp(u * 0.55 + v * 0.45));

  // The "T": crossbar, stem, baseline, and a lighter balance rule above it.
  if (roundedRect(u, v, BASELINE) <= 0) return mix(GOLD_TOP, GOLD_BOTTOM, 0.35);
  if (roundedRect(u, v, BALANCE) <= 0) return mix(NAVY_TOP, GOLD_TOP, 0.42);
  if (roundedRect(u, v, CROSSBAR) <= 0) return mix(GOLD_TOP, GOLD_BOTTOM, v);
  if (roundedRect(u, v, STEM) <= 0) return mix(GOLD_TOP, GOLD_BOTTOM, v);
  return background;
}

/** Average one output pixel from its SS×SS samples: [r, g, b, alpha]. */
function shadePixel(x, y, size, step) {
  let r = 0;
  let g = 0;
  let b = 0;
  let hits = 0;
  for (let sy = 0; sy < SS; sy += 1) {
    for (let sx = 0; sx < SS; sx += 1) {
      const u = (x * SS + sx + 0.5) * step;
      const v = (y * SS + sy + 0.5) * step;
      const colour = sample(u, v);
      if (colour === null) continue;
      r += colour[0];
      g += colour[1];
      b += colour[2];
      hits += 1;
    }
  }
  if (hits === 0) return null;
  const samples = SS * SS;
  return [
    Math.round(r / hits),
    Math.round(g / hits),
    Math.round(b / hits),
    Math.round((hits / samples) * 255),
  ];
}

/** Render one square icon as RGBA pixels, box-filtered from SS×SS samples. */
function render(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const step = 1 / (size * SS);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const pixel = shadePixel(x, y, size, step);
      if (pixel === null) continue;
      const index = (y * size + x) * 4;
      pixels[index] = pixel[0];
      pixels[index + 1] = pixel[1];
      pixels[index + 2] = pixel[2];
      pixels[index + 3] = pixel[3];
    }
  }
  return pixels;
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(size, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    const row = y * (size * 4 + 1);
    raw[row] = 0; // no filter
    pixels.copy(raw, row + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** An .ico holding PNG-compressed frames, which every current browser reads. */
function encodeIco(frames) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(frames.length, 4);
  let offset = 6 + frames.length * 16;
  const entries = frames.map(({ size, png }) => {
    const entry = Buffer.alloc(16);
    entry[0] = size >= 256 ? 0 : size;
    entry[1] = size >= 256 ? 0 : size;
    entry[2] = 0;
    entry[3] = 0;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    return entry;
  });
  return Buffer.concat([
    header,
    ...entries,
    ...frames.map((frame) => frame.png),
  ]);
}

function main() {
  const outDir = resolve(projectRoot, "public", "icons");
  mkdirSync(outDir, { recursive: true });

  const raster = (size) => ({ size, png: encodePng(size, render(size)) });

  for (const size of [1024, 512, 192, 180]) {
    const name = size === 180 ? "apple-touch-icon.png" : `icon-${size}.png`;
    writeFileSync(resolve(outDir, name), raster(size).png);
  }
  writeFileSync(
    resolve(projectRoot, "public", "favicon.ico"),
    encodeIco([32, 16].map((size) => raster(size))),
  );
  console.log(`Wrote icons to ${outDir} and public/favicon.ico`);
}

main();
