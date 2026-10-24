/**
 * Document model, object factories, selection/traversal helpers and undo
 * history. Documents are plain JSON so history snapshots stay cheap and
 * saving/opening a .vectorstudio file is a single stringify.
 */

import { uid, clamp, hexToRgb } from "./util.js";
import {
  rectSubpaths, ellipseSubpaths, polygonSubpaths, starSubpaths, lineSubpaths,
  cloneSubpaths, transformSubpaths, subpathsBounds, unionBounds, makeNode,
} from "./geom.js";

export const DEFAULT_FILL = { type: "solid", color: "#3b6ea5" };
export const DEFAULT_STROKE = { color: "#111111", width: 1, cap: "butt", join: "miter", dash: [], opacity: 1 };

export const SWATCHES = [
  "#000000", "#404040", "#808080", "#bfbfbf", "#ffffff",
  "#e3573f", "#f28d22", "#f5c518", "#8fbe3f", "#2d9d5c",
  "#23c4d6", "#2d8ceb", "#3d4fbf", "#7d4fc4", "#c94f9d",
  "#f7d9c4", "#8d5a3b", "#2b2f3a", "#12223d", "#0b3d3b",
  "#ff9a00", "#ff6a00", "#ffd166", "#a3e7c9", "#6a3cff",
];

let measureCtx = null;
function textContext(font) {
  if (!measureCtx) {
    const c = document.createElement("canvas");
    measureCtx = c.getContext("2d");
  }
  measureCtx.font = font;
  return measureCtx;
}

export function fontString(node) {
  const style = node.fontStyle === "italic" ? "italic " : "";
  const weight = node.fontWeight || 400;
  return `${style}${weight} ${node.fontSize || 36}px ${node.fontFamily || "Helvetica Neue, Arial, sans-serif"}`;
}

export function textLines(node) {
  const raw = String(node.text ?? "");
  return raw.split("\n");
}

export function textMetrics(node) {
  const ctx = textContext(fontString(node));
  const lines = textLines(node);
  const size = node.fontSize || 36;
  const lineHeight = node.lineHeight || size * 1.2;
  const tracking = node.letterSpacing || 0;
  let width = 0;
  for (const line of lines) {
    const w = ctx.measureText(line).width + Math.max(0, line.length - 1) * tracking;
    if (w > width) width = w;
  }
  return { width, height: lines.length * lineHeight, lineHeight, lines };
}

/* ------------------------------------------------------------------ nodes */

const baseStyle = (over = {}) => ({
  fill: { ...DEFAULT_FILL },
  stroke: null,
  opacity: 1,
  visible: true,
  locked: false,
  blendMode: "source-over",
  ...over,
});

export function createPath(subpaths, over = {}) {
  return {
    id: uid("p"),
    type: "path",
    kind: over.kind || "path",
    name: over.name || "Path",
    subpaths: cloneSubpaths(subpaths),
    ...baseStyle(),
    ...over,
  };
}

export function createRect(x, y, w, h, over = {}) {
  const rx = over.rx || 0;
  return {
    id: uid("r"),
    type: "path",
    kind: "rect",
    name: "Rectangle",
    rect: { x, y, w, h, rx },
    subpaths: rectSubpaths(x, y, w, h, rx),
    ...baseStyle(),
    ...over,
  };
}

export function createEllipse(cx, cy, rx, ry, over = {}) {
  return {
    id: uid("e"),
    type: "path",
    kind: "ellipse",
    name: "Ellipse",
    ellipse: { cx, cy, rx, ry },
    subpaths: ellipseSubpaths(cx, cy, rx, ry),
    ...baseStyle(),
    ...over,
  };
}

export function createPolygon(cx, cy, rx, ry, sides, over = {}) {
  return {
    id: uid("g"),
    type: "path",
    kind: "polygon",
    name: "Polygon",
    polygon: { cx, cy, rx, ry, sides },
    subpaths: polygonSubpaths(cx, cy, rx, ry, sides),
    ...baseStyle(),
    ...over,
  };
}

export function createStar(cx, cy, rx, ry, points, innerRatio, over = {}) {
  return {
    id: uid("s"),
    type: "path",
    kind: "star",
    name: "Star",
    star: { cx, cy, rx, ry, points, innerRatio },
    subpaths: starSubpaths(cx, cy, rx, ry, points, innerRatio),
    ...baseStyle(),
    ...over,
  };
}

export function createLine(x1, y1, x2, y2, over = {}) {
  return {
    id: uid("l"),
    type: "path",
    kind: "line",
    name: "Line Segment",
    subpaths: lineSubpaths(x1, y1, x2, y2),
    ...baseStyle({ fill: null, stroke: { ...DEFAULT_STROKE, width: over.width || 2 } }),
    ...over,
    fill: null,
  };
}

export function createText(x, y, text, over = {}) {
  return {
    id: uid("t"),
    type: "text",
    kind: "text",
    name: "Type",
    text: text || "Type here",
    x,
    y,
    fontFamily: "Helvetica Neue, Helvetica, Arial, sans-serif",
    fontSize: 36,
    fontWeight: 400,
    fontStyle: "normal",
    letterSpacing: 0,
    lineHeight: null,
    align: "left",
    ...baseStyle(),
    fill: { type: "solid", color: "#111111" },
    stroke: null,
    ...over,
  };
}

export function createGroup(children, name = "Group") {
  return {
    id: uid("gr"),
    type: "group",
    kind: "group",
    name,
    children,
    fill: null,
    stroke: null,
    opacity: 1,
    visible: true,
    locked: false,
    blendMode: "source-over",
  };
}

export function createLayer(name = "Layer 1") {
  return {
    id: uid("ly"),
    type: "layer",
    name,
    children: [],
    visible: true,
    locked: false,
    expanded: true,
    color: "#2d8ceb",
  };
}

export function createDocument() {
  const doc = {
    format: "vectorstudio/1",
    name: "Untitled-1",
    units: "px",
    colorMode: "RGB",
    artboards: [{ id: uid("ab"), name: "Artboard 1", x: 0, y: 0, w: 800, h: 600 }],
    activeArtboardId: null,
    layers: [],
    guides: [
      { id: uid("gd"), axis: "h", pos: 0, visible: true },
    ],
  };
  doc.activeArtboardId = doc.artboards[0].id;
  return doc;
}

export const activeArtboard = (doc) =>
  doc.artboards.find((a) => a.id === doc.activeArtboardId) || doc.artboards[0];

/* ---------------------------------------------------------------- traversal */

export function walk(nodes, fn, parent = null) {
  for (const node of nodes || []) {
    fn(node, parent);
    if (node.type === "group" || node.type === "layer") walk(node.children, fn, node);
  }
}

export function findNode(doc, id, nodes = null, parent = null) {
  const list = nodes || doc.layers;
  for (const node of list) {
    if (node.id === id) return { node, parent };
    if (node.children) {
      const hit = findNode(doc, id, node.children, node);
      if (hit) return hit;
    }
  }
  return null;
}

export const findNodeById = (doc, id) => findNode(doc, id)?.node || null;

export function containerOf(doc, id) {
  const hit = findNode(doc, id);
  return hit?.parent || doc.layers;
}

export function topLevelLayerOf(doc, id) {
  for (const layer of doc.layers) {
    let found = false;
    walk([layer], (n) => { if (n.id === id) found = true; });
    if (found) return layer;
  }
  return null;
}

/** Nodes in paint order (bottom → top), honouring layer/group visibility. */
export function paintOrder(doc) {
  const out = [];
  for (const layer of doc.layers) {
    if (!layer.visible) continue;
    collect(layer.children, out, true);
  }
  return out;
}

function collect(nodes, out, visible) {
  for (const node of nodes) {
    const vis = visible && node.visible !== false;
    if (node.type === "group") {
      collect(node.children, out, vis);
    } else if (vis) {
      out.push(node);
    }
  }
}

/** Hit-testable nodes including empty groups, top-most first. */
export function reversePaintOrder(doc) {
  return paintOrder(doc).slice().reverse();
}

export function selectionNodes(doc, selection) {
  return selection.map((id) => findNodeById(doc, id)).filter(Boolean);
}

export function selectionBounds(doc, selection) {
  const bounds = selectionNodes(doc, selection).map((n) => nodeBounds(n));
  return unionBounds(bounds);
}

/* ---------------------------------------------------------------- geometry */

export function nodeSubpaths(node) {
  if (!node) return [];
  if (node.type === "path") return node.subpaths;
  if (node.type === "group") return node.children.flatMap(nodeSubpaths);
  return [];
}

export function nodeBounds(node) {
  if (!node) return { x: 0, y: 0, w: 0, h: 0 };
  if (node.type === "text") {
    const m = textMetrics(node);
    let x = node.x;
    if (node.align === "center") x -= m.width / 2;
    else if (node.align === "right") x -= m.width;
    return { x, y: node.y, w: m.width, h: m.height };
  }
  if (node.type === "group") return unionBounds(node.children.map(nodeBounds)) || { x: 0, y: 0, w: 0, h: 0 };
  return subpathsBounds(node.subpaths || []);
}

export function translateNode(node, dx, dy) {
  if (node.type === "text") {
    node.x += dx;
    node.y += dy;
    return;
  }
  if (node.type === "group") {
    node.children.forEach((c) => translateNode(c, dx, dy));
    return;
  }
  if (node.rect) { node.rect.x += dx; node.rect.y += dy; }
  if (node.ellipse) { node.ellipse.cx += dx; node.ellipse.cy += dy; }
  if (node.polygon) { node.polygon.cx += dx; node.polygon.cy += dy; }
  if (node.star) { node.star.cx += dx; node.star.cy += dy; }
  node.subpaths = node.subpaths.map((sp) => ({
    closed: sp.closed,
    nodes: sp.nodes.map((n) => ({
      x: n.x + dx, y: n.y + dy,
      ix: n.ix + dx, iy: n.iy + dy,
      ox: n.ox + dx, oy: n.oy + dy,
    })),
  }));
}

export function transformNode(node, matrix) {
  if (node.type === "text") {
    const p = { x: node.x, y: node.y };
    const np = { x: matrix.a * p.x + matrix.c * p.y + matrix.e, y: matrix.b * p.x + matrix.d * p.y + matrix.f };
    node.x = np.x;
    node.y = np.y;
    return;
  }
  if (node.type === "group") {
    node.children.forEach((c) => transformNode(c, matrix));
    return;
  }
  if (node.rect) {
    const p = { x: node.rect.x, y: node.rect.y };
    const np = { x: matrix.a * p.x + matrix.c * p.y + matrix.e, y: matrix.b * p.x + matrix.d * p.y + matrix.f };
    node.rect.x = np.x; node.rect.y = np.y;
    node.rect.w *= matrix.a; node.rect.h *= matrix.d;
  }
  node.subpaths = transformSubpaths(node.subpaths, matrix);
  if (node.rect) node.subpaths = rectSubpaths(node.rect.x, node.rect.y, node.rect.w, node.rect.h, node.rect.rx);
  if (node.ellipse) {
    node.ellipse.rx *= Math.abs(matrix.a);
    node.ellipse.ry *= Math.abs(matrix.d);
  }
}

/** Rebuild primitive geometry after a rect/ellipse property edit. */
export function refreshPrimitive(node) {
  if (node.rect) {
    node.subpaths = rectSubpaths(node.rect.x, node.rect.y, node.rect.w, node.rect.h, node.rect.rx);
  } else if (node.ellipse) {
    const { cx, cy, rx, ry } = node.ellipse;
    node.subpaths = ellipseSubpaths(cx, cy, rx, ry);
  } else if (node.polygon) {
    const { cx, cy, rx, ry, sides } = node.polygon;
    node.subpaths = polygonSubpaths(cx, cy, rx, ry, sides);
  } else if (node.star) {
    const { cx, cy, rx, ry, points, innerRatio } = node.star;
    node.subpaths = starSubpaths(cx, cy, rx, ry, points, innerRatio);
  }
}

/** Convert a primitive into an editable freeform path. */
export function outlineNode(node) {
  if (node.type !== "path") return;
  if (node.kind !== "path") {
    node.kind = "path";
    node.name = node.type === "text" ? node.name : "Path";
    delete node.rect;
    delete node.ellipse;
    delete node.polygon;
    delete node.star;
  }
  node.subpaths = cloneSubpaths(node.subpaths);
}

/* ---------------------------------------------------------------- clipboard */

export function cloneNodeDeep(node) {
  const copy = JSON.parse(JSON.stringify(node));
  const reid = (n) => {
    n.id = uid(n.type === "path" ? "p" : n.type === "text" ? "t" : n.type === "group" ? "gr" : "n");
    if (n.children) n.children.forEach(reid);
  };
  reid(copy);
  return copy;
}

/* ---------------------------------------------------------------- history */

export class History {
  constructor(doc, limit = 80) {
    this.doc = doc;
    this.limit = limit;
    this.undoStack = [];
    this.redoStack = [];
    this.pending = null;
    this.listeners = new Set();
  }

  serialize() {
    return JSON.stringify({
      artboards: this.doc.artboards,
      activeArtboardId: this.doc.activeArtboardId,
      layers: this.doc.layers,
    });
  }

  restore(json) {
    const data = JSON.parse(json);
    this.doc.artboards = data.artboards;
    this.doc.activeArtboardId = data.activeArtboardId || data.artboards[0]?.id;
    this.doc.layers = data.layers;
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { for (const fn of this.listeners) fn(this); }

  /** Begin a gesture; the snapshot is only committed if something changes. */
  beginGesture() {
    if (this.pending == null) this.pending = this.serialize();
  }

  /** Explicitly record the current state before a mutation. */
  record() {
    this.undoStack.push(this.serialize());
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
    this.emit();
  }

  /** Close a gesture started with beginGesture(). */
  endGesture(changed = true) {
    if (this.pending == null) return;
    if (changed) {
      this.undoStack.push(this.pending);
      if (this.undoStack.length > this.limit) this.undoStack.shift();
      this.redoStack.length = 0;
      this.emit();
    }
    this.pending = null;
  }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  undo() {
    if (!this.undoStack.length) return false;
    this.redoStack.push(this.serialize());
    this.restore(this.undoStack.pop());
    this.emit();
    return true;
  }

  redo() {
    if (!this.redoStack.length) return false;
    this.undoStack.push(this.serialize());
    this.restore(this.redoStack.pop());
    this.emit();
    return true;
  }

  clear() { this.undoStack.length = 0; this.redoStack.length = 0; this.emit(); }
}

/* ---------------------------------------------------------------- defaults */

/** Dusk poster used as the startup document — shows off fills, gradients,
 *  curves, clipping-style groups and live type. */
export function buildSampleDocument() {
  const doc = createDocument();
  doc.name = "Dusk Poster";
  const bg = createLayer("Background");
  const art = createLayer("Artwork");
  const type = createLayer("Type");

  const sky = createRect(0, 0, 800, 600, {
    name: "Sky",
    fill: { type: "gradient", stops: [{ offset: 0, color: "#16233f" }, { offset: 0.55, color: "#5b3a6e" }, { offset: 1, color: "#e28a5b" }], angle: 90 },
    stroke: null,
  });

  const sun = createEllipse(575, 372, 86, 86, {
    name: "Sun",
    fill: { type: "gradient", stops: [{ offset: 0, color: "#ffe9b0" }, { offset: 1, color: "#ff8a3d" }], angle: 90 },
    stroke: null,
    opacity: 0.95,
  });

  const ridgeFar = createPath([], { name: "Ridge Far", fill: { type: "solid", color: "#3b3350" }, stroke: null, opacity: 0.95 });
  ridgeFar.subpaths = [{
    closed: true,
    nodes: [
      makeNode(0, 430), makeNode(120, 372), makeNode(240, 404), makeNode(360, 350),
      makeNode(520, 412), makeNode(660, 366), makeNode(800, 420),
      makeNode(800, 600), makeNode(0, 600),
    ],
  }];

  const ridgeNear = createPath([], { name: "Ridge Near", fill: { type: "solid", color: "#241f36" }, stroke: null });
  ridgeNear.subpaths = [{
    closed: true,
    nodes: [
      makeNode(0, 512), makeNode(150, 452), makeNode(300, 500), makeNode(430, 440),
      makeNode(600, 505), makeNode(720, 470), makeNode(800, 500),
      makeNode(800, 600), makeNode(0, 600),
    ],
  }];

  const water = createRect(0, 512, 800, 88, {
    name: "Water",
    fill: { type: "gradient", stops: [{ offset: 0, color: "#2c2140" }, { offset: 1, color: "#15111f" }], angle: 90 },
    stroke: null,
  });

  const glowBar = createRect(505, 500, 150, 5, {
    name: "Sun Glint",
    fill: { type: "solid", color: "#ffb96b" },
    stroke: null,
    opacity: 0.8,
    rx: 2,
  });

  const headline = createText(56, 128, "VECTOR\nSTUDIO", {
    name: "Headline",
    fontSize: 88,
    fontWeight: 700,
    letterSpacing: -2,
    lineHeight: 88,
    fill: { type: "solid", color: "#f7f1e3" },
  });
  const sub = createText(60, 330, "Vector illustration, exact control.", {
    name: "Subhead",
    fontSize: 19,
    fontWeight: 400,
    letterSpacing: 0.2,
    fill: { type: "solid", color: "#f0c9a8" },
  });
  const kicker = createText(60, 96, "OPEN SOURCE · REA + VECTORCRAFT", {
    name: "Kicker",
    fontSize: 11,
    fontWeight: 500,
    letterSpacing: 2.6,
    fill: { type: "solid", color: "#ffb96b" },
  });

  bg.children.push(sky, sun, water);
  art.children.push(ridgeFar, ridgeNear, glowBar);
  type.children.push(kicker, headline, sub);
  doc.layers.push(bg, art, type);
  return doc;
}
