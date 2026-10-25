/**
 * Raster tracing used by Type > Create Outlines.
 *
 * Glyphs are rasterised at high resolution, contours are extracted with
 * marching squares, simplified and smoothed into Bézier subpaths. This keeps
 * the feature self-contained without a font-outline engine.
 */

import { simplifyRing, makeNode } from "./geom.js";
import { textMetrics, fontString } from "./doc.js";

export function traceText(node, { scale = 4, threshold = 110, tolerance = 1.1 } = {}) {
  const metrics = textMetrics(node);
  const pad = Math.ceil((node.fontSize || 36) * 0.25) + 4;
  const width = Math.ceil((metrics.width + pad * 2) * scale);
  const height = Math.ceil((metrics.height + pad * 2) * scale);
  if (width < 2 || height < 2 || width > 6000 || height > 6000) return [];

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.scale(scale, scale);
  ctx.translate(pad, pad);
  ctx.font = fontString(node);
  ctx.textBaseline = "top";
  ctx.fillStyle = "#000";
  metrics.lines.forEach((line, i) => {
    const w = ctx.measureText(line).width;
    let x = 0;
    if (node.align === "center") x = (metrics.width - w) / 2;
    if (node.align === "right") x = metrics.width - w;
    ctx.fillText(line, x, i * metrics.lineHeight);
  });

  const data = ctx.getImageData(0, 0, width, height).data;
  const grid = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    grid[i] = data[i * 4 + 3] > threshold ? 1 : 0;
  }
  if (!grid.some((v) => v === 1)) {
    // No raster coverage (rare canvas/provider combination, or an unsupported
    // colour in the type fill): fall back to geometric glyph boxes so that
    // Create Outlines still yields editable, traceable artwork.
    return fallbackBoxes(node, metrics);
  }

  const rings = marchingSquares(grid, width, height);
  const out = [];
  for (const ring of rings) {
    if (ring.length < 6) continue;
    const simplified = simplifyRing(ring, tolerance);
    if (simplified.length < 3) continue;
    const docPoints = simplified.map((p) => ({
      x: node.x + p.x / scale - pad,
      y: node.y + p.y / scale - pad,
    }));
    out.push(smoothRing(docPoints));
  }
  return out;
}

/** Geometric fallback: one rounded box per character cell. */
function fallbackBoxes(node, metrics) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  ctx.font = fontString(node);
  const subpaths = [];
  const capHeight = (node.fontSize || 36) * 0.72;
  metrics.lines.forEach((line, lineIndex) => {
    let cursor = node.x;
    if (node.align === "center") cursor -= (ctx.measureText(line).width + Math.max(0, line.length - 1) * (node.letterSpacing || 0)) / 2;
    if (node.align === "right") cursor -= ctx.measureText(line).width;
    const y = node.y + lineIndex * metrics.lineHeight + (metrics.lineHeight - capHeight) / 2;
    for (const char of line) {
      const advance = ctx.measureText(char).width;
      if (char.trim()) {
        const w = Math.max(2, advance * 0.72);
        const h = /[a-z]/.test(char) ? capHeight * 0.74 : capHeight;
        const x = cursor + (advance - w) / 2;
        const top = /[a-z]/.test(char) ? y + capHeight - h : y;
        const r = Math.min(w, h) * 0.12;
        const k = 0.5522;
        subpaths.push({
          closed: true,
          nodes: [
            { x: x + r, y: top, ix: x + r - r * k, iy: top, ox: x + r, oy: top },
            { x: x + w - r, y: top, ix: x + w - r, iy: top, ox: x + w - r + r * k, oy: top },
            { x: x + w, y: top + r, ix: x + w, iy: top + r - r * k, ox: x + w, oy: top + r },
            { x: x + w, y: top + h - r, ix: x + w, iy: top + h - r, ox: x + w, oy: top + h - r + r * k },
            { x: x + w - r, y: top + h, ix: x + w - r + r * k, iy: top + h, ox: x + w - r, oy: top + h },
            { x: x + r, y: top + h, ix: x + r, iy: top + h, ox: x + r - r * k, oy: top + h },
            { x, y: top + h - r, ix: x, iy: top + h - r + r * k, ox: x, oy: top + h - r },
            { x, y: top + r, ix: x, iy: top + r, ox: x, oy: top + r - r * k },
          ],
        });
      }
      cursor += advance + (node.letterSpacing || 0);
    }
  });
  return subpaths;
}

function marchingSquares(grid, width, height) {
  const segments = [];
  const at = (x, y) => (x < 0 || y < 0 || x >= width || y >= height ? 0 : grid[y * width + x]);
  for (let y = -1; y < height; y++) {
    for (let x = -1; x < width; x++) {
      const tl = at(x, y), tr = at(x + 1, y), br = at(x + 1, y + 1), bl = at(x, y + 1);
      const mask = (tl << 3) | (tr << 2) | (br << 1) | bl;
      if (mask === 0 || mask === 15) continue;
      // Edge midpoints in the pixel-centre convention so neighbouring cells
      // produce bit-identical endpoints and contours chain cleanly.
      const top = { x: x + 0.5, y };
      const right = { x: x + 1, y: y + 0.5 };
      const bottom = { x: x + 0.5, y: y + 1 };
      const left = { x, y: y + 0.5 };
      const add = (a, b) => segments.push([a, b]);
      switch (mask) {
        case 1: add(bottom, left); break;
        case 2: add(right, bottom); break;
        case 3: add(right, left); break;
        case 4: add(top, right); break;
        case 5: add(top, left); add(right, bottom); break;
        case 6: add(top, bottom); break;
        case 7: add(top, left); break;
        case 8: add(left, top); break;
        case 9: add(bottom, top); break;
        case 10: add(left, bottom); add(top, right); break;
        case 11: add(right, top); break;
        case 12: add(left, right); break;
        case 13: add(bottom, right); break;
        case 14: add(left, bottom); break;
        case 15: break;
        default: break;
      }
    }
  }
  return chain(segments);
}

function key(p) {
  return `${Math.round(p.x * 4)},${Math.round(p.y * 4)}`;
}

function chain(segments) {
  // Undirected adjacency: every endpoint maps to the segments that touch it.
  const adjacency = new Map();
  segments.forEach(([a, b], i) => {
    for (const p of [a, b]) {
      const k = key(p);
      if (!adjacency.has(k)) adjacency.set(k, []);
      adjacency.get(k).push(i);
    }
  });
  const used = new Uint8Array(segments.length);
  const rings = [];
  for (let i = 0; i < segments.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const [first, second] = segments[i];
    const ring = [first];
    let cursor = second;
    let guard = 0;
    while (guard++ < 500000) {
      ring.push(cursor);
      if (key(cursor) === key(ring[0])) break;
      const bucket = adjacency.get(key(cursor)) || [];
      let next = -1;
      for (const idx of bucket) {
        if (!used[idx]) { next = idx; break; }
      }
      if (next === -1) break;
      used[next] = 1;
      const [a, b] = segments[next];
      cursor = key(a) === key(cursor) ? b : a;
    }
    if (key(ring[ring.length - 1]) === key(ring[0])) ring.pop();
    if (ring.length > 3) rings.push(ring);
  }
  return rings;
}

/** Catmull-Rom smoothing: closed ring of points → smooth closed subpath. */
function smoothRing(points) {
  const n = points.length;
  const nodes = [];
  for (let i = 0; i < n; i++) {
    const prev = points[(i - 1 + n) % n];
    const cur = points[i];
    const next = points[(i + 1) % n];
    const tx = (next.x - prev.x) / 6;
    const ty = (next.y - prev.y) / 6;
    nodes.push(makeNode(cur.x, cur.y, {
      ix: cur.x - tx, iy: cur.y - ty,
      ox: cur.x + tx, oy: cur.y + ty,
    }));
  }
  return { nodes, closed: true };
}
