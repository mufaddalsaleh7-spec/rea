/**
 * Geometry core: Bézier paths, bounds, flattening, affine transforms and the
 * primitive → path conversions used by the canvas renderer and pathfinder.
 *
 * A path is an array of subpaths: { nodes: Node[], closed: boolean }
 * A node is { x, y, ix, iy, ox, oy } — in/out handles are absolute points.
 */

export const pt = (x = 0, y = 0) => ({ x, y });

export function makeNode(x, y, handles = null) {
  if (!handles) return { x, y, ix: x, iy: y, ox: x, oy: y };
  const { ix = x, iy = y, ox = x, oy = y } = handles;
  return { x, y, ix, iy, ox, oy };
}

export function subpath(points, closed = false) {
  return { nodes: points.map((p) => (p.ix == null ? makeNode(p.x, p.y) : cloneNode(p))), closed };
}

export const cloneNode = (n) => ({ x: n.x, y: n.y, ix: n.ix, iy: n.iy, ox: n.ox, oy: n.oy });
export const cloneSubpaths = (sp) => sp.map((s) => ({ nodes: s.nodes.map(cloneNode), closed: !!s.closed }));

/* ---------------------------------------------------------------- matrices */

export const identity = () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
export const translateM = (tx, ty) => ({ a: 1, b: 0, c: 0, d: 1, e: tx, f: ty });
export const scaleM = (sx, sy = sx, ox = 0, oy = 0) => ({ a: sx, b: 0, c: 0, d: sy, e: ox - sx * ox, f: oy - sy * oy });
export const rotateM = (angle, ox = 0, oy = 0) => {
  const r = (angle * Math.PI) / 180;
  const cos = Math.cos(r), sin = Math.sin(r);
  return { a: cos, b: sin, c: -sin, d: cos, e: ox - cos * ox + sin * oy, f: oy - sin * ox - cos * oy };
};
export const shearM = (sx, sy, ox = 0, oy = 0) => ({ a: 1, b: sy, c: sx, d: 1, e: -sx * oy, f: -sy * ox });

export function mulM(m1, m2) {
  // m1 then m2  (m2 × m1)
  return {
    a: m2.a * m1.a + m2.c * m1.b,
    b: m2.b * m1.a + m2.d * m1.b,
    c: m2.a * m1.c + m2.c * m1.d,
    d: m2.b * m1.c + m2.d * m1.d,
    e: m2.a * m1.e + m2.c * m1.f + m2.e,
    f: m2.b * m1.e + m2.d * m1.f + m2.f,
  };
}

export function applyM(m, p) {
  return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f };
}

export function transformSubpaths(sp, m) {
  return sp.map((s) => ({
    closed: s.closed,
    nodes: s.nodes.map((n) => {
      const p = applyM(m, n);
      const i = applyM(m, { x: n.ix, y: n.iy });
      const o = applyM(m, { x: n.ox, y: n.oy });
      return { x: p.x, y: p.y, ix: i.x, iy: i.y, ox: o.x, oy: o.y };
    }),
  }));
}

/* ---------------------------------------------------------------- primitives */

export function rectSubpaths(x, y, w, h, rx = 0, ry = rx) {
  if (w === 0 || h === 0) return [subpath([{ x, y }], false)];
  const rr = Math.min(Math.abs(w) / 2, Math.abs(h) / 2);
  let cx = rx, cy = ry;
  if (cx > 0 || cy > 0) {
    cx = Math.min(cx, rr);
    cy = Math.min(cy, rr);
    const k = 0.5522847498;
    const x2 = x + w, y2 = y + h;
    const nodes = [
      makeNode(x + cx, y, { ix: x + cx - cx * k, iy: y, ox: x + cx - cx * k + 0, oy: y }),
      makeNode(x + w - cx, y, { ix: x + w - cx + cx * k, iy: y, ox: x + w - cx + cx * k, oy: y }),
      makeNode(x + w, y + cy, { ix: x + w, iy: y + cy - cy * k, ox: x + w, oy: y + cy - cy * k }),
      makeNode(x + w, y + h - cy, { ix: x + w, iy: y + h - cy + cy * k, ox: x + w, oy: y + h - cy + cy * k }),
      makeNode(x + w - cx, y + h, { ix: x + w - cx + cx * k, iy: y + h, ox: x + w - cx + cx * k, oy: y + h }),
      makeNode(x + cx, y + h, { ix: x + cx - cx * k, iy: y + h, ox: x + cx - cx * k, oy: y + h }),
      makeNode(x, y + h - cy, { ix: x, iy: y2 - cy + cy * k, ox: x, oy: y2 - cy + cy * k }),
      makeNode(x, y + cy, { ix: x, iy: y + cy - cy * k, ox: x, oy: y + cy - cy * k }),
    ];
    // correct the segment handles: each node's out handle points along its
    // outgoing segment, each in handle along its incoming segment.
    fixRectHandles(nodes, x, y, w, h, cx, cy, k);
    return [{ nodes, closed: true }];
  }
  return [subpath([{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }], true)];
}

function fixRectHandles(nodes, x, y, w, h, cx, cy, k) {
  const [n0, n1, n2, n3, n4, n5, n6, n7] = nodes;
  // top edge: n0 -> n1
  n0.ox = x + cx + (w - 2 * cx) / 3;
  n1.ix = x + w - cx - (w - 2 * cx) / 3;
  // right top corner: n1 -> n2
  n1.ox = x + w - cx;
  n1.oy = y;
  n2.ix = x + w;
  n2.iy = y + cy - cy * k;
  // right edge n2 -> n3
  n2.ox = x + w;
  n2.oy = y + cy + (h - 2 * cy) / 3;
  n3.ix = x + w;
  n3.iy = y + h - cy - (h - 2 * cy) / 3;
  // bottom right n3 -> n4
  n3.ox = x + w;
  n3.oy = y + h - cy + cy * k;
  n4.ix = x + w - cx + cx * k;
  n4.iy = y + h;
  // bottom n4 -> n5
  n4.ox = x + w - cx - (w - 2 * cx) / 3;
  n4.oy = y + h;
  n5.ix = x + cx + (w - 2 * cx) / 3;
  n5.iy = y + h;
  // bottom left n5 -> n6
  n5.ox = x + cx - cx * k;
  n5.oy = y + h;
  n6.ix = x;
  n6.iy = y + h - cy + cy * k;
  // left n6 -> n7
  n6.ox = x;
  n6.oy = y + h - cy - (h - 2 * cy) / 3;
  n7.ix = x;
  n7.iy = y + cy + (h - 2 * cy) / 3;
  // top left n7 -> n0
  n7.ox = x;
  n7.oy = y + cy - cy * k;
  n0.ix = x + cx - cx * k;
  n0.iy = y;
}

const K = 0.5522847498307936;

export function ellipseSubpaths(cx, cy, rx, ry = rx) {
  const kx = rx * K, ky = ry * K;
  return [{
    closed: true,
    nodes: [
      makeNode(cx, cy - ry, { ix: cx - kx, iy: cy - ry, ox: cx + kx, oy: cy - ry }),
      makeNode(cx + rx, cy, { ix: cx + rx, iy: cy - ky, ox: cx + rx, oy: cy + ky }),
      makeNode(cx, cy + ry, { ix: cx + kx, iy: cy + ry, ox: cx - kx, oy: cy + ry }),
      makeNode(cx - rx, cy, { ix: cx - rx, iy: cy + ky, ox: cx - rx, oy: cy - ky }),
    ],
  }];
}

export function polygonSubpaths(cx, cy, rx, ry, sides = 6, rotation = -90) {
  const nodes = [];
  for (let i = 0; i < sides; i++) {
    const a = ((rotation + (i * 360) / sides) * Math.PI) / 180;
    nodes.push(makeNode(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry));
  }
  return [{ nodes, closed: true }];
}

export function starSubpaths(cx, cy, rx, ry, points = 5, innerRatio = 0.5, rotation = -90) {
  const nodes = [];
  for (let i = 0; i < points * 2; i++) {
    const f = i % 2 === 0 ? 1 : innerRatio;
    const a = ((rotation + (i * 180) / points) * Math.PI) / 180;
    nodes.push(makeNode(cx + Math.cos(a) * rx * f, cy + Math.sin(a) * ry * f));
  }
  return [{ nodes, closed: true }];
}

export function lineSubpaths(x1, y1, x2, y2) {
  return [subpath([{ x: x1, y: y1 }, { x: x2, y: y2 }], false)];
}

export function arcSubpaths(x1, y1, x2, y2, bulge = 0.25) {
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;
  const off = len * bulge;
  const c = makeNode(mx + nx * off * 1.33, my + ny * off * 1.33);
  return [{
    closed: false,
    nodes: [
      makeNode(x1, y1, { ox: x1 + dx * 0.25 + nx * off * 0.4, oy: y1 + dy * 0.25 + ny * off * 0.4 }),
      makeNode(x2, y2, { ix: x2 - dx * 0.25 + nx * off * 0.4, iy: y2 - dy * 0.25 + ny * off * 0.4 }),
    ],
  }];
}

export function spiralSubpaths(cx, cy, r, turns = 3) {
  const steps = Math.max(24, Math.round(turns * 24));
  const nodes = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = t * turns * Math.PI * 2;
    const rr = r * t;
    nodes.push(makeNode(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr));
  }
  return [{ nodes, closed: false }];
}

/* ---------------------------------------------------------------- bounds */

function cubicExtrema(p0, p1, p2, p3) {
  const a = -p0 + 3 * p1 - 3 * p2 + p3;
  const b = 2 * (p0 - 2 * p1 + p2);
  const c = -p0 + p1;
  const out = [];
  if (Math.abs(a) < 1e-9) {
    if (Math.abs(b) > 1e-9) out.push(-c / b);
  } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const s = Math.sqrt(disc);
      out.push((-b + s) / (2 * a), (-b - s) / (2 * a));
    }
  }
  return out.filter((t) => t > 0 && t < 1);
}

function cubicAt(p0, p1, p2, p3, t) {
  const mt = 1 - t;
  return mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3;
}

export function subpathsBounds(subpaths) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const add = (x, y) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };
  for (const sp of subpaths) {
    const n = sp.nodes;
    if (!n.length) continue;
    if (n.length === 1) add(n[0].x, n[0].y);
    for (let i = 0; i < n.length - 1 + (sp.closed ? 1 : 0); i++) {
      const a = n[i], b = n[(i + 1) % n.length];
      add(a.x, a.y);
      add(b.x, b.y);
      for (const t of cubicExtrema(a.x, a.ox, b.ix, b.x)) add(cubicAt(a.x, a.ox, b.ix, b.x, t), cubicAt(a.y, a.oy, b.iy, b.y, t));
      for (const t of cubicExtrema(a.y, a.oy, b.iy, b.y)) add(cubicAt(a.x, a.ox, b.ix, b.x, t), cubicAt(a.y, a.oy, b.iy, b.y, t));
    }
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export const boundsCenter = (b) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
export const boundsRight = (b) => b.x + b.w;
export const boundsBottom = (b) => b.y + b.h;

export function unionBounds(list) {
  const valid = list.filter(Boolean);
  if (!valid.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const b of valid) {
    x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/* ---------------------------------------------------------------- path data */

export function subpathsToPath2D(subpaths, Path2DRef = Path2D) {
  const p = new Path2DRef();
  for (const sp of subpaths) {
    const n = sp.nodes;
    if (!n.length) continue;
    p.moveTo(n[0].x, n[0].y);
    const last = sp.closed ? n.length : n.length - 1;
    for (let i = 0; i < last; i++) {
      const a = n[i], b = n[(i + 1) % n.length];
      const straight = a.ox === a.x && a.oy === a.y && b.ix === b.x && b.iy === b.y;
      if (straight) p.lineTo(b.x, b.y);
      else p.bezierCurveTo(a.ox, a.oy, b.ix, b.iy, b.x, b.y);
    }
    if (sp.closed) p.closePath();
  }
  return p;
}

export function subpathsToSvgD(subpaths) {
  const f = (v) => {
    const r = Math.round(v * 1000) / 1000;
    return String(r);
  };
  let d = "";
  for (const sp of subpaths) {
    const n = sp.nodes;
    if (!n.length) continue;
    d += `M${f(n[0].x)} ${f(n[0].y)}`;
    const last = sp.closed ? n.length : n.length - 1;
    for (let i = 0; i < last; i++) {
      const a = n[i], b = n[(i + 1) % n.length];
      const straight = a.ox === a.x && a.oy === a.y && b.ix === b.x && b.iy === b.y;
      d += straight
        ? `L${f(b.x)} ${f(b.y)}`
        : `C${f(a.ox)} ${f(a.oy)} ${f(b.ix)} ${f(b.iy)} ${f(b.x)} ${f(b.y)}`;
    }
    if (sp.closed) d += "Z";
  }
  return d;
}

export function parseSvgPathD(d) {
  const tokens = String(d).match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) || [];
  const subpaths = [];
  let cur = null;
  let x = 0, y = 0, startX = 0, startY = 0;
  let i = 0;
  let cmd = "M";
  const num = () => parseFloat(tokens[i++]);
  const push = (nx, ny) => {
    if (!cur) { cur = { nodes: [], closed: false }; subpaths.push(cur); }
    if (!cur.nodes.length) { cur.nodes.push(makeNode(nx, ny)); }
    else {
      const prev = cur.nodes[cur.nodes.length - 1];
      prev.ox = prev.ox === prev.x ? nx : prev.ox;
      cur.nodes.push(makeNode(nx, ny));
    }
    x = nx; y = ny;
  };
  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i])) cmd = tokens[i++];
    const C = cmd.toUpperCase();
    const rel = cmd !== C;
    if (C === "M") {
      const nx = num() + (rel ? x : 0), ny = num() + (rel ? y : 0);
      cur = { nodes: [makeNode(nx, ny)], closed: false };
      subpaths.push(cur);
      x = startX = nx; y = startY = ny;
    } else if (C === "L") {
      push(num() + (rel ? x : 0), num() + (rel ? y : 0));
    } else if (C === "H") {
      push(num() + (rel ? x : 0), y);
    } else if (C === "V") {
      push(x, num() + (rel ? y : 0));
    } else if (C === "C") {
      const ox1 = num() + (rel ? x : 0), oy1 = num() + (rel ? y : 0);
      const ix2 = num() + (rel ? x : 0), iy2 = num() + (rel ? y : 0);
      const nx = num() + (rel ? x : 0), ny = num() + (rel ? y : 0);
      const prev = cur.nodes[cur.nodes.length - 1];
      prev.ox = ox1; prev.oy = oy1;
      cur.nodes.push(makeNode(nx, ny, { ix: ix2, iy: iy2 }));
      x = nx; y = ny;
    } else if (C === "S") {
      const ix2 = num() + (rel ? x : 0), iy2 = num() + (rel ? y : 0);
      const nx = num() + (rel ? x : 0), ny = num() + (rel ? y : 0);
      const prev = cur.nodes[cur.nodes.length - 1];
      if (prev) { prev.ox = 2 * x - (prev.ix ?? x); prev.oy = 2 * y - (prev.iy ?? y); }
      cur.nodes.push(makeNode(nx, ny, { ix: ix2, iy: iy2 }));
      x = nx; y = ny;
    } else if (C === "Z") {
      if (cur) {
        cur.closed = true;
        // drop duplicated closing node
        const n = cur.nodes;
        if (n.length > 1 && Math.abs(n[0].x - n[n.length - 1].x) < 1e-6 && Math.abs(n[0].y - n[n.length - 1].y) < 1e-6) n.pop();
        cur = { nodes: [], closed: false };
      }
      x = startX; y = startY;
    } else {
      i += 1;
    }
  }
  return subpaths.filter((s) => s.nodes.length > 0);
}

/* ---------------------------------------------------------------- flatten */

/** Adaptive-ish flattening: uniform subdivision by segment length. */
export function flattenSubpaths(subpaths, tolerance = 0.12) {
  const rings = [];
  for (const sp of subpaths) {
    const n = sp.nodes;
    if (n.length < 2) continue;
    const ring = [{ x: n[0].x, y: n[0].y }];
    const last = sp.closed ? n.length : n.length - 1;
    for (let i = 0; i < last; i++) {
      const a = n[i], b = n[(i + 1) % n.length];
      const ctrlLen = Math.hypot(a.ox - a.x, a.oy - a.y) + Math.hypot(b.ix - a.ox, b.iy - a.oy) + Math.hypot(b.x - b.ix, b.y - b.iy);
      const straight = a.ox === a.x && a.oy === a.y && b.ix === b.x && b.iy === b.y;
      if (straight) { ring.push({ x: b.x, y: b.y }); continue; }
      const steps = Math.max(2, Math.min(160, Math.ceil(ctrlLen / Math.max(0.05, tolerance * 6))));
      for (let s = 1; s <= steps; s++) {
        const t = s / steps, mt = 1 - t;
        ring.push({
          x: mt * mt * mt * a.x + 3 * mt * mt * t * a.ox + 3 * mt * t * t * b.ix + t * t * t * b.x,
          y: mt * mt * mt * a.y + 3 * mt * mt * t * a.oy + 3 * mt * t * t * b.iy + t * t * t * b.y,
        });
      }
    }
    rings.push({ points: ring, closed: !!sp.closed });
  }
  return rings;
}

/** Ramer–Douglas–Peucker simplification for boolean-op output. */
export function simplifyRing(points, tolerance = 0.25) {
  if (points.length < 3) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    let maxD = -1, idx = -1;
    const ax = points[s].x, ay = points[s].y;
    const bx = points[e].x, by = points[e].y;
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy) || 1e-9;
    for (let i = s + 1; i < e; i++) {
      const d = Math.abs((points[i].x - ax) * dy - (points[i].y - ay) * dx) / len;
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > tolerance && idx > 0) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** Convert flat rings back into subpaths (straight segments). */
export function ringsToSubpaths(rings) {
  return rings
    .filter((r) => r.points && r.points.length > 2)
    .map((r) => ({ nodes: r.points.map((p) => makeNode(p.x, p.y)), closed: r.closed !== false }));
}

/* ---------------------------------------------------------------- winding */

export function pointInRing(p, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function windingNumber(p, rings) {
  let w = 0;
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      if (a.y <= p.y) {
        if (b.y > p.y && (b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y) > 0) w++;
      } else if (b.y <= p.y) {
        if ((b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y) < 0) w--;
      }
    }
  }
  return w;
}

export function ringArea(ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

/* ---------------------------------------------------------------- misc math */

export function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function pathLength(subpaths, tol = 0.2) {
  let len = 0;
  for (const ring of flattenSubpaths(subpaths, tol)) {
    const pts = ring.points;
    const n = ring.closed ? pts.length : pts.length - 1;
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      len += Math.hypot(b.x - a.x, b.y - a.y);
    }
  }
  return len;
}

/** Nearest point on flattened path, for adding anchors and measuring. */
export function closestPointOnSubpaths(subpaths, p, tol = 0.15) {
  let best = null;
  let index = 0;
  for (const sp of subpaths) {
    for (const ring of flattenSubpaths([sp], tol)) {
      const pts = ring.points;
      const n = ring.closed ? pts.length : pts.length - 1;
      for (let i = 0; i < n; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        const dx = b.x - a.x, dy = b.y - a.y;
        const l2 = dx * dx + dy * dy || 1e-9;
        let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
        t = Math.max(0, Math.min(1, t));
        const q = { x: a.x + dx * t, y: a.y + dy * t };
        const d = Math.hypot(p.x - q.x, p.y - q.y);
        if (!best || d < best.dist) best = { point: q, dist: d, seg: i, t, subpath: index };
      }
    }
    index++;
  }
  return best;
}
