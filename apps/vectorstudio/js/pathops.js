/**
 * Pathfinder and stroke-outline geometry.
 *
 * Boolean operations run on an arrangement of the flattened input rings:
 * edges are split at every crossing, each piece is classified on both sides
 * with winding numbers, boundary pieces are oriented interior-left and then
 * chained back into closed output rings.
 */

import {
  flattenSubpaths, simplifyRing, ringsToSubpaths, windingNumber, ringArea,
} from "./geom.js";

const EPS = 1e-6;
const SNAP = 1000;

const key = (p) => `${Math.round(p.x * SNAP)},${Math.round(p.y * SNAP)}`;
const snap = (p) => ({ x: Math.round(p.x * SNAP) / SNAP, y: Math.round(p.y * SNAP) / SNAP });

function flattenAll(subpaths, tol = 0.08) {
  return flattenSubpaths(subpaths, tol)
    .filter((r) => r.points.length > 2)
    .map((r) => {
      const pts = r.points.slice();
      const a = pts[0], b = pts[pts.length - 1];
      if (Math.hypot(a.x - b.x, a.y - b.y) < 1e-7) pts.pop();
      return pts;
    });
}

/* ------------------------------------------------------------ intersections */

function segIntersect(p1, p2, p3, p4) {
  const d1x = p2.x - p1.x, d1y = p2.y - p1.y;
  const d2x = p4.x - p3.x, d2y = p4.y - p3.y;
  const den = d1x * d2y - d1y * d2x;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / den;
  const u = ((p3.x - p1.x) * d1y - (p3.y - p1.y) * d1x) / den;
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
  return { t, u, x: p1.x + d1x * t, y: p1.y + d1y * t };
}

function segsOf(ring) {
  const out = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    if (Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS) continue;
    out.push({ a, b, ts: [], us: [] });
  }
  return out;
}

function splitSegments(segs, others, cell = 0) {
  // uniform grid over `others` for broad-phase
  const grid = new Map();
  const add = (p, item) => {
    const k = `${Math.floor(p.x / cell)},${Math.floor(p.y / cell)}`;
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(item);
  };
  for (const o of others) {
    add(o.a, o);
    add(o.b, o);
    const mx = (o.a.x + o.b.x) / 2, my = (o.a.y + o.b.y) / 2;
    add({ x: mx, y: my }, o);
  }
  const seen = new Set();
  for (const s of segs) {
    const minX = Math.min(s.a.x, s.b.x), maxX = Math.max(s.a.x, s.b.x);
    const minY = Math.min(s.a.y, s.b.y), maxY = Math.max(s.a.y, s.b.y);
    const x0 = Math.floor(minX / cell), x1 = Math.floor(maxX / cell);
    const y0 = Math.floor(minY / cell), y1 = Math.floor(maxY / cell);
    const candidates = new Set();
    for (let gx = x0 - 1; gx <= x1 + 1; gx++) {
      for (let gy = y0 - 1; gy <= y1 + 1; gy++) {
        const bucket = grid.get(`${gx},${gy}`);
        if (bucket) for (const o of bucket) candidates.add(o);
      }
    }
    for (const o of candidates) {
      const id = `${o.a.x},${o.a.y},${o.b.x},${o.b.y}`;
      if (seen.has(id)) continue;
      const hit = segIntersect(s.a, s.b, o.a, o.b);
      if (hit) {
        if (hit.t > 1e-6 && hit.t < 1 - 1e-6) s.ts.push(hit.t);
        if (hit.u > 1e-6 && hit.u < 1 - 1e-6) o.us.push(hit.u);
      }
    }
  }
  return segs;
}

function splitSelf(segs) {
  // self-intersections inside one operand (rare but needed for stars)
  const n = segs.length;
  if (n > 400) return segs;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const hit = segIntersect(segs[i].a, segs[i].b, segs[j].a, segs[j].b);
      if (!hit) continue;
      if (hit.t > 1e-6 && hit.t < 1 - 1e-6) segs[i].ts.push(hit.t);
      if (hit.u > 1e-6 && hit.u < 1 - 1e-6) segs[j].us.push(hit.u);
    }
  }
  return segs;
}

function materialize(segs) {
  const out = [];
  for (const s of segs) {
    const ts = Array.from(new Set(s.ts)).sort((a, b) => a - b);
    let prev = 0;
    for (const t of ts) {
      if (t - prev > 1e-6) {
        out.push({
          a: { x: s.a.x + (s.b.x - s.a.x) * prev, y: s.a.y + (s.b.y - s.a.y) * prev },
          b: { x: s.a.x + (s.b.x - s.a.x) * t, y: s.a.y + (s.b.y - s.a.y) * t },
        });
      }
      prev = t;
    }
    if (1 - prev > 1e-6) {
      out.push({
        a: { x: s.a.x + (s.b.x - s.a.x) * prev, y: s.a.y + (s.b.y - s.a.y) * prev },
        b: { ...s.b },
      });
    }
  }
  return out;
}

/* ------------------------------------------------------------ classification */

function inside(w, rule) {
  return rule === "evenodd" ? w % 2 !== 0 : w !== 0;
}

function resultInside(op, a, b) {
  switch (op) {
    case "unite": return a || b;
    case "intersect": return a && b;
    case "minusFront": return a && !b;
    case "exclude": return a !== b;
    default: return a || b;
  }
}

function sampleWinding(rings, ctx) {
  // quick reject with an overall bbox
  const { bbox } = ctx;
  return (p) => {
    if (p.x < bbox.minX - 1 || p.x > bbox.maxX + 1 || p.y < bbox.minY - 1 || p.y > bbox.maxY + 1) return 0;
    return windingNumber(p, rings);
  };
}

function bboxOfRings(rings) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of rings) for (const p of r) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

function classifySegments(segs, windingA, windingB, op, rule) {
  const kept = [];
  for (const s of segs) {
    const dx = s.b.x - s.a.x, dy = s.b.y - s.a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-7) continue;
    const eps = Math.min(len * 0.15, 0.08);
    const nx = -dy / len, ny = dx / len;
    const mx = (s.a.x + s.b.x) / 2, my = (s.a.y + s.b.y) / 2;
    const left = { x: mx + nx * eps, y: my + ny * eps };
    const right = { x: mx - nx * eps, y: my - ny * eps };
    const inL = resultInside(op, inside(windingA(left), rule), inside(windingB(left), rule));
    const inR = resultInside(op, inside(windingA(right), rule), inside(windingB(right), rule));
    if (inL === inR) continue;
    // orient so that the result interior is on the left
    kept.push(inL ? { a: snap(s.a), b: snap(s.b) } : { a: snap(s.b), b: snap(s.a) });
  }
  return kept;
}

/* ------------------------------------------------------------ chaining */

function chainSegments(segs) {
  const byStart = new Map();
  for (const s of segs) {
    const k = key(s.a);
    if (!byStart.has(k)) byStart.set(k, []);
    byStart.get(k).push(s);
  }
  const used = new Set();
  const rings = [];
  for (const s of segs) {
    if (used.has(s)) continue;
    const ring = [s.a];
    let cur = s;
    used.add(cur);
    let guard = 0;
    while (guard++ < 200000) {
      ring.push(cur.b);
      if (key(cur.b) === key(cur.a)) break;
      const bucket = byStart.get(key(cur.b)) || [];
      let next = null;
      for (const cand of bucket) {
        if (used.has(cand)) continue;
        next = cand;
        break;
      }
      if (!next) break;
      // close the ring if the next segment returns to the start
      if (key(next.b) === key(ring[0]) && ring.length > 2) {
        used.add(next);
        break;
      }
      used.add(next);
      cur = next;
    }
    if (ring.length > 2) {
      const dedup = [];
      for (const p of ring) {
        if (!dedup.length || key(dedup[dedup.length - 1]) !== key(p)) dedup.push(p);
      }
      if (dedup.length > 2 && key(dedup[0]) === key(dedup[dedup.length - 1])) dedup.pop();
      if (dedup.length > 2) rings.push(dedup);
    }
  }
  return rings;
}

/* ------------------------------------------------------------ public API */

/**
 * Boolean op on two operand ring sets.
 * @param {"unite"|"intersect"|"minusFront"|"exclude"} op
 */
export function booleanRings(op, ringsA, ringsB, rule = "nonzero") {
  const ctxA = { bbox: bboxOfRings(ringsA) };
  const ctxB = { bbox: bboxOfRings(ringsB) };
  const windingA = sampleWinding(ringsA, ctxA);
  const windingB = sampleWinding(ringsB, ctxB);

  const segsA = segsOfEach(ringsA);
  const segsB = segsOfEach(ringsB);

  const total = segsA.length + segsB.length;
  const bbox = {
    minX: Math.min(ctxA.bbox.minX, ctxB.bbox.minX),
    minY: Math.min(ctxA.bbox.minY, ctxB.bbox.minY),
    maxX: Math.max(ctxA.bbox.maxX, ctxB.bbox.maxX),
    maxY: Math.max(ctxA.bbox.maxY, ctxB.bbox.maxY),
  };
  const area = Math.max(1, (bbox.maxX - bbox.minX) * (bbox.maxY - bbox.minY));
  const cell = Math.max(0.5, Math.sqrt(area / Math.max(16, total)) * 2);

  splitSegments(segsA, segsB, cell);
  splitSegments(segsB, segsA, cell);

  const flatA = materialize(segsA);
  const flatB = materialize(segsB);

  const keptA = classifySegments(flatA, windingA, windingB, op, rule);
  const keptB = classifySegments(flatB, windingA, windingB, op, rule);
  const kept = op === "unite" || op === "intersect" || op === "exclude"
    ? keptA.concat(keptB)
    : keptA.concat(keptB);

  const rings = chainSegments(kept);
  return rings.map((r) => simplifyRing(r, 0.22)).filter((r) => r.length > 2);
}

function segsOfEach(rings) {
  const out = [];
  for (const ring of rings) out.push(...segsOf(ring));
  return out;
}

/** Apply a pathfinder op to a list of node subpath sets. */
export function pathfinder(op, operands, rule = "nonzero") {
  if (!operands.length) return [];
  let ringsList = operands.map((sp) => flattenAll(sp));
  if (ringsList.length === 1) return ringsList[0];

  if (op === "divide") {
    // Piecewise split: keep the front-most shape's intersections separate.
    const out = [];
    const base = ringsList[0];
    for (let i = 1; i < ringsList.length; i++) {
      const front = ringsList[i];
      const inter = booleanRings("intersect", base, front, rule);
      const rest = booleanRings("minusFront", base, front, rule);
      const frontRest = booleanRings("minusFront", front, base, rule);
      out.push(...rest, ...inter, ...frontRest);
      return out;
    }
    return base;
  }

  let acc = ringsList[0];
  for (let i = 1; i < ringsList.length; i++) {
    acc = booleanRings(op, acc, ringsList[i], rule);
  }
  return acc;
}

/** Convert output rings into subpaths (straight segments). */
export function ringsToPath(rings) {
  return ringsToSubpaths(rings.map((r) => ({ points: r, closed: true })));
}

/* ------------------------------------------------------------ stroke outline */

function offsetPolyline(points, dist, join = "round", closed = true) {
  const out = [];
  const n = points.length;
  const get = (i) => points[(i + n) % n];
  const segs = [];
  const count = closed ? n : n - 1;
  for (let i = 0; i < count; i++) {
    const a = get(i), b = get(i + 1);
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1e-9;
    segs.push({ nx: -dy / len, ny: dx / len, len });
  }
  for (let i = 0; i < n; i++) {
    const prevIdx = i === 0 ? (closed ? count - 1 : 0) : i - 1;
    const nextIdx = i === count ? -1 : i;
    const prev = closed || i > 0 ? segs[prevIdx] : null;
    const next = nextIdx >= 0 && nextIdx < segs.length ? segs[nextIdx] : null;
    const p = points[i];
    if (!prev && next) {
      out.push({ x: p.x + next.nx * dist, y: p.y + next.ny * dist });
      continue;
    }
    if (prev && !next) {
      out.push({ x: p.x + prev.nx * dist, y: p.y + prev.ny * dist });
      continue;
    }
    if (!prev || !next) continue;
    if (join === "miter") {
      const mx = prev.nx + next.nx, my = prev.ny + next.ny;
      const ml = Math.hypot(mx, my) || 1e-9;
      const dot = prev.nx * next.nx + prev.ny * next.ny;
      const scale = Math.min(6, 1 / Math.max(0.2, (1 + dot) / 2));
      out.push({ x: p.x + (mx / ml) * dist * scale, y: p.y + (my / ml) * dist * scale });
    } else if (join === "bevel") {
      out.push({ x: p.x + prev.nx * dist, y: p.y + prev.ny * dist });
      out.push({ x: p.x + next.nx * dist, y: p.y + next.ny * dist });
    } else {
      // round join: arc between the two normals
      let a0 = Math.atan2(prev.ny, prev.nx);
      let a1 = Math.atan2(next.ny, next.nx);
      let delta = a1 - a0;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      const steps = Math.max(2, Math.ceil(Math.abs(delta) / 0.35));
      for (let s = 0; s <= steps; s++) {
        const a = a0 + (delta * s) / steps;
        out.push({ x: p.x + Math.cos(a) * dist, y: p.y + Math.sin(a) * dist });
      }
    }
  }
  return out;
}

/**
 * Stroke → outline approximation (Illustrator's Object > Path > Outline Stroke).
 * Returns subpaths for the stroke region around every input subpath.
 */
export function outlineStroke(subpaths, width, cap = "butt", join = "round") {
  const w = Math.max(0.05, width) / 2;
  const rings = [];
  for (const r of flattenSubpaths(subpaths, 0.1)) {
    let pts = r.points.slice();
    if (r.closed) {
      if (pts.length > 2 && Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y) < 1e-7) pts.pop();
      const left = offsetPolyline(pts, w, join, true);
      const right = offsetPolyline(pts, -w, join, true).reverse();
      rings.push(left.concat(right));
      continue;
    }
    if (pts.length < 2) continue;
    const left = offsetPolyline(pts, w, join, false);
    const right = offsetPolyline(pts, -w, join, false).reverse();
    const poly = [];
    poly.push(...left);
    if (cap === "round") {
      const end = pts[pts.length - 1];
      const a0 = Math.atan2(left[left.length - 1].y - end.y, left[left.length - 1].x - end.x);
      for (let s = 1; s < 8; s++) {
        const a = a0 - (Math.PI * s) / 8;
        poly.push({ x: end.x + Math.cos(a) * w, y: end.y + Math.sin(a) * w });
      }
    } else if (cap === "square") {
      const dx = pts[pts.length - 1].x - pts[pts.length - 2].x;
      const dy = pts[pts.length - 1].y - pts[pts.length - 2].y;
      const len = Math.hypot(dx, dy) || 1;
      poly.push({ x: left[left.length - 1].x + (dx / len) * w, y: left[left.length - 1].y + (dy / len) * w });
      poly.push({ x: right[0].x + (dx / len) * w, y: right[0].y + (dy / len) * w });
    }
    poly.push(...right);
    if (cap === "round") {
      const start = pts[0];
      const a0 = Math.atan2(right[right.length - 1].y - start.y, right[right.length - 1].x - start.x);
      for (let s = 1; s < 8; s++) {
        const a = a0 - (Math.PI * s) / 8;
        poly.push({ x: start.x + Math.cos(a) * w, y: start.y + Math.sin(a) * w });
      }
    } else if (cap === "square") {
      const dx = pts[0].x - pts[1].x;
      const dy = pts[0].y - pts[1].y;
      const len = Math.hypot(dx, dy) || 1;
      poly.push({ x: right[right.length - 1].x + (dx / len) * w, y: right[right.length - 1].y + (dy / len) * w });
      poly.push({ x: left[0].x + (dx / len) * w, y: left[0].y + (dy / len) * w });
    }
    rings.push(poly);
  }
  return rings
    .map((r) => simplifyRing(r, 0.15))
    .filter((r) => r.length > 2 && Math.abs(ringArea(r)) > 1e-4);
}

/** Join overlapping same-colour pieces into one compound path (Merge look). */
export function mergeRings(subpathSets) {
  let acc = flattenAll(subpathSets[0] || []);
  for (let i = 1; i < subpathSets.length; i++) {
    acc = booleanRings("unite", acc, flattenAll(subpathSets[i]));
  }
  return acc;
}
