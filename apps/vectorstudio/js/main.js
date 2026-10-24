/**
 * VectorStudio — application bootstrap, commands, keyboard map and the
 * bridge between the document model, renderer, tools and panels.
 */

import { el, $, $$, clamp, fmt, download, isMac, uid, nextFrame, rafThrottle, hexToRgb, rgbToHex } from "./util.js";
import { icon } from "./icons.js";
import {
  createDocument, buildSampleDocument, activeArtboard, findNode, findNodeById,
  nodeBounds, selectionBounds, transformNode, translateNode, createLayer, createGroup,
  createPath, createText, textMetrics, outlineNode, History, walk, paintOrder, SWATCHES,
} from "./doc.js";
import {
  cloneSubpaths, rotateM, scaleM, shearM, translateM, applyM, unionBounds,
  subpathsBounds, simplifyRing, makeNode, flattenSubpaths, subpathsToSvgD, closestPointOnSubpaths,
} from "./geom.js";
import { Renderer, View } from "./render.js";
import { ToolController, TOOL_DEFS, TOOL_LABELS, applyMatrixToNode, reidNode, TOOL_DEFS_ICON } from "./tools.js";
import { PanelDock } from "./panels.js";
import { ControlBar } from "./controlbar.js";
import { menuBar } from "./menus.js";
import {
  numField, textField, selectField, button, showDialog, showAlert, showMenu, toast, initTooltips, iconButton, checkbox,
} from "./ui.js";
import { ReaSession } from "./rea.js";
import { toSvg, toCanvas } from "./exporters.js";
import { traceText } from "./trace.js";

const mac = isMac();
const MOD = mac ? "metaKey" : "ctrlKey";

/* ================================================================== app */

const app = {
  doc: null,
  history: null,
  view: new View(),
  selection: [],
  selectedAnchors: [],
  activeLayerId: null,
  tool: "select",
  previousTool: "select",
  toolMemory: {},
  toolState: {},
  fill: { type: "solid", color: "#3b6ea5" },
  stroke: { enabled: true, color: "#111111", width: 1, cap: "butt", join: "miter", dash: [], opacity: 1 },
  target: "fill",
  typeSize: 36,
  showRulers: true,
  showGrid: false,
  showGuides: true,
  showSmartGuides: true,
  showEdges: true,
  outlineMode: false,
  snapLines: [],
  marquee: null,
  hoverId: null,
  isDragging: false,
  pointerScreen: null,
  editingTextId: null,
  dirty: false,
  zoom: 1,
  alignTo: "selection",
  spacing: 10,
  gridSize: 20,
  clipboard: null,
  lastEffect: null,
  dockCollapsed: false,
  rea: new ReaSession(),
  _mut: null,
  _rotationFieldValue: 0,
  _shearFieldValue: 0,
};

window.vectorstudio = app;

/* ================================================================== core helpers */

app.findNode = (id) => findNodeById(app.doc, id);
app.selectionNodes = () => app.selection.map((id) => findNodeById(app.doc, id)).filter(Boolean);
app.selectionBounds = () => {
  const boxes = app.selectionNodes().map((n) => nodeBounds(n));
  return unionBounds(boxes);
};
app.activeLayer = () => app.doc.layers.find((l) => l.id === app.activeLayerId) || app.doc.layers[app.doc.layers.length - 1];
app.setSelection = (ids) => {
  const valid = Array.from(new Set(ids)).filter((id) => findNodeById(app.doc, id));
  app.selection = valid;
  app.selectedAnchors = (app.selectedAnchors || []).filter((a) => valid.includes(a.nodeId));
  app.requestRender(true);
  app.refreshPanels();
  app.controlbar?.update();
  updateStatus();
};
app.requestRender = (both = false) => app.renderer?.requestRender(both);
app.requestOverlay = () => app.renderer?.requestOverlay();

app.newStroke = () => ({
  enabled: true,
  color: app.stroke?.color || "#111111",
  width: app.stroke?.width || 1,
  cap: app.stroke?.cap || "butt",
  join: app.stroke?.join || "miter",
  dash: app.stroke?.dash ? [...app.stroke.dash] : [],
  opacity: 1,
});

app.addNode = (node, { select = true } = {}) => {
  const layer = app.activeLayer() || app.doc.layers[app.doc.layers.length - 1];
  if (!layer) {
    const created = createLayer("Layer 1");
    app.doc.layers.push(created);
    app.activeLayerId = created.id;
    created.children.push(node);
  } else {
    layer.children.push(node);
  }
  if (select) app.setSelection([node.id]);
  app.dirty = true;
  return node;
};

app.mutate = (label, fn) => {
  const now = performance.now();
  if (!app._mut || app._mut.label !== label || now - app._mut.time > 900) {
    app.history.record();
    if (label) app.rea.record(label);
  }
  app._mut = { label, time: now };
  fn();
  app.dirty = true;
  app.requestRender(true);
  app.refreshPanels();
  updateStatus();
};

app.refreshPanels = rafThrottle(() => {
  app.panels?.update();
  app.controlbar?.update();
  updateTabBar();
});

app.setStatus = (text) => {
  const node = $("#status-info");
  if (node) node.textContent = text;
};
app.toast = (msg) => toast(msg);

/* ---- paint accessors ---- */
app.currentFill = () => {
  const first = app.selectionNodes()[0];
  return first ? first.fill : app.fill;
};
app.currentStroke = () => {
  const first = app.selectionNodes()[0];
  if (first) return first.stroke;
  return app.stroke?.enabled ? app.stroke : null;
};
app.currentStrokeWithDefaults = () => app.currentStroke() || { width: 1, cap: "butt", join: "miter", dash: [], color: "#111111" };

app.applyFillPaint = (paint) => {
  app.mutate("fill", () => {
    app.fill = paint ? JSON.parse(JSON.stringify(paint)) : null;
    for (const n of app.selectionNodes()) {
      if (n.type === "group") continue;
      n.fill = paint ? JSON.parse(JSON.stringify(paint)) : null;
    }
  });
};

app.applyColor = (color) => {
  if (app.target === "fill") {
    if (color == null) app.applyFillPaint(null);
    else app.applyFillPaint({ type: "solid", color });
  } else {
    app.setStrokeProp("color", color);
  }
};

app.setStrokeProp = (prop, value) => {
  app.mutate(`stroke-${prop}`, () => {
    if (prop === "color") {
      if (!app.stroke) app.stroke = app.newStroke();
      app.stroke.color = value;
      app.stroke.enabled = true;
      for (const n of app.selectionNodes()) {
        if (n.type === "group") continue;
        n.stroke = { ...(n.stroke || app.newStroke()), color: value };
      }
    } else if (prop === "width") {
      app.stroke = { ...app.newStroke(), width: value, enabled: value > 0 };
      for (const n of app.selectionNodes()) {
        if (n.type === "group") continue;
        if (value <= 0) { n.stroke = null; continue; }
        n.stroke = { ...(n.stroke || app.newStroke()), width: value };
      }
    } else {
      app.stroke = { ...app.newStroke(), [prop]: value };
      for (const n of app.selectionNodes()) {
        if (n.type === "group" || !n.stroke) continue;
        n.stroke = { ...n.stroke, [prop]: value };
      }
    }
  });
};

app.setOpacity = (value) => {
  app.mutate("opacity", () => {
    for (const n of app.selectionNodes()) n.opacity = value;
  });
};

app.setTarget = (target) => { app.target = target; };

app.setTextProps = (patch) => {
  const texts = app.selectionNodes().filter((n) => n.type === "text");
  if (!texts.length) {
    if (patch.fontSize) app.typeSize = patch.fontSize;
    toast("Select type to apply character settings");
    return;
  }
  app.mutate("type", () => {
    for (const node of texts) {
      Object.assign(node, patch);
      if (patch.fontSize) {
        node.lineHeight = patch.lineHeight || Math.round(patch.fontSize * 1.2 * 10) / 10;
        app.typeSize = patch.fontSize;
      }
    }
  });
};

app.translateNode = translateNode;

app.transformNodeScale = (node, sx, sy, ox, oy) => {
  const snapshot = JSON.parse(JSON.stringify(node));
  applyMatrixToNode(node, snapshot, scaleM(sx, sy, ox, oy));
};

app.rotateSelection = (angle) => {
  const b = app.selectionBounds();
  if (!b) return;
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  for (const node of app.selectionNodes()) {
    const snapshot = JSON.parse(JSON.stringify(node));
    applyMatrixToNode(node, snapshot, rotateM(angle, cx, cy));
  }
  app.requestRender(true);
  app.refreshPanels();
};

app.shearSelection = (angle) => {
  const b = app.selectionBounds();
  if (!b) return;
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  const m = shearM(Math.tan((angle * Math.PI) / 180), 0, cx, cy);
  for (const node of app.selectionNodes()) {
    const snapshot = JSON.parse(JSON.stringify(node));
    applyMatrixToNode(node, snapshot, m);
  }
  app.requestRender(true);
};

app.flipSelection = (axis) => {
  const b = app.selectionBounds();
  if (!b) return;
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  app.mutate("flip", () => {
    for (const node of app.selectionNodes()) {
      const snapshot = JSON.parse(JSON.stringify(node));
      applyMatrixToNode(node, snapshot, scaleM(axis === "h" ? -1 : 1, axis === "v" ? -1 : 1, cx, cy));
    }
  });
};

app.topLevelGroupOf = (node) => {
  let current = node;
  for (const layer of app.doc.layers) {
    let found = null;
    walk([layer], (n, parent) => {
      if (n.id === node.id) found = parent;
    });
    if (found) {
      current = found;
      let parent = found;
      while (parent.type === "group") {
        for (const l of app.doc.layers) {
          let p2 = null;
          walk([l], (n, par) => { if (n.id === parent.id) p2 = par; });
          if (p2) { parent = p2; current = p2; }
        }
        if (parent.type !== "group") break;
      }
    }
  }
  return current;
};

/* ================================================================== selection ops */

app.deleteSelection = () => {
  if (!app.selection.length) return;
  app.history.record();
  for (const id of app.selection) {
    const hit = findNode(app.doc, id);
    if (!hit) continue;
    const list = hit.parent ? hit.parent.children : app.doc.layers;
    const idx = list.findIndex((n) => n.id === id);
    if (idx >= 0) list.splice(idx, 1);
  }
  app.rea.record("Delete selection", `${app.selection.length} object(s)`);
  app.setSelection([]);
  app.dirty = true;
  app.requestRender(true);
  app.refreshPanels();
};

app.duplicateSelection = () => {
  if (!app.selection.length) return;
  app.history.record();
  const copies = [];
  for (const id of app.selection) {
    const hit = findNode(app.doc, id);
    if (!hit) continue;
    const copy = JSON.parse(JSON.stringify(hit.node));
    reidNode(copy);
    const list = hit.parent ? hit.parent.children : app.doc.layers;
    const idx = list.findIndex((n) => n.id === id);
    list.splice(idx + 1, 0, copy);
    copies.push(copy.id);
  }
  app.rea.record("Duplicate", `${copies.length} object(s)`);
  app.setSelection(copies);
  app.dirty = true;
  app.requestRender(true);
};

app.groupSelection = () => {
  if (app.selection.length < 2) {
    toast("Select two or more objects to group");
    return;
  }
  app.history.record();
  const nodes = app.selectionNodes();
  const firstHit = findNode(app.doc, nodes[0].id);
  const parent = firstHit?.parent || app.doc.layers;
  const indices = nodes.map((n) => parent.children.findIndex((c) => c.id === n.id)).filter((i) => i >= 0);
  const insertAt = indices.length ? Math.max(...indices) : parent.children.length;
  for (const node of nodes) {
    const list = parent.children;
    const i = list.findIndex((c) => c.id === node.id);
    if (i >= 0) list.splice(i, 1);
  }
  const group = createGroup(nodes.map((n) => JSON.parse(JSON.stringify(n))), "Group");
  parent.children.splice(Math.min(insertAt, parent.children.length), 0, group);
  app.rea.record("Group", `${nodes.length} objects`);
  app.setSelection([group.id]);
  app.dirty = true;
  app.requestRender(true);
};

app.ungroupSelection = () => {
  const groups = app.selectionNodes().filter((n) => n.type === "group");
  if (!groups.length) {
    toast("Select a group to ungroup");
    return;
  }
  app.history.record();
  const released = [];
  for (const group of groups) {
    const hit = findNode(app.doc, group.id);
    if (!hit) continue;
    const list = hit.parent ? hit.parent.children : app.doc.layers;
    const idx = list.findIndex((n) => n.id === group.id);
    if (idx < 0) continue;
    list.splice(idx, 1, ...group.children);
    released.push(...group.children.map((c) => c.id));
  }
  app.rea.record("Ungroup", `${groups.length} group(s)`);
  app.setSelection(released);
  app.dirty = true;
  app.requestRender(true);
};

app.arrange = (mode) => {
  if (!app.selection.length) return;
  app.history.record();
  for (const id of app.selection) {
    const hit = findNode(app.doc, id);
    if (!hit) continue;
    const list = hit.parent ? hit.parent.children : app.doc.layers;
    const idx = list.findIndex((n) => n.id === id);
    if (idx < 0) continue;
    const [node] = list.splice(idx, 1);
    if (mode === "front") list.push(node);
    else if (mode === "back") list.unshift(node);
    else if (mode === "forward") list.splice(Math.min(list.length, idx + 1), 0, node);
    else list.splice(Math.max(0, idx - 1), 0, node);
  }
  app.rea.record(`Arrange ${mode}`);
  app.dirty = true;
  app.requestRender(true);
  app.refreshPanels();
};

app.lockSelection = (lock) => {
  app.mutate("lock", () => {
    for (const n of app.selectionNodes()) n.locked = lock;
  });
  app.setSelection([]);
};
app.unlockAll = () => {
  app.mutate("unlock-all", () => {
    walk(app.doc.layers, (n) => { n.locked = false; });
  });
  toast("All artwork unlocked");
};
app.hideSelection = (hide) => {
  app.mutate("hide", () => {
    for (const n of app.selectionNodes()) n.visible = !hide;
  });
  app.setSelection([]);
};
app.showAll = () => {
  app.mutate("show-all", () => {
    walk(app.doc.layers, (n) => { n.visible = true; });
  });
  toast("All artwork shown");
};

app.selectAll = () => {
  const ids = [];
  for (const layer of app.doc.layers) {
    if (!layer.visible || layer.locked) continue;
    for (const node of layer.children) {
      if (!node.locked && node.visible !== false) ids.push(node.id);
    }
  }
  app.setSelection(ids);
};
app.selectInverse = () => {
  const all = [];
  for (const layer of app.doc.layers) {
    if (!layer.visible) continue;
    for (const node of layer.children) if (node.visible !== false) all.push(node.id);
  }
  app.setSelection(all.filter((id) => !app.selection.includes(id)));
};

app.selectSame = (mode) => {
  const first = app.selectionNodes()[0];
  if (!first) {
    toast("Select an object first");
    return;
  }
  const matches = [];
  for (const layer of app.doc.layers) {
    for (const node of layer.children) {
      if (node.type !== first.type) continue;
      let same = false;
      if (mode === "fill") same = JSON.stringify(node.fill) === JSON.stringify(first.fill);
      if (mode === "stroke") same = node.stroke?.color === first.stroke?.color;
      if (mode === "strokeWidth") same = node.stroke?.width === first.stroke?.width;
      if (mode === "opacity") same = node.opacity === first.opacity;
      if (mode === "blendMode") same = node.blendMode === first.blendMode;
      if (mode === "layer") same = layer.children.some((n) => app.selection.includes(n.id));
      if (same) matches.push(node.id);
    }
  }
  app.setSelection(Array.from(new Set([...app.selection, ...matches])));
  toast(`Selected ${matches.length} matching object(s)`);
};

/* ================================================================== align */

app.align = (kind, mode, forceArtboard = false) => {
  const nodes = app.selectionNodes();
  if (!nodes.length) {
    toast("Select objects to align");
    return;
  }
  const ab = activeArtboard(app.doc);
  const useArtboard = forceArtboard || app.alignTo === "artboard" || nodes.length === 1;
  const target = useArtboard
    ? { x: ab.x, y: ab.y, w: ab.w, h: ab.h }
    : unionBounds(nodes.map((n) => nodeBounds(n)));
  if (!target) return;

  app.history.record();
  if (kind === "align") {
    for (const node of nodes) {
      const b = nodeBounds(node);
      let dx = 0, dy = 0;
      switch (mode) {
        case "horizontalAlignLeft": dx = target.x - b.x; break;
        case "horizontalAlignCenter": dx = target.x + target.w / 2 - (b.x + b.w / 2); break;
        case "horizontalAlignRight": dx = target.x + target.w - (b.x + b.w); break;
        case "verticalAlignTop": dy = target.y - b.y; break;
        case "verticalAlignCenter": dy = target.y + target.h / 2 - (b.y + b.h / 2); break;
        case "verticalAlignBottom": dy = target.y + target.h - (b.y + b.h); break;
        default: break;
      }
      if (dx || dy) translateNode(node, dx, dy);
    }
  } else if (kind === "distribute") {
    const horizontal = mode.includes("Horizontal");
    const sorted = nodes
      .map((n) => ({ node: n, b: nodeBounds(n) }))
      .sort((a, b) => (horizontal ? a.b.x - b.b.x : a.b.y - b.b.y));
    if (sorted.length >= 3) {
      if (mode.startsWith("distributeSpacing")) {
        const total = horizontal
          ? sorted.reduce((sum, s) => sum + s.b.w, 0)
          : sorted.reduce((sum, s) => sum + s.b.h, 0);
        const span = horizontal ? target.w : target.h;
        const gap = (span - total) / (sorted.length - 1);
        let cursor = horizontal ? target.x : target.y;
        for (const s of sorted) {
          const dx = horizontal ? cursor - s.b.x : 0;
          const dy = horizontal ? 0 : cursor - s.b.y;
          translateNode(s.node, dx, dy);
          cursor += (horizontal ? s.b.w : s.b.h) + gap;
        }
      } else {
        const first = sorted[0].b;
        const last = sorted[sorted.length - 1].b;
        const start = horizontal ? first.x : first.y;
        const end = horizontal ? last.x + last.w : last.y + last.h;
        const step = (end - start) / (sorted.length - 1);
        sorted.forEach((s, i) => {
          const center = horizontal ? s.b.x + s.b.w / 2 : s.b.y + s.b.h / 2;
          const desired = start + step * i + (horizontal ? s.b.w / 2 : s.b.h / 2);
          translateNode(s.node, horizontal ? desired - center : 0, horizontal ? 0 : desired - center);
        });
      }
    } else {
      toast("Select at least three objects to distribute");
    }
  }
  app.rea.record(`Align ${mode}`, `${nodes.length} objects`);
  app.dirty = true;
  app.requestRender(true);
  app.refreshPanels();
};

/* ================================================================== pathfinder */

app.applyPathfinder = async (op) => {
  const nodes = app.selectionNodes().filter((n) => n.type === "path");
  if (nodes.length < 2) {
    toast("Pathfinder needs two or more selected shapes");
    return;
  }
  if (op === "outlinePF") {
    app.outlineStroke();
    return;
  }
  const docAtStart = app.doc;
  const { pathfinder, ringsToPath } = await import("./pathops.js");
  if (app.doc !== docAtStart) return;
  const booleanOp = op === "minusBack" ? "minusFront"
    : op === "merge" ? "unite"
      : op === "trim" ? "minusFront"
        : op === "cropPF" ? "intersect"
          : op;

  const operands = nodes.map((n) => n.subpaths);
  const ordered = op === "minusBack" ? operands.slice().reverse() : operands;
  let rings;
  try {
    rings = pathfinder(booleanOp, ordered);
  } catch (err) {
    console.error(err);
    toast("Pathfinder failed on this geometry");
    return;
  }
  const subpaths = ringsToPath(rings);
  if (!subpaths.length) {
    toast("Pathfinder produced no geometry");
    return;
  }
  const backmost = nodes[0];
  const result = createPath(subpaths, {
    name: PATHFINDER_NAMES[op] ? `${PATHFINDER_NAMES[op]} Result` : "Path",
    fill: backmost.fill ? JSON.parse(JSON.stringify(backmost.fill)) : null,
    stroke: backmost.stroke ? { ...backmost.stroke } : null,
    opacity: backmost.opacity,
    blendMode: backmost.blendMode,
  });

  let parent = null;
  let insertIdx = 0;
  const firstHit = findNode(app.doc, backmost.id);
  if (firstHit) {
    parent = firstHit.parent;
    const list = parent ? parent.children : app.doc.layers;
    insertIdx = list.findIndex((n) => n.id === backmost.id);
  }
  const container = parent ? parent.children : (app.activeLayer()?.children || app.doc.layers);

  const extra = [];
  if (op === "divide") {
    // keep a second piece when divide produced separated rings
    const halves = splitRingsByOverlap(rings);
    if (halves.length > 1) {
      const second = createPath(ringsToPath(halves[1]), {
        name: "Divide Result",
        fill: nodes[nodes.length - 1].fill ? JSON.parse(JSON.stringify(nodes[nodes.length - 1].fill)) : null,
        stroke: nodes[nodes.length - 1].stroke ? { ...nodes[nodes.length - 1].stroke } : null,
      });
      extra.push(second);
      result.subpaths = ringsToPath(halves[0]);
    }
  }

  app.history.record();
  for (const node of nodes) {
    const hit = findNode(app.doc, node.id);
    if (!hit) continue;
    const list = hit.parent ? hit.parent.children : app.doc.layers;
    const i = list.findIndex((n) => n.id === node.id);
    if (i >= 0) list.splice(i, 1);
  }
  container.splice(Math.max(0, Math.min(insertIdx, container.length)), 0, result, ...extra);
  app.rea.record(`Pathfinder ${op}`, `${nodes.length} operands → ${rings.length} rings`);
  app.setSelection([result.id, ...extra.map((e) => e.id)]);
  app.dirty = true;
  app.requestRender(true);
  app.refreshPanels();
};

const PATHFINDER_NAMES = {
  unite: "Unite", minusFront: "Minus Front", intersect: "Intersect",
  exclude: "Exclude", divide: "Divide", minusBack: "Minus Back",
  trim: "Trim", merge: "Merge", cropPF: "Crop",
};

function splitRingsByOverlap(rings) {
  if (rings.length <= 1) return [rings];
  return [rings.slice(0, 1), rings.slice(1)];
}

app.outlineStroke = async () => {
  const nodes = app.selectionNodes().filter((n) => n.type === "path");
  if (!nodes.length) {
    toast("Select stroked artwork to outline");
    return;
  }
  const docAtStart = app.doc;
  const { outlineStroke } = await import("./pathops.js");
  if (app.doc !== docAtStart) return;
  const results = [];
  app.history.record();
  for (const node of nodes) {
    if (!node.stroke || !node.stroke.width) {
      results.push(node);
      continue;
    }
    const rings = outlineStroke(node.subpaths, node.stroke.width, node.stroke.cap, node.stroke.join);
    if (!rings.length) continue;
    const hit = findNode(app.doc, node.id);
    const list = hit?.parent ? hit.parent.children : app.doc.layers;
    const idx = list.findIndex((n) => n.id === node.id);
    const strokeOutline = createPath(rings.map((r) => ({
      nodes: r.map((p) => makeNode(p.x, p.y)),
      closed: true,
    })), {
      name: "Stroke Outline",
      fill: { type: "solid", color: node.stroke.color },
      stroke: null,
      opacity: node.opacity,
    });
    if (node.fill) {
      const filled = createPath(cloneSubpaths(node.subpaths), {
        name: node.name,
        fill: JSON.parse(JSON.stringify(node.fill)),
        stroke: null,
        opacity: node.opacity,
      });
      list.splice(idx, 1, filled, strokeOutline);
    } else {
      list.splice(idx, 1, strokeOutline);
    }
    results.push(strokeOutline);
  }
  app.rea.record("Outline stroke", `${results.length} object(s)`);
  app.setSelection(results.map((r) => r.id));
  app.dirty = true;
  app.requestRender(true);
  app.refreshPanels();
  toast("Stroke outlined");
};

app.makeCompoundPath = () => {
  const nodes = app.selectionNodes().filter((n) => n.type === "path");
  if (nodes.length < 2) return;
  app.history.record();
  const subpaths = nodes.flatMap((n) => cloneSubpaths(n.subpaths));
  const compound = createPath(subpaths, {
    name: "Compound Path",
    fill: nodes[0].fill ? JSON.parse(JSON.stringify(nodes[0].fill)) : null,
    stroke: nodes[0].stroke ? { ...nodes[0].stroke } : null,
  });
  const hit = findNode(app.doc, nodes[0].id);
  const list = hit?.parent ? hit.parent.children : app.doc.layers;
  const idx = list.findIndex((n) => n.id === nodes[0].id);
  for (const n of nodes) {
    const h = findNode(app.doc, n.id);
    if (!h) continue;
    const l = h.parent ? h.parent.children : app.doc.layers;
    const i = l.findIndex((c) => c.id === n.id);
    if (i >= 0) l.splice(i, 1);
  }
  list.splice(Math.max(0, idx), 0, compound);
  app.rea.record("Make compound path", `${nodes.length} paths`);
  app.setSelection([compound.id]);
  app.requestRender(true);
  app.refreshPanels();
};

app.releaseCompoundPath = () => {
  const nodes = app.selectionNodes().filter((n) => n.type === "path" && n.subpaths.length > 1);
  if (!nodes.length) {
    toast("Select a compound path to release");
    return;
  }
  app.history.record();
  const ids = [];
  for (const node of nodes) {
    const hit = findNode(app.doc, node.id);
    if (!hit) continue;
    const list = hit.parent ? hit.parent.children : app.doc.layers;
    const idx = list.findIndex((n) => n.id === node.id);
    const pieces = node.subpaths.map((sp, i) => createPath([sp], {
      name: `${node.name} ${i + 1}`,
      fill: node.fill ? JSON.parse(JSON.stringify(node.fill)) : null,
      stroke: node.stroke ? { ...node.stroke } : null,
    }));
    list.splice(idx, 1, ...pieces);
    ids.push(...pieces.map((p) => p.id));
  }
  app.rea.record("Release compound path");
  app.setSelection(ids);
  app.requestRender(true);
  app.refreshPanels();
};

app.makeClipMask = async () => {
  const nodes = app.selectionNodes().filter((n) => n.type === "path");
  if (nodes.length < 2) {
    toast("Select artwork and a clipping path");
    return;
  }
  const docAtStart = app.doc;
  const { pathfinder, ringsToPath } = await import("./pathops.js");
  if (app.doc !== docAtStart) return;
  const clip = nodes[nodes.length - 1];
  app.history.record();
  const kept = [];
  for (const node of nodes.slice(0, -1)) {
    const rings = pathfinder("intersect", [node.subpaths, clip.subpaths]);
    const subpaths = ringsToPath(rings);
    if (!subpaths.length) continue;
    const piece = createPath(subpaths, {
      name: node.name,
      fill: node.fill ? JSON.parse(JSON.stringify(node.fill)) : null,
      stroke: node.stroke ? { ...node.stroke, width: 0 } : null,
      opacity: node.opacity,
    });
    kept.push(piece);
  }
  const hit = findNode(app.doc, nodes[0].id);
  const list = hit?.parent ? hit.parent.children : app.doc.layers;
  const idx = list.findIndex((n) => n.id === nodes[0].id);
  for (const n of nodes) {
    const h = findNode(app.doc, n.id);
    if (!h) continue;
    const l = h.parent ? h.parent.children : app.doc.layers;
    const i = l.findIndex((c) => c.id === n.id);
    if (i >= 0) l.splice(i, 1);
  }
  const group = createGroup(kept, "Clipping Group");
  list.splice(Math.max(0, idx), 0, group);
  app.rea.record("Make clipping mask", `${kept.length} clipped objects`);
  app.setSelection([group.id]);
  app.requestRender(true);
  app.refreshPanels();
};

app.releaseClipMask = () => {
  const groups = app.selectionNodes().filter((n) => n.type === "group" && /clip/i.test(n.name));
  if (!groups.length) {
    toast("Select a clipping group to release");
    return;
  }
  app.ungroupSelection();
};

app.joinPaths = () => {
  const nodes = app.selectionNodes().filter((n) => n.type === "path");
  if (!nodes.length) return;
  app.history.record();
  if (nodes.length === 1) {
    const node = nodes[0];
    for (const sp of node.subpaths) sp.closed = true;
    app.rea.record("Join path", "closed open subpaths");
  } else {
    const first = nodes[0];
    const rest = nodes.slice(1);
    for (const other of rest) {
      first.subpaths.push(...cloneSubpaths(other.subpaths));
    }
    for (const other of rest) {
      const hit = findNode(app.doc, other.id);
      if (!hit) continue;
      const list = hit.parent ? hit.parent.children : app.doc.layers;
      const i = list.findIndex((n) => n.id === other.id);
      if (i >= 0) list.splice(i, 1);
    }
    app.rea.record("Join paths", `${nodes.length} paths`);
    app.setSelection([first.id]);
  }
  app.requestRender(true);
  app.refreshPanels();
};

app.reversePath = () => {
  const nodes = app.selectionNodes().filter((n) => n.type === "path");
  if (!nodes.length) return;
  app.mutate("reverse-path", () => {
    for (const node of nodes) {
      node.subpaths = node.subpaths.map((sp) => ({
        closed: sp.closed,
        nodes: sp.nodes.slice().reverse().map((n) => ({ ...n })),
      }));
    }
  });
};

app.convertTextToOutlines = () => {
  const texts = app.selectionNodes().filter((n) => n.type === "text");
  if (!texts.length) {
    toast("Select type to create outlines");
    return;
  }
  app.history.record();
  const created = [];
  for (const text of texts) {
    const subpaths = traceText(text);
    if (!subpaths.length) {
      toast("Could not outline this type");
      continue;
    }
    const path = createPath(subpaths, {
      name: `${text.text.slice(0, 14) || "Type"} outlines`,
      fill: text.fill ? JSON.parse(JSON.stringify(text.fill)) : null,
      stroke: text.stroke ? { ...text.stroke } : null,
      opacity: text.opacity,
    });
    const hit = findNode(app.doc, text.id);
    const list = hit?.parent ? hit.parent.children : app.doc.layers;
    const idx = list.findIndex((n) => n.id === text.id);
    if (idx >= 0) list.splice(idx, 1, path);
    created.push(path.id);
  }
  app.rea.record("Create outlines", `${texts.length} type objects`);
  app.setSelection(created);
  app.dirty = true;
  app.requestRender(true);
  app.refreshPanels();
};

/* ================================================================== documents */

app.loadDocument = (doc, { fit = true } = {}) => {
  app.doc = doc;
  app.history = new History(doc);
  app.history.onChange(() => {
    app.dirty = true;
    updateTabBar();
  });
  app.selection = [];
  app.selectedAnchors = [];
  app.activeLayerId = doc.layers[doc.layers.length - 1]?.id || null;
  app.dirty = false;
  app._mut = null;
  app.rea.record("Open document", doc.name);
  if (fit) {
    const ab = activeArtboard(doc);
    app.view.screenWidth = app.view.screenWidth || 900;
    app.view.screenHeight = app.view.screenHeight || 640;
    const bounds = unionBounds(doc.artboards.map((a) => ({ x: a.x, y: a.y, w: a.w, h: a.h })));
    app.view.fit(bounds, 70);
  }
  app.renderer?.requestRender(true);
  app.refreshPanels();
  app.controlbar?.update(true);
  app.syncZoom();
  updateTabBar();
  updateStatus();
  document.title = `${doc.name} — VectorStudio`;
};

app.addArtboard = () => {
  const ab = activeArtboard(app.doc);
  app.history.record();
  const next = {
    id: uid("ab"),
    name: `Artboard ${app.doc.artboards.length + 1}`,
    x: ab.x + ab.w + 60,
    y: ab.y,
    w: ab.w,
    h: ab.h,
  };
  app.doc.artboards.push(next);
  app.doc.activeArtboardId = next.id;
  app.rea.record("Add artboard", next.name);
  app.requestRender(true);
  app.refreshPanels();
  app.commands.fitAll();
};

app.deleteArtboard = () => {
  if (app.doc.artboards.length <= 1) {
    toast("A document needs at least one artboard");
    return;
  }
  app.history.record();
  const idx = app.doc.artboards.findIndex((a) => a.id === app.doc.activeArtboardId);
  app.doc.artboards.splice(idx, 1);
  app.doc.activeArtboardId = app.doc.artboards[Math.max(0, idx - 1)].id;
  app.rea.record("Delete artboard");
  app.requestRender(true);
  app.refreshPanels();
};

app.fitArtboardToArtwork = () => {
  const nodes = paintOrder(app.doc);
  const boxes = nodes.map((n) => nodeBounds(n));
  const b = unionBounds(boxes);
  const ab = activeArtboard(app.doc);
  if (!b || !b.w || !b.h) {
    toast("No artwork to fit");
    return;
  }
  app.history.record();
  const pad = 20;
  ab.x = Math.round(b.x - pad);
  ab.y = Math.round(b.y - pad);
  ab.w = Math.round(b.w + pad * 2);
  ab.h = Math.round(b.h + pad * 2);
  app.rea.record("Fit artboard to artwork", `${ab.w} × ${ab.h}`);
  app.requestRender(true);
  app.refreshPanels();
  app.commands.fitArtboard();
};

app.duplicateLayer = (layerId) => {
  const layer = app.doc.layers.find((l) => l.id === layerId);
  if (!layer) return;
  app.history.record();
  const copy = JSON.parse(JSON.stringify(layer));
  reidNode(copy);
  copy.name = `${layer.name} copy`;
  const idx = app.doc.layers.findIndex((l) => l.id === layerId);
  app.doc.layers.splice(idx + 1, 0, copy);
  app.setSelection([]);
  app.requestRender(true);
  app.refreshPanels();
};

app.deleteLayer = (layerId) => {
  if (app.doc.layers.length <= 1) {
    toast("A document needs at least one layer");
    return;
  }
  const idx = app.doc.layers.findIndex((l) => l.id === layerId);
  if (idx < 0) return;
  app.history.record();
  app.doc.layers.splice(idx, 1);
  app.activeLayerId = app.doc.layers[Math.max(0, idx - 1)].id;
  app.rea.record("Delete layer");
  app.requestRender(true);
  app.refreshPanels();
};

/* ================================================================== text editing */

app.beginTextEdit = (node, isNew = false) => {
  const editor = $("#text-editor");
  if (!editor) return;
  const view = app.view;
  const p = view.docToScreen({ x: node.x, y: node.y });
  const metrics = textMetrics(node);
  app.editingTextId = node.id;
  app.history.beginGesture();
  editor.hidden = false;
  editor.style.left = `${p.x}px`;
  editor.style.top = `${p.y - 2}px`;
  editor.style.font = `${node.fontStyle === "italic" ? "italic " : ""}${node.fontWeight || 400} ${node.fontSize * view.zoom}px ${node.fontFamily}`;
  editor.style.lineHeight = `${(node.lineHeight || node.fontSize * 1.2) * view.zoom}px`;
  editor.style.letterSpacing = `${(node.letterSpacing || 0) * view.zoom}px`;
  editor.style.color = node.fill?.color || "#111";
  editor.style.textAlign = node.align || "left";
  editor.style.minWidth = `${Math.max(40, metrics.width * view.zoom)}px`;
  editor.innerText = node.text || "";
  editor.dataset.nodeId = node.id;
  editor.focus();
  if (isNew) {
    document.execCommand("selectAll", false, null);
  } else {
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  const onInput = () => {
    node.text = editor.innerText.replace(/\n$/, "");
    app.requestRender(true);
    app.setStatus("Editing type — Esc to finish");
  };
  const onKey = (e) => {
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      finish();
    }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      finish();
    }
  };
  const onBlur = () => finish();
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    editor.removeEventListener("input", onInput);
    editor.removeEventListener("keydown", onKey);
    editor.removeEventListener("blur", onBlur);
    const text = (node.text || "").trim();
    editor.hidden = true;
    app.editingTextId = null;
    if (!text) {
      const hit = findNode(app.doc, node.id);
      if (hit) {
        const list = hit.parent ? hit.parent.children : app.doc.layers;
        const i = list.findIndex((n) => n.id === node.id);
        if (i >= 0) list.splice(i, 1);
      }
      app.setSelection([]);
      app.history.endGesture(false);
    } else {
      app.history.endGesture(true);
      app.setSelection([node.id]);
    }
    app.dirty = true;
    app.requestRender(true);
    app.refreshPanels();
  };
  editor.addEventListener("input", onInput);
  editor.addEventListener("keydown", onKey);
  editor.addEventListener("blur", onBlur);
};

/* ================================================================== tools + toolbar */

app.setTool = (tool) => {
  if (!tool) return;
  app.previousTool = app.tool;
  app.tool = tool;
  const group = TOOL_DEFS.find((d) => d.id === tool || d.flyout?.includes(tool));
  if (group) app.toolMemory[group.id] = tool;
  if (tool !== "pen" && tool !== "curvature") app.tools?.commitActivePen();
  app.selectedAnchors = [];
  app.toolState = { ...app.toolState, penPreview: null, shapePreview: null };
  app.refreshToolbar();
  app.controlbar?.update(true);
  updateStatus();
  app.requestOverlay();
};
app.cycleToolVariant = () => {
  const group = TOOL_DEFS.find((d) => d.flyout?.includes(app.tool));
  if (!group || !group.flyout) return;
  const idx = group.flyout.indexOf(app.tool);
  const next = group.flyout[(idx + 1) % group.flyout.length];
  app.setTool(next);
  toast(TOOL_LABELS[next] || next);
};

function buildToolbar() {
  const toolbar = $("#toolbar");
  toolbar.replaceChildren();
  const grid = el("div", { class: "tool-grid" });
  for (const def of TOOL_DEFS) {
    const current = app.toolMemory[def.id] || def.id;
    const btn = el("button", {
      class: `tool${app.tool === current ? " is-active" : ""}`,
      "data-tooltip": TOOL_LABELS[current] || def.name,
      "data-shortcut": def.key || "",
      "aria-label": TOOL_LABELS[current] || def.name,
      html: icon(TOOL_DEFS_ICON[current] || "select", 18),
    });
    if (def.flyout && def.flyout.length > 1) btn.append(el("span", { class: "tool__corner" }));
    let holdTimer = null;
    btn.addEventListener("pointerdown", () => {
      holdTimer = setTimeout(() => openFlyout(def, btn), 320);
    });
    const clearHold = () => clearTimeout(holdTimer);
    btn.addEventListener("pointerup", clearHold);
    btn.addEventListener("pointerleave", clearHold);
    btn.addEventListener("click", () => {
      clearTimeout(holdTimer);
      app.setTool(app.toolMemory[def.id] || def.id);
    });
    btn.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      if (def.flyout && def.flyout.length > 1) openFlyout(def, btn);
    });
    grid.append(btn);
  }
  toolbar.append(grid, el("div", { class: "toolbar__spacer" }));

  // fill / stroke proxy
  const footer = el("div", { class: "toolbar__footer" });
  const proxy = el("div", { class: "fill-stroke", title: "Fill and Stroke" });
  const fillSwatch = el("button", { class: "fill-stroke__swatch fill-stroke__swatch--fill" });
  const strokeSwatch = el("button", { class: "fill-stroke__swatch fill-stroke__swatch--stroke" });
  proxy.append(fillSwatch, strokeSwatch);
  fillSwatch.addEventListener("click", () => {
    app.setTarget("fill");
    app.refreshPanels();
    app.scrollToGroup("color");
  });
  strokeSwatch.addEventListener("click", () => {
    app.setTarget("stroke");
    app.refreshPanels();
    app.scrollToGroup("color");
  });

  const miniTools = el("div", { class: "mini-tools" });
  const swapBtn = el("button", { class: "mini-tool", title: "Swap Fill and Stroke (Shift+X)", html: icon("swapColors", 13) });
  swapBtn.addEventListener("click", () => {
    const fill = app.fill;
    app.fill = app.stroke && app.stroke.enabled ? { type: "solid", color: app.stroke.color } : null;
    app.stroke = { ...app.stroke, color: fill?.color || "#000000", enabled: true };
    for (const n of app.selectionNodes()) {
      const f = n.fill;
      n.fill = n.stroke ? { type: "solid", color: n.stroke.color } : null;
      n.stroke = f ? { ...(n.stroke || app.newStroke()), color: f.color || "#000000" } : n.stroke;
    }
    app.dirty = true;
    app.requestRender(true);
    app.refreshPanels();
  });
  const defaultBtn = el("button", { class: "mini-tool", title: "Default Fill and Stroke (D)", html: icon("defaultColors", 13) });
  defaultBtn.addEventListener("click", () => {
    app.fill = { type: "solid", color: "#ffffff" };
    app.stroke = { ...app.newStroke(), color: "#000000", width: 1 };
    for (const n of app.selectionNodes()) {
      n.fill = { type: "solid", color: "#ffffff" };
      n.stroke = { ...app.newStroke(), color: "#000000", width: 1 };
    }
    app.dirty = true;
    app.requestRender(true);
    app.refreshPanels();
  });
  const targetBtn = el("button", { class: "mini-tool", title: "Toggle Fill / Stroke target (X)", html: icon("noColor", 13) });
  targetBtn.addEventListener("click", () => { app.setTarget(app.target === "fill" ? "stroke" : "fill"); app.refreshPanels(); });
  miniTools.append(swapBtn, defaultBtn, targetBtn);
  footer.append(proxy, miniTools);
  toolbar.append(footer);
  updateToolbarProxy();
}

function updateToolbarProxy() {
  const fillSwatch = $(".fill-stroke__swatch--fill");
  const strokeSwatch = $(".fill-stroke__swatch--stroke");
  if (!fillSwatch || !strokeSwatch) return;
  const fill = app.currentFill();
  const stroke = app.currentStroke();
  fillSwatch.classList.toggle("fill-stroke__none", !fill);
  if (fill) {
    if (fill.type === "gradient" || fill.type === "radial") {
      const stops = (fill.stops || []).map((s) => `${s.color} ${Math.round(s.offset * 100)}%`).join(",");
      fillSwatch.style.background = fill.type === "radial"
        ? `radial-gradient(circle, ${stops})`
        : `linear-gradient(120deg, ${stops})`;
    } else fillSwatch.style.background = fill.color;
  } else fillSwatch.style.background = "#fff";
  strokeSwatch.classList.toggle("fill-stroke__none", !stroke || !stroke.width);
  strokeSwatch.style.background = stroke && stroke.width ? stroke.color : "#fff";
  fillSwatch.style.outline = app.target === "fill" ? "1px solid var(--accent)" : "none";
  strokeSwatch.style.outline = app.target === "stroke" ? "1px solid var(--accent)" : "none";
}

function openFlyout(def, anchor) {
  const rect = anchor.getBoundingClientRect();
  const items = def.flyout.map((id) => ({
    label: TOOL_LABELS[id] || id,
    checked: app.tool === id,
    action: () => {
      app.toolMemory[def.id] = id;
      app.setTool(id);
    },
  }));
  showMenu(rect.right - 4, rect.top, items, { minWidth: 210 });
}

app.refreshToolbar = () => {
  buildToolbar();
  const dockHint = $("#status-tool");
  if (dockHint) dockHint.textContent = TOOL_LABELS[app.tool] || "Selection Tool";
};

/* ================================================================== views */

app.syncZoom = () => {
  const select = $("#zoom-select");
  if (!select) return;
  const percent = Math.round(app.view.zoom * 100);
  const values = Array.from(select.options).map((o) => Math.round(parseFloat(o.value) * 100));
  const match = values.findIndex((v) => v === percent);
  if (match >= 0) {
    select.value = select.options[match].value;
  } else {
    let custom = select.querySelector("option[data-custom]");
    if (!custom) {
      custom = el("option", { dataset: { custom: "true" } });
      select.append(custom);
    }
    custom.value = String(app.view.zoom);
    custom.textContent = `${percent}%`;
    select.value = custom.value;
  }
  const label = $("#status-mode");
  if (label) label.textContent = app.outlineMode ? "Outline" : "RGB";
};

app.toggleRulers = () => {
  app.showRulers = !app.showRulers;
  $(".canvas-area").classList.toggle("hide-rulers", !app.showRulers);
  app.renderer?.resize();
  app.controlbar?.update(true);
};

app.toggleGrid = () => {
  app.showGrid = !app.showGrid;
  app.requestRender(true);
  app.controlbar?.update(true);
};
app.toggleGuides = () => {
  app.showGuides = !app.showGuides;
  app.requestRender(true);
};
app.toggleSmartGuides = () => {
  app.showSmartGuides = !app.showSmartGuides;
  toast(`Smart Guides ${app.showSmartGuides ? "on" : "off"}`);
  app.controlbar?.update(true);
};
app.toggleOutline = () => {
  app.outlineMode = !app.outlineMode;
  app.requestRender(true);
  app.syncZoom();
  toast(app.outlineMode ? "Outline view" : "Preview view");
};
app.toggleDock = () => {
  app.dockCollapsed = !app.dockCollapsed;
  $("#app").classList.toggle("is-dock-collapsed", app.dockCollapsed);
  app.renderer?.resize();
};
app.setTheme = (theme) => {
  document.documentElement.dataset.theme = theme;
  app.rea.record("Theme", theme);
  app.requestRender(true);
};
app.setWorkspace = (name) => {
  $("#workspace-switcher span").textContent = name;
  toast(`${name} workspace`);
};
app.setScreenMode = (mode) => {
  $("#app").classList.toggle("is-presentation", mode === "presentation");
  if (mode === "normal") $("#app").classList.remove("is-presentation");
  app.renderer?.resize();
};
app.scrollToGroup = (groupId) => {
  const section = document.querySelector(`.panel[data-group="${groupId}"]`);
  if (!section) return;
  section.scrollIntoView({ block: "nearest", behavior: "smooth" });
  section.animate(
    [{ boxShadow: "0 0 0 2px var(--accent)" }, { boxShadow: "0 0 0 0 transparent" }],
    { duration: 900, easing: "ease-out" },
  );
};

/* ================================================================== status + tabs */

function updateStatus() {
  const tool = $("#status-tool");
  if (tool) tool.textContent = TOOL_LABELS[app.tool] || "Selection Tool";
  const ab = app.doc ? activeArtboard(app.doc) : null;
  const artboardLabel = $("#status-artboard");
  if (artboardLabel && ab) artboardLabel.textContent = ab.name;
  const mode = $("#status-mode");
  if (mode) mode.textContent = app.outlineMode ? "Outline" : "RGB";
  const info = $("#status-info");
  if (info && !info.dataset.custom) {
    info.textContent = app.selection.length
      ? `${app.selection.length} selected`
      : "Ready";
  }
  updateToolbarProxy();
}

function updateTabBar() {
  const bar = $("#tabbar");
  if (!bar || !app.doc) return;
  bar.replaceChildren();
  const tab = el("div", { class: `doc-tab is-active${app.dirty ? " is-dirty" : ""}` }, [
    el("span", { class: "doc-tab__title" }, [app.doc.name]),
    el("span", { class: "doc-tab__dirty" }),
    el("button", { class: "doc-tab__close", html: icon("close", 9), title: "Close document" }),
  ]);
  tab.querySelector(".doc-tab__close").addEventListener("click", (e) => {
    e.stopPropagation();
    app.commands.closeDocument();
  });
  const actions = el("div", { class: "tabbar__actions" }, [
    el("button", { class: "tabbar__action", html: icon("plus", 12), title: "New document" }),
    el("button", { class: "tabbar__action", html: icon("hamburger", 12), title: "Document options" }),
  ]);
  actions.children[0].addEventListener("click", () => app.commands.newDocument());
  actions.children[1].addEventListener("click", (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    showMenu(r.right - 200, r.bottom + 2, [
      { label: "Document Setup…", action: () => app.commands.documentSetup() },
      { label: "Duplicate Document", action: () => app.commands.duplicateDocument() },
      { separator: true },
      { label: "Close Document", action: () => app.commands.closeDocument() },
    ]);
  });
  bar.append(tab, actions);
  document.title = `${app.doc.name}${app.dirty ? " *" : ""} — VectorStudio`;
}

/* ================================================================== context menu */

app.openContextMenu = (x, y) => {
  const items = [];
  if (app.selection.length) {
    items.push(
      { label: "Cut", shortcut: `${mac ? "⌘" : "Ctrl+"}X`, action: () => app.commands.cut() },
      { label: "Copy", shortcut: `${mac ? "⌘" : "Ctrl+"}C`, action: () => app.commands.copy() },
      { label: "Paste", shortcut: `${mac ? "⌘" : "Ctrl+"}V`, action: () => app.commands.paste() },
      { separator: true },
      { label: "Group", disabled: app.selection.length < 2, action: () => app.groupSelection() },
      { label: "Ungroup", disabled: !app.selectionNodes().some((n) => n.type === "group"), action: () => app.ungroupSelection() },
      { label: "Arrange", submenu: [
        { label: "Bring to Front", action: () => app.arrange("front") },
        { label: "Bring Forward", action: () => app.arrange("forward") },
        { label: "Send Backward", action: () => app.arrange("backward") },
        { label: "Send to Back", action: () => app.arrange("back") },
      ] },
      { separator: true },
      { label: "Transform", submenu: [
        { label: "Rotate 90° CW", action: () => app.mutate("rotate", () => app.rotateSelection(90)) },
        { label: "Rotate 90° CCW", action: () => app.mutate("rotate", () => app.rotateSelection(-90)) },
        { label: "Reflect Horizontal", action: () => app.flipSelection("h") },
        { label: "Reflect Vertical", action: () => app.flipSelection("v") },
      ] },
      { label: "Pathfinder", submenu: [
        { label: "Unite", action: () => app.applyPathfinder("unite") },
        { label: "Minus Front", action: () => app.applyPathfinder("minusFront") },
        { label: "Intersect", action: () => app.applyPathfinder("intersect") },
        { label: "Exclude", action: () => app.applyPathfinder("exclude") },
      ] },
      { separator: true },
      { label: "Create Outlines", disabled: !app.selectionNodes().some((n) => n.type === "text"), action: () => app.convertTextToOutlines() },
      { label: "Outline Stroke", action: () => app.outlineStroke() },
      { separator: true },
      { label: "Delete", action: () => app.deleteSelection() },
    );
  } else {
    items.push(
      { label: "Paste", action: () => app.commands.paste() },
      { label: "Select All", action: () => app.selectAll() },
      { separator: true },
      { label: "Show Rulers", checked: app.showRulers, action: () => app.toggleRulers() },
      { label: "Show Grid", checked: app.showGrid, action: () => app.toggleGrid() },
      { label: "Smart Guides", checked: app.showSmartGuides, action: () => app.toggleSmartGuides() },
      { label: "Outline Mode", checked: app.outlineMode, action: () => app.toggleOutline() },
      { separator: true },
      { label: "Fit Artboard in Window", action: () => app.commands.fitArtboard() },
      { label: "Document Setup…", action: () => app.commands.documentSetup() },
    );
  }
  showMenu(x, y, items, { minWidth: 210 });
};

/* ================================================================== commands */

const commands = {
  undo: () => {
    if (app.history.undo()) {
      app.rea.record("Undo");
      app.setSelection(app.selection.filter((id) => findNodeById(app.doc, id)));
      app.requestRender(true);
      app.refreshPanels();
      updateStatus();
    }
  },
  redo: () => {
    if (app.history.redo()) {
      app.rea.record("Redo");
      app.requestRender(true);
      app.refreshPanels();
      updateStatus();
    }
  },
  newDocument: (preset = null) => {
    const width = preset?.w || 800;
    const height = preset?.h || 600;
    const doc = createDocument();
    doc.name = preset?.name || `Untitled-${Math.floor(Math.random() * 90 + 10)}`;
    doc.artboards[0].w = width;
    doc.artboards[0].h = height;
    const layer = createLayer("Layer 1");
    doc.layers.push(layer);
    app.loadDocument(doc);
    toast(`New document ${width} × ${height}`);
  },
  openSample: () => {
    app.loadDocument(buildSampleDocument());
    toast("Sample poster opened");
  },
  openDocument: () => {
    const input = el("input", { type: "file", accept: ".json,.vectorstudio,application/json" });
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        if (!data.layers || !data.artboards) throw new Error("Not a VectorStudio document");
        data.name = data.name || file.name.replace(/\.(json|vectorstudio)$/i, "");
        app.loadDocument(data);
        toast(`Opened ${file.name}`);
      } catch (err) {
        showAlert("Could not open document", String(err.message || err));
      }
    });
    input.click();
  },
  saveDocument: () => {
    const json = JSON.stringify({
      format: "vectorstudio/1",
      name: app.doc.name,
      units: app.doc.units,
      colorMode: app.doc.colorMode,
      artboards: app.doc.artboards,
      activeArtboardId: app.doc.activeArtboardId,
      layers: app.doc.layers,
      guides: app.doc.guides,
    }, null, 2);
    download(`${app.doc.name.replace(/\s+/g, "-").toLowerCase()}.vectorstudio`, new Blob([json], { type: "application/json" }));
    app.dirty = false;
    updateTabBar();
    app.rea.record("Save document", `${json.length} bytes`);
    toast("Document saved");
  },
  saveDocumentAs: () => { commands.saveDocument(); },
  exportSvg: () => {
    const svg = toSvg(app.doc);
    download(`${app.doc.name.replace(/\s+/g, "-").toLowerCase()}.svg`, new Blob([svg], { type: "image/svg+xml" }));
    app.rea.record("Export SVG", `${svg.length} bytes`);
    toast("SVG exported");
  },
  exportPng: () => {
    const ab = activeArtboard(app.doc);
    const canvas = toCanvas(app.doc, ab, 2);
    canvas.toBlob((blob) => {
      download(`${app.doc.name.replace(/\s+/g, "-").toLowerCase()}.png`, blob);
      app.rea.record("Export PNG", `${canvas.width}×${canvas.height}`);
      toast("PNG exported at 2×");
    });
  },
  exportDialog: () => {
    let format = "svg";
    let scale = 2;
    const formats = el("div", { class: "preset-grid" });
    const setFormat = (f) => {
      format = f;
      formats.querySelectorAll(".preset").forEach((n) => n.classList.toggle("is-active", n.dataset.fmt === f));
    };
    for (const [id, title, hint] of [
      ["svg", "SVG", "Vector, editable everywhere"],
      ["png", "PNG", "Raster at chosen scale"],
      ["json", "VectorStudio", "Reopen in this editor"],
    ]) {
      const card = el("button", { class: "preset", dataset: { fmt: id } }, [
        el("strong", { text: title }),
        el("span", { text: hint }),
      ]);
      card.addEventListener("click", () => setFormat(id));
      if (id === "svg") card.classList.add("is-active");
      formats.append(card);
    }
    const scaleSelect = selectField({
      options: [{ value: "1", label: "1× (artboard size)" }, { value: "2", label: "2× (retina)" }, { value: "4", label: "4× (print)" }],
      value: "2",
      onChange: (v) => { scale = Number(v); },
    });
    const nameField = textField({ value: app.doc.name.replace(/\s+/g, "-").toLowerCase() });
    const dialog = showDialog({
      title: "Export As",
      body: [
        el("div", { class: "form-row" }, [el("span", { class: "label" }, ["Format"]), formats]),
        el("div", { class: "form-row" }, [el("span", { class: "label" }, ["File name"]), nameField.el]),
        el("div", { class: "form-row" }, [el("span", { class: "label" }, ["Raster scale"]), scaleSelect.el]),
        el("div", { class: "dialog__hint", text: "SVG export includes layers, gradients and editable type. PNG uses the active artboard." }),
      ],
      footer: [
        button("Cancel", { onClick: () => dialog.close() }),
        button("Export", { variant: "primary", onClick: () => {
          const base = nameField.get() || "artwork";
          if (format === "svg") {
            const svg = toSvg(app.doc);
            download(`${base}.svg`, new Blob([svg], { type: "image/svg+xml" }));
          } else if (format === "png") {
            const canvas = toCanvas(app.doc, activeArtboard(app.doc), scale);
            canvas.toBlob((blob) => download(`${base}.png`, blob));
          } else {
            const json = JSON.stringify({ ...app.doc, name: base }, null, 2);
            download(`${base}.vectorstudio`, new Blob([json], { type: "application/json" }));
          }
          app.rea.record("Export", `${format.toUpperCase()} ${base}`);
          toast(`Exported ${format.toUpperCase()}`);
          dialog.close();
        } }),
      ],
    });
  },
  documentSetup: () => {
    const ab = activeArtboard(app.doc);
    const name = textField({ value: app.doc.name });
    const w = numField({ label: "W", value: ab.w, min: 1, dp: 0 });
    const h = numField({ label: "H", value: ab.h, min: 1, dp: 0 });
    const bleed = numField({ label: "B", value: 0, min: 0, dp: 0 });
    const units = selectField({
      options: [{ value: "px", label: "Pixels" }, { value: "pt", label: "Points" }, { value: "mm", label: "Millimetres" }, { value: "in", label: "Inches" }],
      value: app.doc.units,
    });
    const colorMode = selectField({ options: [{ value: "RGB", label: "RGB Color" }, { value: "CMYK", label: "CMYK (preview only)" }], value: app.doc.colorMode });
    const dialog = showDialog({
      title: "Document Setup",
      body: [
        el("div", { class: "form-row" }, [el("span", { class: "label" }, ["Document name"]), name.el]),
        el("div", { class: "dialog__section" }, [
          el("h4", { text: `${ab.name} — artboard size` }),
          el("div", { class: "row row--tight" }, [w.el, h.el, bleed.el]),
          el("div", { class: "form-row" }, [el("span", { class: "label" }, ["Units"]), units.el]),
          el("div", { class: "form-row" }, [el("span", { class: "label" }, ["Color mode"]), colorMode.el]),
        ]),
        el("div", { class: "dialog__hint", text: "Artboard dimensions are stored in pixels. Units and color mode are document metadata." }),
      ],
      footer: [
        button("Cancel", { onClick: () => dialog.close() }),
        button("OK", { variant: "primary", onClick: () => {
          app.history.record();
          app.doc.name = name.get() || app.doc.name;
          app.doc.units = units.get();
          app.doc.colorMode = colorMode.get();
          ab.w = w.get();
          ab.h = h.get();
          app.rea.record("Document setup", `${ab.w} × ${ab.h} ${app.doc.units}`);
          app.dirty = true;
          app.view.fit({ x: ab.x, y: ab.y, w: ab.w, h: ab.h }, 70);
          app.requestRender(true);
          app.refreshPanels();
          updateTabBar();
          dialog.close();
        } }),
      ],
    });
  },
  print: () => {
    toast("Preparing print sheet…");
    const ab = activeArtboard(app.doc);
    const canvas = toCanvas(app.doc, ab, 2);
    const win = window.open("", "_blank");
    if (!win) {
      toast("Allow pop-ups to print");
      return;
    }
    win.document.write(`<title>${app.doc.name}</title><body style="margin:0;display:grid;place-items:center;background:#fff"><img src="${canvas.toDataURL("image/png")}" style="max-width:100%"/></body>`);
    win.document.close();
    setTimeout(() => win.print(), 400);
  },
  closeDocument: () => {
    if (app.dirty) {
      const dialog = showDialog({
        title: "Close document?",
        body: [el("p", { class: "dialog__hint", style: { margin: 0 }, text: `${app.doc.name} has unsaved changes.` })],
        footer: [
          button("Cancel", { onClick: () => dialog.close() }),
          button("Discard", { onClick: () => { dialog.close(); commands.newDocument(); } }),
          button("Save", { variant: "primary", onClick: () => { commands.saveDocument(); dialog.close(); } }),
        ],
        width: 380,
      });
    } else {
      commands.newDocument();
    }
  },
  duplicateDocument: () => {
    const copy = JSON.parse(JSON.stringify(app.doc));
    copy.name = `${app.doc.name} copy`;
    app.loadDocument(copy);
  },
  cut: () => { commands.copy(); app.deleteSelection(); },
  copy: () => {
    app.clipboard = app.selectionNodes().map((n) => JSON.parse(JSON.stringify(n)));
    app.rea.record("Copy", `${app.clipboard.length} object(s)`);
    toast(`Copied ${app.clipboard.length} object(s)`);
  },
  paste: (inPlace = false) => {
    if (!app.clipboard?.length) return;
    app.history.record();
    const ids = [];
    const layer = app.activeLayer() || app.doc.layers[app.doc.layers.length - 1];
    for (const node of app.clipboard) {
      const copy = JSON.parse(JSON.stringify(node));
      reidNode(copy);
      if (!inPlace) translateNode(copy, 10, 10);
      layer.children.push(copy);
      ids.push(copy.id);
    }
    app.rea.record("Paste", `${ids.length} object(s)`);
    app.setSelection(ids);
    app.dirty = true;
    app.requestRender(true);
  },
  pasteInPlace: () => commands.paste(true),
  selectAll: () => app.selectAll(),
  reselect: () => toast("Nothing to reselect"),
  shortcuts: () => {
    const rows = [
      ["Selection", "V"], ["Direct Selection", "A"], ["Pen", "P"], ["Type", "T"],
      ["Rectangle / Ellipse", "M / L"], ["Pencil", "N"], ["Paintbrush", "B"],
      ["Rotate", "R"], ["Free Transform", "E"], ["Gradient", "G"],
      ["Eyedropper", "I"], ["Artboard", "⇧O"], ["Hand / Zoom", "H / Z"],
      ["Undo / Redo", "⌘Z / ⇧⌘Z"], ["Copy / Cut / Paste", "⌘C / ⌘X / ⌘V"],
      ["Duplicate", "⌘D"], ["Group / Ungroup", "⌘G / ⇧⌘G"],
      ["Bring Forward / Send Backward", "⌘] / ⌘["],
      ["Select All / Deselect", "⌘A / ⇧⌘A"],
      ["Fit Artboard", "⌘0"], ["Actual Size", "⌘1"],
      ["Zoom In / Out", "⌘+ / ⌘−"],
      ["Show Rulers", "⌘R"], ["Show Grid", "⌘\""],
      ["Smart Guides", "⌘U"], ["Outline Mode", "⌘Y"],
      ["Create Outlines", "⇧⌘O"], ["Join", "⌘J"],
      ["Hide / Show Panels", "Tab"], ["Nudge", "Arrow keys"],
      ["Nudge ×10", "⇧ + Arrow keys"], ["Constrain", "Shift while dragging"],
      ["Duplicate while dragging", "Alt while dragging"],
    ];
    const table = el("div", { style: { display: "grid", gridTemplateColumns: "1fr auto", gap: "4px 18px", fontSize: "11px" } });
    for (const [label, keys] of rows) {
      table.append(el("span", { style: { color: "var(--text-dim)" }, text: label }));
      table.append(el("span", { class: "num", style: { padding: "1px 6px", fontFamily: "var(--font-mono)", fontSize: "10px", justifySelf: "end" }, text: keys }));
    }
    showDialog({
      title: "Keyboard Shortcuts",
      body: [table],
      footer: [button("Done", { variant: "primary", onClick: () => document.querySelector(".modal-backdrop")?.remove() })],
      width: 480,
    });
  },
  help: () => {
    showDialog({
      title: "VectorStudio Help",
      width: 520,
      body: [
        el("p", { class: "dialog__hint", style: { margin: 0 }, text: "VectorStudio is an Illustrator-style vector workspace built on the REA reverse-engineering library and the VectorCraft open-source vector engine." }),
        el("div", { class: "dialog__section" }, [
          el("h4", { text: "Draw" }),
          el("p", { class: "dialog__hint", style: { margin: 0 }, text: "Pick a shape tool and drag on the artboard. Hold Shift to constrain, Alt to draw from the centre. The Pen tool creates Bézier anchors: click for corners, drag for curves, click the first anchor to close." }),
        ]),
        el("div", { class: "dialog__section" }, [
          el("h4", { text: "Edit" }),
          el("p", { class: "dialog__hint", style: { margin: 0 }, text: "With the Selection tool, drag handles to scale and hover just outside a corner to rotate. Direct Selection edits anchors and direction handles. Smart Guides show magenta alignment hints." }),
        ]),
        el("div", { class: "dialog__section" }, [
          el("h4", { text: "Pathfinder" }),
          el("p", { class: "dialog__hint", style: { margin: 0 }, text: "Select overlapping shapes and use Unite, Minus Front, Intersect or Exclude. Operations run on a real arrangement solver — edges are split, classified by winding and re-chained." }),
        ]),
        el("div", { class: "dialog__section" }, [
          el("h4", { text: "Evidence" }),
          el("p", { class: "dialog__hint", style: { margin: 0 }, text: "The REA Analysis panel records each operation, counts document topology and produces a content digest you can export as JSON." }),
        ]),
      ],
      footer: [
        button("Keyboard Shortcuts", { onClick: () => { document.querySelector(".modal-backdrop")?.remove(); commands.shortcuts(); } }),
        button("Done", { variant: "primary", onClick: () => document.querySelector(".modal-backdrop")?.remove() }),
      ],
    });
  },
  about: () => {
    showDialog({
      title: "About VectorStudio",
      width: 430,
      body: [
        el("div", { style: { display: "grid", gridTemplateColumns: "1fr", gap: "8px" } }, [
          el("div", { style: { fontSize: "16px", fontWeight: "500" }, text: "VectorStudio 1.0" }),
          el("div", { class: "dialog__hint", text: "An Illustrator-grade vector workspace: artboards, Bézier editing, pathfinder booleans, gradients, type, layers and evidence-first audits." }),
          el("div", { class: "dialog__section" }, [
            el("h4", { text: "Built with" }),
            el("p", { class: "dialog__hint", style: { margin: 0 }, html: "<b>REA</b> — the reverse-engineering-anything toolkit (MCP + CLI) for structural evidence.<br/><b>VectorCraft</b> — the open-source vector art application written in pure Rust (MIT / Apache-2.0)." }),
          ]),
          el("div", { style: { display: "flex", gap: "6px" } }, [
            button("REA on GitHub", { onClick: () => window.open("https://github.com/morluto/rea", "_blank", "noopener") }),
            button("VectorCraft", { onClick: () => window.open("https://github.com/storytold/vectorcraft", "_blank", "noopener") }),
          ]),
        ]),
      ],
      footer: [button("Close", { variant: "primary", onClick: () => document.querySelector(".modal-backdrop")?.remove() })],
    });
  },
  zoomIn: () => { app.view.zoomAt(1.25, { x: app.view.screenWidth / 2, y: app.view.screenHeight / 2 }); app.syncZoom(); app.requestRender(true); },
  zoomOut: () => { app.view.zoomAt(0.8, { x: app.view.screenWidth / 2, y: app.view.screenHeight / 2 }); app.syncZoom(); app.requestRender(true); },
  fitArtboard: () => {
    const ab = activeArtboard(app.doc);
    app.view.fit(ab, 70);
    app.syncZoom();
    app.requestRender(true);
  },
  fitAll: () => {
    const bounds = unionBounds(app.doc.artboards.map((a) => ({ x: a.x, y: a.y, w: a.w, h: a.h })));
    app.view.fit(bounds, 60);
    app.syncZoom();
    app.requestRender(true);
  },
  actualSize: () => {
    const ab = activeArtboard(app.doc);
    app.view.zoom = 1;
    app.view.centerOn({ x: ab.x + ab.w / 2, y: ab.y + ab.h / 2 });
    app.syncZoom();
    app.requestRender(true);
  },
  openExternal: (url) => window.open(url, "_blank", "noopener"),
  moveDialog: () => {
    const dx = numField({ label: "X", value: 0 });
    const dy = numField({ label: "Y", value: 0 });
    const dialog = showDialog({
      title: "Move",
      width: 340,
      body: [el("div", { class: "row row--tight" }, [dx.el, dy.el]),
        el("div", { class: "dialog__hint", text: "Positive X moves right, positive Y moves down." })],
      footer: [button("Cancel", { onClick: () => dialog.close() }), button("Move", { variant: "primary", onClick: () => {
        app.history.record();
        for (const n of app.selectionNodes()) translateNode(n, dx.get(), dy.get());
        app.requestRender(true);
        app.refreshPanels();
        dialog.close();
      } })],
    });
  },
  simplifyDialog: () => {
    const tolerance = numField({ label: "", value: 1, min: 0.1, max: 20, step: 0.1, width: 70 });
    const dialog = showDialog({
      title: "Simplify",
      width: 340,
      body: [el("div", { class: "row" }, [el("span", { class: "label", style: { minWidth: "64px" } }, ["Tolerance"]), tolerance.el]),
        el("div", { class: "dialog__hint", text: "Higher tolerance removes more anchors." })],
      footer: [button("Cancel", { onClick: () => dialog.close() }), button("Simplify", { variant: "primary", onClick: () => {
        app.history.record();
        for (const node of app.selectionNodes()) {
          if (node.type !== "path") continue;
          node.subpaths = node.subpaths.map((sp) => {
            const flat = flattenSubpaths([sp], 0.2)[0];
            if (!flat) return sp;
            const simplified = simplifyRing(flat.points, tolerance.get());
            return { nodes: simplified.map((p) => makeNode(p.x, p.y)), closed: sp.closed };
          });
        }
        app.rea.record("Simplify paths");
        app.requestRender(true);
        app.refreshPanels();
        dialog.close();
      } })],
    });
  },
  dropShadowDialog: () => {
    const x = numField({ label: "X", value: 4 });
    const y = numField({ label: "Y", value: 6 });
    const blur = numField({ label: "B", value: 12, min: 0, max: 80 });
    const opacity = numField({ label: "O", value: 45, min: 0, max: 100 });
    const color = textField({ value: "#000000" });
    const dialog = showDialog({
      title: "Drop Shadow",
      body: [
        el("div", { class: "row row--tight" }, [x.el, y.el, blur.el, opacity.el]),
        el("div", { class: "row" }, [el("span", { class: "label" }, ["Color"]), color.el]),
        el("div", { class: "dialog__hint", text: "Shadows are rendered live and exported with the SVG." }),
      ],
      footer: [button("Cancel", { onClick: () => dialog.close() }), button("Apply", { variant: "primary", onClick: () => {
        app.applyEffect({ type: "shadow", x: x.get(), y: y.get(), blur: blur.get(), opacity: opacity.get() / 100, color: color.get() });
        dialog.close();
      } })],
    });
  },
  roundCornersDialog: () => {
    const radius = numField({ label: "", value: 12, min: 0.5, max: 400, width: 70 });
    const dialog = showDialog({
      title: "Round Corners",
      width: 320,
      body: [el("div", { class: "row" }, [el("span", { class: "label" }, ["Radius"]), radius.el])],
      footer: [button("Cancel", { onClick: () => dialog.close() }), button("Apply", { variant: "primary", onClick: () => {
        app.applyEffect({ type: "round", radius: radius.get() });
        dialog.close();
      } })],
    });
  },
  roughenDialog: () => {
    const size = numField({ label: "S", value: 4, min: 0.1, max: 60 });
    const detail = numField({ label: "D", value: 8, min: 1, max: 60 });
    const dialog = showDialog({
      title: "Roughen",
      width: 340,
      body: [el("div", { class: "row row--tight" }, [size.el, detail.el]),
        el("div", { class: "dialog__hint", text: "Displaces anchors; detail controls how many anchors are affected." })],
      footer: [button("Cancel", { onClick: () => dialog.close() }), button("Apply", { variant: "primary", onClick: () => {
        app.applyEffect({ type: "roughen", size: size.get(), detail: detail.get() });
        dialog.close();
      } })],
    });
  },
  zigzagDialog: () => {
    const size = numField({ label: "S", value: 6, min: 0.1, max: 40 });
    const ridges = numField({ label: "R", value: 4, min: 1, max: 40 });
    const dialog = showDialog({
      title: "Zig Zag",
      width: 340,
      body: [el("div", { class: "row row--tight" }, [size.el, ridges.el])],
      footer: [button("Cancel", { onClick: () => dialog.close() }), button("Apply", { variant: "primary", onClick: () => {
        app.applyEffect({ type: "zigzag", size: size.get(), ridges: ridges.get() });
        dialog.close();
      } })],
    });
  },
  puckerDialog: () => {
    const amount = numField({ label: "%", value: 25, min: -80, max: 200, width: 70 });
    const dialog = showDialog({
      title: "Pucker & Bloat",
      width: 320,
      body: [el("div", { class: "row" }, [el("span", { class: "label" }, ["Amount"]), amount.el]),
        el("div", { class: "dialog__hint", text: "Negative values pucker inward; positive values bloat outward." })],
      footer: [button("Cancel", { onClick: () => dialog.close() }), button("Apply", { variant: "primary", onClick: () => {
        app.applyEffect({ type: "pucker", amount: amount.get() / 100 });
        dialog.close();
      } })],
    });
  },
  arcWarp: () => {
    app.applyEffect({ type: "arc", bend: 0.35 });
    toast("Arc warp applied");
  },
};

app.commands = commands;

/* ================================================================== effects */

app.applyEffect = (effect) => {
  const nodes = app.selectionNodes();
  if (!nodes.length) {
    toast("Select artwork to apply an effect");
    return;
  }
  app.history.record();
  app.lastEffect = effect;
  for (const node of nodes) {
    if (effect.type === "shadow") {
      node.effect = { ...(node.effect || {}), shadow: { ...effect } };
      continue;
    }
    if (node.type !== "path") continue;
    if (effect.type === "round") roundCorners(node, effect.radius);
    if (effect.type === "roughen") roughen(node, effect.size, effect.detail);
    if (effect.type === "zigzag") zigzag(node, effect.size, effect.ridges);
    if (effect.type === "pucker") pucker(node, effect.amount);
    if (effect.type === "arc") arcWarp(node, effect.bend);
  }
  app.rea.record(`Effect ${effect.type}`);
  app.dirty = true;
  app.requestRender(true);
  app.refreshPanels();
};

app.removeEffects = () => {
  app.mutate("remove-effects", () => {
    for (const node of app.selectionNodes()) delete node.effect;
  });
};

function roundCorners(node, radius) {
  node.subpaths = node.subpaths.map((sp) => {
    if (sp.nodes.length < 3) return sp;
    const nodes = sp.nodes;
    const out = [];
    for (let i = 0; i < nodes.length; i++) {
      const prev = nodes[(i - 1 + nodes.length) % nodes.length];
      const cur = nodes[i];
      const next = nodes[(i + 1) % nodes.length];
      const d1 = Math.hypot(cur.x - prev.x, cur.y - prev.y) || 1;
      const d2 = Math.hypot(next.x - cur.x, next.y - cur.y) || 1;
      const r = Math.min(radius, d1 / 2, d2 / 2);
      const p1 = { x: cur.x + ((prev.x - cur.x) / d1) * r, y: cur.y + ((prev.y - cur.y) / d1) * r };
      const p2 = { x: cur.x + ((next.x - cur.x) / d2) * r, y: cur.y + ((next.y - cur.y) / d2) * r };
      out.push(makeNode(p1.x, p1.y));
      out.push(makeNode(p2.x, p2.y));
    }
    return { nodes: out.map((n) => ({ ...n, ix: n.x, iy: n.y, ox: n.x, oy: n.y })), closed: sp.closed };
  });
  node.kind = "path";
  delete node.rect;
}

function roughen(node, size, detail) {
  const count = Math.max(1, Math.round(detail));
  node.subpaths = node.subpaths.map((sp) => {
    const nodes = [];
    for (let i = 0; i < sp.nodes.length; i++) {
      const n = sp.nodes[i];
      for (let k = 0; k < count; k++) {
        const t = k / count;
        const next = sp.nodes[(i + 1) % sp.nodes.length];
        const x = n.x + (next.x - n.x) * t;
        const y = n.y + (next.y - n.y) * t;
        const jitter = (Math.random() - 0.5) * size;
        const angle = Math.random() * Math.PI * 2;
        nodes.push(makeNode(x + Math.cos(angle) * jitter, y + Math.sin(angle) * jitter));
      }
    }
    return { nodes, closed: sp.closed };
  });
  node.kind = "path";
}

function zigzag(node, size, ridges) {
  node.subpaths = node.subpaths.map((sp) => {
    const nodes = [];
    const n = sp.nodes;
    for (let i = 0; i < n.length; i++) {
      const a = n[i];
      const b = n[(i + 1) % n.length];
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len, ny = dx / len;
      for (let k = 0; k < ridges * 2; k++) {
        const t = k / (ridges * 2);
        const sign = k % 2 === 0 ? 1 : -1;
        nodes.push(makeNode(a.x + dx * t + nx * size * sign, a.y + dy * t + ny * size * sign));
      }
    }
    return { nodes, closed: sp.closed };
  });
  node.kind = "path";
}

function pucker(node, amount) {
  const b = subpathsBounds(node.subpaths);
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  const factor = 1 + amount;
  node.subpaths = node.subpaths.map((sp) => ({
    closed: sp.closed,
    nodes: sp.nodes.map((n) => ({
      x: cx + (n.x - cx) * factor,
      y: cy + (n.y - cy) * factor,
      ix: cx + (n.ix - cx) * factor,
      iy: cy + (n.iy - cy) * factor,
      ox: cx + (n.ox - cx) * factor,
      oy: cy + (n.oy - cy) * factor,
    })),
  }));
}

function arcWarp(node, bend) {
  const b = subpathsBounds(node.subpaths);
  const w = b.w || 1;
  node.subpaths = node.subpaths.map((sp) => ({
    closed: sp.closed,
    nodes: sp.nodes.map((n) => {
      const t = (n.x - b.x) / w;
      const offset = Math.sin(t * Math.PI) * bend * w * 0.35;
      const offY = (v) => v + offset;
      return { x: n.x, y: offY(n.y), ix: n.ix, iy: offY(n.iy), ox: n.ox, oy: offY(n.oy) };
    }),
  }));
}

/* ================================================================== keyboard */

const TOOL_KEYS = {
  v: "select", a: "direct", p: "pen", t: "type", m: "rect", l: "ellipse",
  n: "pencil", b: "brush", r: "rotate", e: "free", g: "gradient", i: "eyedropper",
  h: "hand", z: "zoom", y: "artboard", s: "scale", o: "reflect",
};

function onKeyDown(e) {
  const target = e.target;
  const inField = target instanceof HTMLElement && (target.closest("input, textarea, select, [contenteditable='true']"));
  const mod = e[MOD];
  const key = e.key;

  if (key === " " && !inField) {
    e.preventDefault();
    if (!app.tools.spaceDown) {
      app.tools.spaceDown = true;
      $("#viewport").style.cursor = "grab";
    }
    return;
  }

  if (key === "Tab" && !inField) {
    e.preventDefault();
    const shellHidden = $("#app").classList.toggle("is-shell-hidden");
    if (shellHidden) toast("Press Tab to restore panels");
    app.renderer?.resize();
    return;
  }

  if (inField) return;

  if (key === "Escape") {
    if (app.tools.pen) { app.tools.commitActivePen(false); return; }
    if (app.selection.length) { app.setSelection([]); return; }
    app.setSelection([]);
  }

  if (key === "Enter" && app.tools.pen) {
    app.tools.commitActivePen(false);
    return;
  }

  if (key === "Delete" || key === "Backspace") {
    e.preventDefault();
    if (app.tool === "direct" && app.selectedAnchors?.length) {
      app.tools.deleteSelectedAnchors();
    } else {
      app.deleteSelection();
    }
    return;
  }

  if (mod) {
    const k = key.toLowerCase();
    if (k === "z") { e.preventDefault(); e.shiftKey ? commands.redo() : commands.undo(); return; }
    if (k === "y") { e.preventDefault(); e.shiftKey ? app.convertTextToOutlines() : app.toggleOutline(); return; }
    if (k === "a") { e.preventDefault(); e.shiftKey ? app.setSelection([]) : app.selectAll(); return; }
    if (k === "c") { e.preventDefault(); commands.copy(); return; }
    if (k === "x") { e.preventDefault(); commands.cut(); return; }
    if (k === "v") { e.preventDefault(); e.shiftKey ? commands.pasteInPlace() : commands.paste(); return; }
    if (k === "d") { e.preventDefault(); app.duplicateSelection(); return; }
    if (k === "g") { e.preventDefault(); e.shiftKey ? app.ungroupSelection() : app.groupSelection(); return; }
    if (k === "s") { e.preventDefault(); commands.saveDocument(); return; }
    if (k === "o") {
      e.preventDefault();
      if (e.shiftKey) app.convertTextToOutlines();
      else commands.openDocument();
      return;
    }
    if (k === "n") { e.preventDefault(); commands.newDocument(); return; }
    if (k === "p") { e.preventDefault(); commands.print(); return; }
    if (k === "0") { e.preventDefault(); e.altKey ? commands.fitAll() : commands.fitArtboard(); return; }
    if (k === "1") { e.preventDefault(); commands.actualSize(); return; }
    if (key === "+" || key === "=") { e.preventDefault(); commands.zoomIn(); return; }
    if (key === "-") { e.preventDefault(); commands.zoomOut(); return; }
    if (k === "r") { e.preventDefault(); app.toggleRulers(); return; }
    if (k === "u") { e.preventDefault(); app.toggleSmartGuides(); return; }
    if (k === '"') { e.preventDefault(); app.toggleGrid(); return; }
    if (k === ";") { e.preventDefault(); app.toggleGuides(); return; }
    if (k === "j") { e.preventDefault(); app.joinPaths(); return; }
    if (k === "7") { e.preventDefault(); app.makeClipMask(); return; }
    if (k === "8") { e.preventDefault(); e.altKey ? app.releaseCompoundPath() : app.makeCompoundPath(); return; }
    if (k === "2") { e.preventDefault(); app.lockSelection(true); return; }
    if (k === "3") { e.preventDefault(); app.hideSelection(true); return; }
    if (k === "e") { e.preventDefault(); commands.exportDialog(); return; }
    if (key === "]") { e.preventDefault(); app.arrange(e.shiftKey ? "front" : "forward"); return; }
    if (key === "[") { e.preventDefault(); app.arrange(e.shiftKey ? "back" : "backward"); return; }
    if (k === "k") { e.preventDefault(); commands.shortcuts(); return; }
    return;
  }

  if (key.startsWith("Arrow")) {
    e.preventDefault();
    const step = e.shiftKey ? 10 : 1;
    const dx = key === "ArrowLeft" ? -step : key === "ArrowRight" ? step : 0;
    const dy = key === "ArrowUp" ? -step : key === "ArrowDown" ? step : 0;
    if (!app.selection.length) return;
    app.history.record();
    for (const node of app.selectionNodes()) translateNode(node, dx, dy);
    app.dirty = true;
    app.requestRender(true);
    app.refreshPanels();
    return;
  }

  if (key === "x") { app.setTarget(app.target === "fill" ? "stroke" : "fill"); updateToolbarProxy(); return; }
  if (key === "d") {
    app.fill = { type: "solid", color: "#ffffff" };
    app.stroke = { ...app.newStroke(), color: "#000000", width: 1 };
    app.refreshPanels();
    return;
  }
  if (key === "Escape") return;

  const lower = key.toLowerCase();
  if (e.shiftKey && lower === "o") { app.setTool("artboard"); return; }
  if (e.shiftKey && lower === "m") { app.setTool("shapeBuilder"); return; }
  if (e.shiftKey && lower === "p") { app.setTool("pencil"); return; }
  if (lower === "\\") { app.setTool("line"); return; }
  if (lower === "f") { app.setTool("free"); return; }
  if (TOOL_KEYS[lower] && TOOL_KEYS[lower] !== "reflect") {
    app.setTool(TOOL_KEYS[lower]);
    return;
  }
}

function onKeyUp(e) {
  if (e.key === " ") {
    app.tools.spaceDown = false;
    const vp = $("#viewport");
    if (vp) vp.style.cursor = "default";
  }
}

/* ================================================================== boot */

function boot() {
  app.renderer = new Renderer(app);
  app.tools = new ToolController(app);
  app.panels = new PanelDock(app, $("#dock"));
  app.controlbar = new ControlBar(app, $("#controlbar"));
  menuBar(app, $("#menu-items"));
  buildToolbar();
  initTooltips();

  app.loadDocument(buildSampleDocument());
  app.tools.cornerRadius = 12;

  // zoom select
  $("#zoom-select").addEventListener("change", (e) => {
    const zoom = parseFloat(e.target.value) || 1;
    app.view.zoomAt(zoom / app.view.zoom, { x: app.view.screenWidth / 2, y: app.view.screenHeight / 2 });
    app.requestRender(true);
  });

  $("#btn-help").addEventListener("click", () => commands.help());
  $("#workspace-switcher").addEventListener("click", (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    showMenu(r.left - 120, r.bottom + 2, [
      { label: "Essentials", action: () => app.setWorkspace("Essentials") },
      { label: "Typography", action: () => app.setWorkspace("Typography") },
      { label: "Layout", action: () => app.setWorkspace("Layout") },
      { label: "Painting", action: () => app.setWorkspace("Painting") },
      { separator: true },
      { label: "Dark Theme", checked: document.documentElement.dataset.theme === "dark", action: () => app.setTheme("dark") },
      { label: "Light Theme", checked: document.documentElement.dataset.theme === "light", action: () => app.setTheme("light") },
    ]);
  });
  $("#status-rea").addEventListener("click", () => {
    app.scrollToGroup("rea");
    app.rea.analyze(app.doc);
    app.refreshPanels();
    toast("REA evidence refreshed");
  });

  // viewport pointer tracking for rulers
  const viewport = $("#viewport");
  viewport.addEventListener("pointermove", (e) => {
    app.renderer.paintRulers();
  });

  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("keyup", onKeyUp);

  // ruler guide dragging
  setupGuideDragging();

  // drag & drop document open
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", async (e) => {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      if (file.name.endsWith(".svg")) {
        toast("SVG import is not available yet — open a .vectorstudio file");
        return;
      }
      const data = JSON.parse(text);
      if (!data.layers) throw new Error("Not a VectorStudio document");
      data.name = data.name || file.name.replace(/\.(json|vectorstudio)$/, "");
      app.loadDocument(data);
      toast(`Opened ${file.name}`);
    } catch (err) {
      showAlert("Could not open file", String(err.message || err));
    }
  });

  // keep canvas sized to the window
  window.addEventListener("resize", () => {
    app.renderer.resize();
    app.syncZoom();
  });

  app.syncZoom();
  updateStatus();
  app.rea.record("Session start", "VectorStudio 1.0");
}

function setupGuideDragging() {
  const rulerH = $("#ruler-h");
  const rulerV = $("#ruler-v");
  const canvasArea = $(".canvas-area");

  const startDrag = (axis) => (e) => {
    e.preventDefault();
    const rect = canvasArea.getBoundingClientRect();
    const pos = axis === "h" ? e.clientY - rect.top : e.clientX - rect.left;
    app.toolState.guideDrag = { axis, pos };
    app.requestOverlay();
    const move = (ev) => {
      const p = axis === "h" ? ev.clientY - rect.top : ev.clientX - rect.left;
      app.toolState.guideDrag.pos = p;
      app.requestOverlay();
    };
    const up = (ev) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const p = axis === "h" ? ev.clientY - rect.top : ev.clientX - rect.left;
      const docPoint = app.view.screenToDoc({ x: axis === "h" ? 0 : p, y: axis === "h" ? p : 0 });
      app.history.record();
      if (!app.doc.guides) app.doc.guides = [];
      app.doc.guides.push({ id: uid("gd"), axis, pos: axis === "h" ? docPoint.y : docPoint.x, visible: true });
      app.rea.record("Add guide", `${axis} ${fmt(axis === "h" ? docPoint.y : docPoint.x)}`);
      app.toolState.guideDrag = null;
      app.requestOverlay();
      app.requestRender(true);
      app.refreshPanels();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  rulerH.addEventListener("pointerdown", startDrag("h"));
  rulerV.addEventListener("pointerdown", startDrag("v"));
}

/* start */
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
