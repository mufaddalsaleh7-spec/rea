/**
 * Tool controller: pointer/keyboard interaction for the toolbar, selection
 * transforms, Bézier editing, shape creation, freehand drawing, gradient
 * direction, eyedropper, measuring, artboards, pan and zoom.
 */

import {
  rectSubpaths, ellipseSubpaths, polygonSubpaths, starSubpaths, lineSubpaths,
  arcSubpaths, spiralSubpaths, transformSubpaths, subpathsBounds, unionBounds,
  applyM, rotateM, scaleM, translateM, shearM, makeNode, subpathsToPath2D,
  closestPointOnSubpaths, simplifyRing, boundsCenter,
} from "./geom.js";
import {
  createRect, createEllipse, createPolygon, createStar, createLine, createPath,
  createText, createGroup, createLayer, nodeBounds, nodeSubpaths, translateNode,
  refreshPrimitive, findNode, selectionBounds, textMetrics, buildSampleDocument,
} from "./doc.js";
import { clamp, fmt, uid, nextFrame } from "./util.js";

const HANDLE_HIT = 7;
const SNAP_HIT = 6;
const DRAG_START = 3;

export const TOOL_DEFS = [
  { id: "select", name: "Selection Tool", key: "V", flyout: ["select", "direct", "group", "lasso"] },
  { id: "pen", name: "Pen Tool", key: "P", flyout: ["pen", "curvature", "addAnchor", "deleteAnchor"] },
  { id: "type", name: "Type Tool", key: "T", flyout: ["type", "typepath", "typearea"] },
  { id: "line", name: "Line Segment Tool", key: "\\", flyout: ["line", "arc", "spiral", "grid"] },
  { id: "rect", name: "Rectangle Tool", key: "M", flyout: ["rect", "roundrect", "ellipse", "polygon", "star"] },
  { id: "pencil", name: "Pencil Tool", key: "N", flyout: ["pencil", "smooth"] },
  { id: "brush", name: "Paintbrush Tool", key: "B", flyout: ["brush", "blob"] },
  { id: "rotate", name: "Rotate Tool", key: "R", flyout: ["rotate", "scale", "shear", "reshape"] },
  { id: "free", name: "Free Transform Tool", key: "E", flyout: ["free", "warp"] },
  { id: "gradient", name: "Gradient Tool", key: "G", flyout: ["gradient", "mesh"] },
  { id: "eyedropper", name: "Eyedropper Tool", key: "I", flyout: ["eyedropper", "measure"] },
  { id: "artboard", name: "Artboard Tool", key: "⇧O", flyout: ["artboard", "slice"] },
  { id: "hand", name: "Hand Tool", key: "H", flyout: ["hand", "zoom"] },
  { id: "shapeBuilder", name: "Shape Builder Tool", key: "⇧M" },
];


/** Icon name used for each tool id (shared with the control bar). */
export const TOOL_DEFS_ICON = {
  select: "select", direct: "direct", group: "group", lasso: "select", pen: "pen",
  curvature: "curvpen", addAnchor: "addanchor", deleteAnchor: "addanchor",
  type: "type", typepath: "typepath", typearea: "typearea", line: "line", arc: "arc",
  spiral: "spiral", grid: "grid", rect: "rect", roundrect: "roundrect",
  ellipse: "ellipse", polygon: "polygon", star: "star", pencil: "pencil",
  smooth: "smooth", brush: "brush", blob: "blob", rotate: "rotate", scale: "scale",
  shear: "shear", reshape: "reshape", free: "free", warp: "warp",
  gradient: "gradient", mesh: "mesh", eyedropper: "eyedropper", measure: "measure",
  artboard: "artboard", slice: "slice", hand: "hand", zoom: "zoom",
  shapeBuilder: "swatch",
};

export const TOOL_LABELS = {
  ...Object.fromEntries(TOOL_DEFS.map((t) => [t.id, t.name])),
  direct: "Direct Selection Tool",
  group: "Group Selection Tool",
  lasso: "Lasso Tool",
  curvature: "Curvature Tool",
  addAnchor: "Add Anchor Point Tool",
  deleteAnchor: "Delete Anchor Point Tool",
  typepath: "Type on a Path Tool",
  typearea: "Area Type Tool",
  arc: "Arc Tool",
  spiral: "Spiral Tool",
  grid: "Rectangular Grid Tool",
  roundrect: "Rounded Rectangle Tool",
  ellipse: "Ellipse Tool",
  polygon: "Polygon Tool",
  star: "Star Tool",
  smooth: "Smooth Tool",
  blob: "Blob Brush Tool",
  scale: "Scale Tool",
  shear: "Shear Tool",
  reshape: "Reshape Tool",
  warp: "Warp Tool",
  mesh: "Mesh Tool",
  measure: "Measure Tool",
  slice: "Slice Tool",
  zoom: "Zoom Tool",
};

const SHAPE_TOOLS = new Set(["rect", "roundrect", "ellipse", "polygon", "star", "line", "arc", "spiral", "grid"]);
const SELECT_TOOLS = new Set(["select", "direct", "group", "lasso", "free"]);
const HANDLE_CURSORS = {
  nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize",
  n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize",
};

export class ToolController {
  constructor(app) {
    this.app = app;
    this.drag = null;
    this.pen = null;
    this.marquee = null;
    this.lastClick = { time: 0, id: null };
    this.polygonSides = 6;
    this.starPoints = 5;
    this.starInner = 0.5;
    this.cornerRadius = 0;
    this.spaceDown = false;
    this.bind();
  }

  bind() {
    const vp = document.getElementById("viewport");
    this.viewport = vp;
    vp.addEventListener("pointerdown", (e) => this.onPointerDown(e));
    vp.addEventListener("pointermove", (e) => this.onPointerMove(e));
    vp.addEventListener("pointerup", (e) => this.onPointerUp(e));
    vp.addEventListener("pointercancel", (e) => this.onPointerUp(e));
    vp.addEventListener("pointerleave", () => {
      this.app.pointerScreen = null;
      this.app.requestOverlay();
      this.app.renderer.paintRulers();
    });
    vp.addEventListener("dblclick", (e) => this.onDoubleClick(e));
    vp.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      this.app.openContextMenu(e.clientX, e.clientY);
    });
    vp.addEventListener("wheel", (e) => this.onWheel(e), { passive: false });
  }

  /* ------------------------------------------------------------- helpers */

  screenPoint(e) {
    const r = this.viewport.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  docPoint(e) {
    return this.app.view.screenToDoc(this.screenPoint(e));
  }

  get tool() { return this.app.tool; }

  selectionHit(p) {
    const app = this.app;
    if (!app.selection.length) return null;
    const b = app.selectionBounds();
    if (!b) return null;
    const v = app.view;
    const r = v.rectDocToScreen(b);
    const sx = p.x, sy = p.y;
    const near = (x, y) => Math.hypot(sx - x, sy - y) <= HANDLE_HIT;
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    if (near(r.x, r.y)) return { mode: "scale", handle: "nw" };
    if (near(r.x + r.w, r.y)) return { mode: "scale", handle: "ne" };
    if (near(r.x, r.y + r.h)) return { mode: "scale", handle: "sw" };
    if (near(r.x + r.w, r.y + r.h)) return { mode: "scale", handle: "se" };
    if (near(cx, r.y)) return { mode: "scale", handle: "n" };
    if (near(cx, r.y + r.h)) return { mode: "scale", handle: "s" };
    if (near(r.x, cy)) return { mode: "scale", handle: "w" };
    if (near(r.x + r.w, cy)) return { mode: "scale", handle: "e" };
    // rotation zone just outside the box
    const pad = 14;
    const insideOuter = sx >= r.x - pad && sx <= r.x + r.w + pad && sy >= r.y - pad && sy <= r.y + r.h + pad;
    const outsideInner = sx < r.x || sx > r.x + r.w || sy < r.y || sy > r.y + r.h;
    if (insideOuter && outsideInner) return { mode: "rotate" };
    return null;
  }

  cursorFor(p) {
    const app = this.app;
    if (this.spaceDown || app.tool === "hand") return "grab";
    const t = app.tool;
    if (t === "zoom") return "zoom-in";
    if (t === "type" || t === "typepath" || t === "typearea") return "text";
    if (t === "pen" || t === "curvature") return "crosshair";
    if (SHAPE_TOOLS.has(t)) return "crosshair";
    if (t === "pencil" || t === "brush" || t === "blob" || t === "smooth") return "crosshair";
    if (t === "eyedropper") return "copy";
    if (t === "measure") return "crosshair";
    if (t === "gradient") return "crosshair";
    if (t === "artboard") return "crosshair";
    if (t === "rotate") return "crosshair";
    if (t === "scale") return "crosshair";
    if (t === "direct" || t === "select" || t === "group") {
      const hit = this.selectionHit(p);
      if (hit?.mode === "scale") return HANDLE_CURSORS[hit.handle] || "default";
      if (hit?.mode === "rotate") return "crosshair";
      const nodeId = app.renderer.hitTest(app.view.screenToDoc(p));
      if (nodeId) return "move";
    }
    return "default";
  }

  /* ------------------------------------------------------------- pointer */

  onPointerDown(e) {
    const app = this.app;
    if (e.button === 2) return;
    const p = this.screenPoint(e);
    const dp = this.docPoint(e);
    app.pointerScreen = p;
    this.viewport.setPointerCapture?.(e.pointerId);

    if (e.button === 1 || this.spaceDown || app.tool === "hand") {
      this.drag = { mode: "pan", start: p, tx: app.view.tx, ty: app.view.ty, changed: false };
      this.viewport.classList.add("is-panning");
      return;
    }

    if (app.tool === "zoom") {
      const factor = e.altKey ? 1 / 1.6 : 1.6;
      app.view.zoomAt(factor, p);
      app.syncZoom();
      app.requestRender(true);
      return;
    }

    if (app.tool === "eyedropper") {
      this.pickStyle(dp, e);
      return;
    }

    if (app.tool === "measure") {
      this.drag = { mode: "measure", startScreen: p };
      app.toolState.measure = { a: p, b: p };
      app.requestOverlay();
      return;
    }

    if (app.tool === "artboard") {
      this.startArtboard(e, dp, p);
      return;
    }

    if (app.tool === "pen" || app.tool === "curvature") {
      this.penPointerDown(e, dp, p);
      return;
    }

    if (app.tool === "pencil" || app.tool === "brush" || app.tool === "blob" || app.tool === "smooth") {
      this.startFreehand(e, dp, p);
      return;
    }

    if (app.tool === "gradient") {
      this.startGradientDrag(e, dp, p);
      return;
    }

    if (app.tool === "type" || app.tool === "typepath" || app.tool === "typearea") {
      this.startType(e, dp, p);
      return;
    }

    if (app.tool === "rotate" || app.tool === "scale" || app.tool === "shear") {
      this.startTransformTool(e, dp, p);
      return;
    }

    if (SHAPE_TOOLS.has(app.tool)) {
      this.startShape(e, dp, p);
      return;
    }

    if (app.tool === "lasso") {
      this.drag = { mode: "lasso", points: [dp], additive: e.shiftKey };
      app.marquee = { x: p.x, y: p.y, w: 0, h: 0, lasso: true };
      return;
    }

    if (app.tool === "shapeBuilder") {
      this.runShapeBuilder(e, dp);
      return;
    }

    // selection family
    this.startSelect(e, dp, p);
  }

  startSelect(e, dp, p) {
    const app = this.app;
    const direct = app.tool === "direct";

    if (direct) {
      const anchor = app.renderer.anchorAt(p);
      if (anchor) {
        const key = `${anchor.nodeId}:${anchor.si}:${anchor.ni}`;
        if (anchor.handle) {
          app.history.beginGesture();
          const node = app.findNode(anchor.nodeId);
          app.setSelection([node.id]);
          this.drag = {
            mode: "handle", anchor, node, start: dp,
            original: JSON.parse(JSON.stringify(node.subpaths)),
            changed: false,
          };
          return;
        }
        const existing = app.selectedAnchors || [];
        const isSelected = existing.some((a) => `${a.nodeId}:${a.si}:${a.ni}` === key);
        if (e.shiftKey) {
          app.selectedAnchors = isSelected
            ? existing.filter((a) => `${a.nodeId}:${a.si}:${a.ni}` !== key)
            : [...existing, { nodeId: anchor.nodeId, si: anchor.si, ni: anchor.ni }];
        } else if (!isSelected) {
          app.selectedAnchors = [{ nodeId: anchor.nodeId, si: anchor.si, ni: anchor.ni }];
        }
        app.setSelection([anchor.nodeId]);
        app.history.beginGesture();
        this.drag = {
          mode: "anchors", start: dp, changed: false,
          originals: app.selectionNodes().map((n) => ({ node: n, subpaths: JSON.parse(JSON.stringify(n.subpaths)) })),
          anchors: app.selectedAnchors.map((a) => ({ ...a })),
        };
        app.requestOverlay();
        return;
      }
    }

    const hit = this.selectionHit(p);
    if (hit && !e.shiftKey) {
      if (hit.mode === "scale") {
        this.startScale(e, dp, p, hit.handle);
        return;
      }
      if (hit.mode === "rotate") {
        this.startRotate(e, dp, p);
        return;
      }
    }

    const nodeId = app.renderer.hitTest(dp);
    if (!nodeId) {
      if (!e.shiftKey) app.setSelection([]);
      app.selectedAnchors = [];
      this.drag = { mode: "marquee", start: p, additive: e.shiftKey, base: app.selection.slice() };
      app.marquee = { x: p.x, y: p.y, w: 0, h: 0 };
      app.requestOverlay();
      return;
    }

    const node = app.findNode(nodeId);
    const target = app.tool === "group" ? app.topLevelGroupOf(node) : node;
    if (e.shiftKey) {
      const next = app.selection.includes(target.id)
        ? app.selection.filter((id) => id !== target.id)
        : [...app.selection, target.id];
      app.setSelection(next);
    } else if (!app.selection.includes(target.id)) {
      app.setSelection([target.id]);
    }
    if (!direct) app.selectedAnchors = [];

    const b = app.selectionBounds();
    if (!b) return;
    app.history.beginGesture();
    this.drag = {
      mode: "move",
      start: dp,
      origin: { x: b.x, y: b.y },
      bounds: b,
      nodes: JSON.parse(JSON.stringify(app.selectionNodes())),
      duplicate: e.altKey,
      changed: false,
      cursorMoved: false,
    };
    app.isDragging = true;
  }

  startScale(e, dp, p, handle) {
    const app = this.app;
    const b = app.selectionBounds();
    app.history.beginGesture();
    this.drag = {
      mode: "scale", start: dp, handle, bounds: b,
      nodes: JSON.parse(JSON.stringify(app.selectionNodes())),
      changed: false, aspect: e.shiftKey,
    };
    app.isDragging = true;
  }

  startRotate(e, dp, p) {
    const app = this.app;
    const b = app.selectionBounds();
    const center = boundsCenter(b);
    app.history.beginGesture();
    this.drag = {
      mode: "rotate", start: dp, center,
      startAngle: Math.atan2(dp.y - center.y, dp.x - center.x),
      nodes: JSON.parse(JSON.stringify(app.selectionNodes())),
      changed: false, snap: e.shiftKey,
    };
    app.isDragging = true;
  }

  startTransformTool(e, dp, p) {
    const app = this.app;
    const b = app.selectionBounds();
    if (!b) {
      app.setStatus("Select artwork first");
      return;
    }
    const center = boundsCenter(b);
    app.history.beginGesture();
    this.drag = {
      mode: app.tool === "rotate" ? "rotate" : app.tool === "scale" ? "scale" : "shear",
      toolMode: true,
      start: dp,
      center,
      startAngle: Math.atan2(dp.y - center.y, dp.x - center.x),
      startDist: Math.hypot(dp.x - center.x, dp.y - center.y) || 1,
      bounds: b,
      nodes: JSON.parse(JSON.stringify(app.selectionNodes())),
      changed: false,
    };
    app.isDragging = true;
  }

  startShape(e, dp, p) {
    const app = this.app;
    this.drag = {
      mode: "shape", start: dp, startScreen: p,
      kind: app.tool,
      center: e.altKey,
      constrain: e.shiftKey,
      changed: false,
    };
    app.toolState.shapePreview = { kind: app.tool, bounds: { x: dp.x, y: dp.y, w: 0, h: 0 } };
    app.requestOverlay();
  }

  startArtboard(e, dp, p) {
    const app = this.app;
    const hitAb = app.doc.artboards.find((ab) =>
      dp.x >= ab.x && dp.x <= ab.x + ab.w && dp.y >= ab.y && dp.y <= ab.y + ab.h);
    if (hitAb) {
      app.doc.activeArtboardId = hitAb.id;
      app.refreshPanels();
      app.requestRender(true);
    }
    this.drag = { mode: "artboard", start: dp, changed: false };
    app.history.beginGesture();
    app.toolState.shapePreview = { kind: "rect", bounds: { x: dp.x, y: dp.y, w: 0, h: 0 } };
  }

  startGradientDrag(e, dp, p) {
    const app = this.app;
    const id = app.renderer.hitTest(dp);
    if (!id) return;
    const node = app.findNode(id);
    app.setSelection([id]);
    if (!node.fill || node.fill.type !== "gradient") {
      const color = node.fill?.color || "#2d8ceb";
      app.history.record();
      node.fill = { type: "gradient", stops: [{ offset: 0, color }, { offset: 1, color: "#ffffff" }], angle: 90 };
      app.toast("Converted fill to gradient");
    }
    app.history.beginGesture();
    const b = nodeBounds(node);
    this.drag = {
      mode: "gradient", start: dp, node, bounds: b,
      original: JSON.parse(JSON.stringify(node.fill)),
      changed: false,
    };
    app.requestRender(true);
  }

  penPointerDown(e, dp, p) {
    const app = this.app;
    if (!this.pen) {
      this.pen = {
        nodes: [],
        nodeIds: null,
        bounds: null,
        dragging: false,
      };
    }
    const pen = this.pen;

    // close the path by clicking the first anchor
    if (pen.nodes.length > 1) {
      const first = app.view.docToScreen(pen.nodes[0]);
      if (Math.hypot(first.x - p.x, first.y - p.y) < 8) {
        this.finishPen(true);
        return;
      }
    }

    const node = makeNode(dp.x, dp.y);
    pen.nodes.push(node);
    pen.dragging = true;
    pen.dragStart = dp;
    pen.pointerId = e.pointerId;
    this.updatePenPreview(dp, dp);
    app.requestOverlay();
  }

  updatePenPreview(cursorDoc, handleDoc) {
    const app = this.app;
    const pen = this.pen;
    if (!pen || !pen.nodes.length) {
      app.toolState.penPreview = null;
      return;
    }
    const last = pen.nodes[pen.nodes.length - 1];
    const prev = pen.nodes[pen.nodes.length - 2];
    const preview = {
      from: { x: last.x, y: last.y },
      to: cursorDoc,
      cursor: cursorDoc,
      showHandles: pen.dragging && handleDoc,
      anchor: { x: last.x, y: last.y },
      h1: { x: last.ix, y: last.iy },
      h2: { x: last.ox, y: last.oy },
    };
    if (pen.dragging && handleDoc) {
      preview.from = prev ? { x: prev.x, y: prev.y } : null;
      if (prev) {
        preview.out = { x: prev.ox, y: prev.oy };
        preview.in = { x: last.ix, y: last.iy };
      }
    }
    app.toolState.penPreview = preview;
  }

  onPointerMove(e) {
    const app = this.app;
    const p = this.screenPoint(e);
    const dp = this.docPoint(e);
    app.pointerScreen = p;
    app.hoverId = null;

    if (this.pen && !this.drag) {
      if (this.pen.dragging) {
        const last = this.pen.nodes[this.pen.nodes.length - 1];
        const dx = dp.x - last.x, dy = dp.y - last.y;
        if (Math.hypot(dx, dy) * app.view.zoom > DRAG_START) {
          last.ox = dp.x;
          last.oy = dp.y;
          last.ix = last.x - dx;
          last.iy = last.y - dy;
        }
        this.updatePenPreview(dp, dp);
      } else {
        this.updatePenPreview(dp, null);
      }
      app.requestOverlay();
      this.updateCursor(p);
      return;
    }

    if (!this.drag) {
      const hitId = app.renderer.hitTest(dp);
      if (hitId !== app.hoverId) {
        app.hoverId = hitId;
        app.requestOverlay();
      }
      if (this.tool === "pen" || this.tool === "curvature") {
        this.updatePenPreview(dp, null);
        app.requestOverlay();
      }
      this.updateCursor(p);
      app.renderer.paintRulers();
      return;
    }

    const d = this.drag;
    switch (d.mode) {
      case "pan": {
        app.view.tx = d.tx + (p.x - d.start.x);
        app.view.ty = d.ty + (p.y - d.start.y);
        app.requestRender(true);
        break;
      }
      case "marquee": {
        const x = Math.min(d.start.x, p.x), y = Math.min(d.start.y, p.y);
        const w = Math.abs(p.x - d.start.x), h = Math.abs(p.y - d.start.y);
        app.marquee = { x, y, w, h };
        this.marqueeSelect({ x, y, w, h }, d);
        app.requestOverlay();
        break;
      }
      case "lasso": {
        d.points.push(dp);
        app.marquee = { x: 0, y: 0, w: 0, h: 0, lasso: true, points: d.points };
        this.lassoSelect(d, e);
        app.requestOverlay();
        break;
      }
      case "move": {
        let dx = dp.x - d.start.x;
        let dy = dp.y - d.start.y;
        if (e.shiftKey) {
          if (Math.abs(dx) > Math.abs(dy)) dy = 0;
          else dx = 0;
        }
        const snap = app.showSmartGuides ? this.computeSnap(d.bounds, dx, dy, d) : null;
        if (snap) {
          dx += snap.dx;
          dy += snap.dy;
          app.snapLines = snap.lines;
        } else {
          app.snapLines = [];
        }
        if (!d.changed && (Math.abs(dx) > 0.001 || Math.abs(dy) > 0.001)) {
          d.changed = true;
          if (d.duplicate) this.duplicateSelectionForDrag();
        }
        this.applyMove(d, dx, dy);
        app.requestRender(true);
        app.setStatus(`X: ${fmt(d.bounds.x + dx)}  Y: ${fmt(d.bounds.y + dy)}`);
        break;
      }
      case "anchors": {
        let dx = dp.x - d.start.x;
        let dy = dp.y - d.start.y;
        if (e.shiftKey) {
          if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0;
        }
        d.changed = d.changed || Math.abs(dx) > 0.001 || Math.abs(dy) > 0.001;
        this.applyAnchorMove(d, dx, dy);
        app.requestRender(true);
        break;
      }
      case "handle": {
        const anchor = d.anchor;
        const node = d.node;
        const sp = node.subpaths[anchor.si];
        const n = sp.nodes[anchor.ni];
        if (anchor.handle === "in") {
          n.ix = dp.x;
          n.iy = dp.y;
          if (!e.altKey) {
            n.ox = 2 * n.x - dp.x;
            n.oy = 2 * n.y - dp.y;
          }
        } else {
          n.ox = dp.x;
          n.oy = dp.y;
          if (!e.altKey) {
            n.ix = 2 * n.x - dp.x;
            n.iy = 2 * n.y - dp.y;
          }
        }
        d.changed = true;
        app.requestRender(true);
        break;
      }
      case "scale": {
        this.applyScale(d, dp, e);
        app.requestRender(true);
        break;
      }
      case "rotate": {
        this.applyRotate(d, dp, e);
        app.requestRender(true);
        break;
      }
      case "shear": {
        this.applyShear(d, dp, e);
        app.requestRender(true);
        break;
      }
      case "shape": {
        const bounds = this.shapeBounds({ ...d, constrain: e.shiftKey, center: e.altKey }, dp, e);
        d.bounds = bounds;
        app.toolState.shapePreview = { kind: d.kind, bounds };
        app.requestOverlay();
        app.setStatus(`${fmt(Math.abs(bounds.w))} × ${fmt(Math.abs(bounds.h))} px`);
        this.showLivePreview(`${fmt(Math.abs(bounds.w), 0)} × ${fmt(Math.abs(bounds.h), 0)}`, p);
        break;
      }
      case "artboard": {
        const x = Math.min(d.start.x, dp.x), y = Math.min(d.start.y, dp.y);
        const w = Math.abs(dp.x - d.start.x), h = Math.abs(dp.y - d.start.y);
        app.toolState.shapePreview = { kind: "rect", bounds: { x, y, w, h } };
        d.bounds = { x, y, w, h };
        d.changed = w > 4 && h > 4;
        app.requestOverlay();
        break;
      }
      case "measure": {
        app.toolState.measure = { a: d.startScreen, b: p };
        app.requestOverlay();
        break;
      }
      case "gradient": {
        const b = d.bounds;
        const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
        let angle = (Math.atan2(dp.y - cy, dp.x - cx) * 180) / Math.PI + 90;
        if (e.shiftKey) angle = Math.round(angle / 45) * 45;
        d.node.fill = { ...d.node.fill, angle };
        d.changed = true;
        app.requestRender(true);
        break;
      }
      case "freehand": {
        d.points.push(dp);
        if (d.points.length > 2) {
          this.updateFreehandPreview(d);
          app.requestOverlay();
        }
        break;
      }
      default:
        break;
    }
  }

  showLivePreview(text, screenPoint) {
    const node = document.getElementById("live-preview");
    if (!node) return;
    if (!text) {
      node.hidden = true;
      return;
    }
    node.hidden = false;
    node.textContent = text;
    node.style.left = `${Math.round(screenPoint.x + 16)}px`;
    node.style.top = `${Math.round(screenPoint.y + 16)}px`;
  }

  hideLivePreview() {
    const node = document.getElementById("live-preview");
    if (node) node.hidden = true;
  }

  updateCursor(p) {
    const cursor = this.cursorFor(p);
    if (this.viewport.style.cursor !== cursor) this.viewport.style.cursor = cursor;
  }

  /* ------------------------------------------------------------- gestures */

  applyMove(d, dx, dy) {
    const app = this.app;
    const nodes = app.selectionNodes();
    for (const node of nodes) {
      const original = d.nodes.find((n) => n.id === node.id);
      if (!original) continue;
      // reset from original then translate: keeps primitives exact
      node.type === "text" ? null : null;
      const clone = JSON.parse(JSON.stringify(original));
      replaceNodeGeometry(node, clone);
      translateNode(node, dx, dy);
    }
  }

  applyAnchorMove(d, dx, dy) {
    const app = this.app;
    for (const anchor of d.anchors) {
      const entry = d.originals.find((o) => o.node.id === anchor.nodeId);
      if (!entry) continue;
      const node = entry.node;
      const orig = entry.subpaths[anchor.si];
      if (!orig) continue;
      node.subpaths[anchor.si] = {
        closed: orig.closed,
        nodes: orig.nodes.map((n, i) => (i === anchor.ni
          ? { x: n.x + dx, y: n.y + dy, ix: n.ix + dx, iy: n.iy + dy, ox: n.ox + dx, oy: n.oy + dy }
          : { ...n })),
      };
    }
  }

  applyScale(d, dp, e) {
    const b = d.bounds;
    const handle = d.toolMode ? "se" : d.handle;
    const west = handle.includes("w");
    const east = handle.includes("e");
    const north = handle.includes("n");
    const south = handle.includes("s");
    const fromCenter = d.toolMode || e.altKey;

    // anchor: the opposite edge/corner, or the centre when scaling from centre
    let anchorX = west ? b.x + b.w : b.x;
    let anchorY = north ? b.y + b.h : b.y;
    if (d.toolMode) {
      anchorX = d.center.x;
      anchorY = d.center.y;
    } else if (e.altKey) {
      anchorX = b.x + b.w / 2;
      anchorY = b.y + b.h / 2;
    }

    const safe = (v) => (Math.abs(v) < 1e-6 ? 1e-6 : v);
    let sx = 1;
    let sy = 1;
    if (east || west) {
      const startDist = safe(d.start.x - anchorX);
      const dist = dp.x - anchorX;
      sx = dist / startDist;
      if (d.toolMode) sx = Math.abs(dist) / Math.max(1e-6, Math.abs(startDist)) * (dist < 0 ? -1 : 1);
    }
    if (north || south) {
      const startDist = safe(d.start.y - anchorY);
      const dist = dp.y - anchorY;
      sy = dist / startDist;
      if (d.toolMode) sy = Math.abs(dist) / Math.max(1e-6, Math.abs(startDist)) * (dist < 0 ? -1 : 1);
    }
    if (d.toolMode) {
      // Rotate-style tools scale uniformly from the centre.
      const uniform = Math.max(Math.abs(sx), Math.abs(sy)) || 1;
      sx = uniform * Math.sign(sx || 1);
      sy = uniform * Math.sign(sy || 1);
    }
    if (e.shiftKey && !d.toolMode) {
      // constrain proportions on corner and edge handles
      const uniform = Math.max(Math.abs(sx), Math.abs(sy));
      if (east || west) sx = uniform * Math.sign(sx || 1);
      if (north || south) sy = uniform * Math.sign(sy || 1);
    }
    if (Math.abs(sx) < 0.004) sx = 0.004 * (sx < 0 ? -1 : 1);
    if (Math.abs(sy) < 0.004) sy = 0.004 * (sy < 0 ? -1 : 1);

    const m = scaleM(sx, sy, anchorX, anchorY);
    d.matrix = m;
    d.changed = true;
    this.applyMatrixToNodes(d, m);

    const nb = this.app.selectionBounds();
    if (nb) {
      const label = fromCenter ? `${fmt(nb.w)} × ${fmt(nb.h)} px` : `${fmt(nb.w)} × ${fmt(nb.h)} px`;
      this.showLivePreview(label, this.app.pointerScreen || { x: 0, y: 0 });
      this.app.setStatus(`W: ${fmt(nb.w)}  H: ${fmt(nb.h)}`);
    }
  }

  applyRotate(d, dp, e) {
    const c = d.center;
    let angle = ((Math.atan2(dp.y - c.y, dp.x - c.x) - d.startAngle) * 180) / Math.PI;
    if (e.shiftKey) angle = Math.round(angle / 15) * 15;
    const m = rotateM(angle, c.x, c.y);
    d.matrix = m;
    d.changed = Math.abs(angle) > 0.01;
    this.applyMatrixToNodes(d, m);
    this.app.setStatus(`Rotate ${fmt(angle, 1)}°`);
    this.showLivePreview(`${fmt(angle, 1)}°`, this.app.pointerScreen || { x: 0, y: 0 });
  }

  applyShear(d, dp, e) {
    const c = d.center;
    let sx = (dp.x - d.start.x) / Math.max(40, d.bounds.h);
    let sy = (dp.y - d.start.y) / Math.max(40, d.bounds.w);
    if (e.shiftKey) sy = 0;
    const m = shearM(sx, sy, c.x, c.y);
    d.matrix = m;
    d.changed = Math.abs(sx) > 0.0001 || Math.abs(sy) > 0.0001;
    this.applyMatrixToNodes(d, m);
    this.app.setStatus(`Shear ${fmt(sx * 100, 0)}%  ${fmt(sy * 100, 0)}%`);
  }

  applyMatrixToNodes(d, m) {
    const app = this.app;
    for (const node of app.selectionNodes()) {
      const original = d.nodes.find((n) => n.id === node.id);
      if (!original) continue;
      const copy = JSON.parse(JSON.stringify(original));
      applyMatrixToNode(node, copy, m);
    }
  }

  shapeBounds(d, dp, e) {
    const s = d.start;
    let x0 = Math.min(s.x, dp.x), y0 = Math.min(s.y, dp.y);
    let w = Math.abs(dp.x - s.x), h = Math.abs(dp.y - s.y);
    if (d.constrain || e.shiftKey) {
      const side = Math.max(w, h);
      w = side;
      h = side;
      if (dp.x < s.x) x0 = s.x - side;
      if (dp.y < s.y) y0 = s.y - side;
    }
    if (d.center || e.altKey) {
      x0 = s.x - w / 2;
      y0 = s.y - h / 2;
      w *= 1;
      h *= 1;
      x0 = s.x - w / 2;
    }
    if (d.kind === "line") {
      return { x: s.x, y: s.y, w: dp.x - s.x, h: dp.y - s.y };
    }
    return { x: x0, y: y0, w, h };
  }

  onPointerUp(e) {
    const app = this.app;
    const p = this.screenPoint(e);
    const dp = this.docPoint(e);
    this.viewport.classList.remove("is-panning");

    if (this.pen && this.pen.dragging && !this.drag) {
      this.pen.dragging = false;
      this.updatePenPreview(dp, null);
      app.requestOverlay();
      return;
    }

    const d = this.drag;
    if (!d) return;
    this.drag = null;
    app.isDragging = false;
    app.snapLines = [];
    app.marquee = null;
    this.hideLivePreview();

    switch (d.mode) {
      case "marquee":
      case "lasso":
        app.requestOverlay();
        break;
      case "move":
      case "anchors":
      case "handle":
      case "rotate":
      case "scale":
      case "shear":
        app.history.endGesture(d.changed);
        app.selectedAnchors = app.tool === "direct" ? (app.selectedAnchors || []) : [];
        app.refreshPanels();
        app.requestRender(true);
        break;
      case "shape":
        this.commitShape(d, e);
        break;
      case "artboard": {
        if (d.changed) {
          const b = d.bounds;
          const ab = { id: uid("ab"), name: `Artboard ${app.doc.artboards.length + 1}`, x: b.x, y: b.y, w: b.w, h: b.h };
          app.doc.artboards.push(ab);
          app.doc.activeArtboardId = ab.id;
          app.history.endGesture(true);
          app.toast(`Created ${ab.name} · ${fmt(b.w, 0)} × ${fmt(b.h, 0)} px`);
        } else {
          app.history.endGesture(false);
        }
        app.toolState.shapePreview = null;
        app.refreshPanels();
        app.requestRender(true);
        break;
      }
      case "measure":
        break;
      case "gradient":
        app.history.endGesture(d.changed);
        app.refreshPanels();
        break;
      case "freehand": {
        this.commitFreehand(d);
        break;
      }
      default:
        break;
    }
    this.updateCursor(p);
  }

  onDoubleClick(e) {
    const app = this.app;
    const dp = this.docPoint(e);
    const p = this.screenPoint(e);
    if (app.tool === "select" || app.tool === "direct") {
      const id = app.renderer.hitTest(dp);
      if (id) {
        const node = app.findNode(id);
        if (node?.type === "text") {
          app.beginTextEdit(node);
          return;
        }
        if (node?.type === "group") {
          app.setSelection([id]);
          app.setStatus("Group selected — use Object > Ungroup to edit contents");
        }
      } else if (app.tool === "select" && !app.selection.length) {
        // double-clicking empty pasteboard starts a new text block, like Illustrator
      }
    } else if (SHAPE_TOOLS.has(app.tool) && app.tool === "polygon") {
      const node = app.findNode(app.selection[0]);
      if (node?.polygon) node.polygon.sides = clamp(node.polygon.sides + 1, 3, 24);
    }
    if (app.tool === "type") {
      this.startType(e, dp, p);
    }
  }

  onWheel(e) {
    e.preventDefault();
    const app = this.app;
    const p = this.screenPoint(e);
    if (e.ctrlKey || e.metaKey) {
      const factor = Math.exp(-e.deltaY * 0.0022);
      app.view.zoomAt(factor, p);
      app.syncZoom();
    } else if (e.shiftKey) {
      app.view.tx -= e.deltaY || e.deltaX;
      app.view.ty -= e.deltaX ? 0 : 0;
      app.view.tx -= e.deltaX;
    } else {
      app.view.tx -= e.deltaX;
      app.view.ty -= e.deltaY;
    }
    app.requestRender(true);
  }

  /* ------------------------------------------------------------- selection */

  marqueeSelect(rect, d) {
    const app = this.app;
    const x0 = app.view.screenToDoc({ x: rect.x, y: rect.y });
    const x1 = app.view.screenToDoc({ x: rect.x + rect.w, y: rect.y + rect.h });
    const box = { x: Math.min(x0.x, x1.x), y: Math.min(x0.y, x1.y), w: Math.abs(x1.x - x0.x), h: Math.abs(x1.y - x0.y) };
    const hits = [];
    for (const layer of app.doc.layers) {
      if (!layer.visible || layer.locked) continue;
      collectSelectable(layer.children, hits);
    }
    const inside = hits.filter((n) => {
      const b = nodeBounds(n);
      return b.x >= box.x && b.y >= box.y && b.x + b.w <= box.x + box.w && b.y + b.h <= box.y + box.h;
    });
    const ids = inside.map((n) => n.id);
    const next = d.additive ? Array.from(new Set([...d.base, ...ids])) : ids;
    if (next.length !== app.selection.length || next.some((id) => !app.selection.includes(id))) {
      app.setSelection(next);
    }
  }

  lassoSelect(d, e) {
    const app = this.app;
    if (d.points.length < 3) return;
    const ring = d.points;
    const inPoly = (pt) => {
      let inside = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[i], b = ring[j];
        if ((a.y > pt.y) !== (b.y > pt.y) && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
      }
      return inside;
    };
    const hits = [];
    for (const layer of app.doc.layers) {
      if (!layer.visible || layer.locked) continue;
      collectSelectable(layer.children, hits);
    }
    const ids = hits.filter((n) => {
      const b = nodeBounds(n);
      return inPoly({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
    }).map((n) => n.id);
    const next = e.shiftKey ? Array.from(new Set([...app.selection, ...ids])) : ids;
    app.setSelection(next);
  }

  duplicateSelectionForDrag() {
    const app = this.app;
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
    if (copies.length) app.setSelection(copies);
  }

  /* ------------------------------------------------------------- snapping */

  computeSnap(bounds, dx, dy, d) {
    const app = this.app;
    const threshold = SNAP_HIT / app.view.zoom;
    const moving = new Set(app.selection);
    const xCandidates = [];
    const yCandidates = [];
    const ab = app.doc.artboards.find((a) => a.id === app.doc.activeArtboardId) || app.doc.artboards[0];
    for (const v of [ab.x, ab.x + ab.w / 2, ab.x + ab.w]) xCandidates.push(v);
    for (const v of [ab.y, ab.y + ab.h / 2, ab.y + ab.h]) yCandidates.push(v);
    for (const layer of app.doc.layers) {
      walkNodes(layer.children, (n) => {
        if (moving.has(n.id)) return;
        if (isDescendantOfSelection(app, n)) return;
        const b = nodeBounds(n);
        if (!b.w && !b.h) return;
        xCandidates.push(b.x, b.x + b.w / 2, b.x + b.w);
        yCandidates.push(b.y, b.y + b.h / 2, b.y + b.h);
      });
    }
    for (const g of app.doc.guides || []) {
      if (!g.visible) continue;
      if (g.axis === "h") yCandidates.push(g.pos);
      else xCandidates.push(g.pos);
    }
    const edgesX = [bounds.x + dx, bounds.x + bounds.w / 2 + dx, bounds.x + bounds.w + dx];
    const edgesY = [bounds.y + dy, bounds.y + bounds.h / 2 + dy, bounds.y + bounds.h + dy];
    let bestX = null, bestY = null;
    for (const cand of xCandidates) {
      for (const e of edgesX) {
        const diff = cand - e;
        if (Math.abs(diff) <= threshold && (!bestX || Math.abs(diff) < Math.abs(bestX.diff))) {
          bestX = { diff, pos: cand };
        }
      }
    }
    for (const cand of yCandidates) {
      for (const e of edgesY) {
        const diff = cand - e;
        if (Math.abs(diff) <= threshold && (!bestY || Math.abs(diff) < Math.abs(bestY.diff))) {
          bestY = { diff, pos: cand };
        }
      }
    }
    const lines = [];
    if (bestX) lines.push({ axis: "v", pos: bestX.pos });
    if (bestY) lines.push({ axis: "h", pos: bestY.pos });
    return { dx: bestX?.diff || 0, dy: bestY?.diff || 0, lines };
  }

  /* ------------------------------------------------------------- shapes */

  commitShape(d, e) {
    const app = this.app;
    app.toolState.shapePreview = null;
    const b = d.bounds || { x: d.start.x, y: d.start.y, w: 0, h: 0 };
    const w = b.w, h = b.h;
    if (Math.abs(w) < 1.5 && Math.abs(h) < 1.5) {
      // single click: default-sized shape at the click point, like Illustrator
      const size = 100;
      const id = app.tool;
      let node;
      if (id === "ellipse") node = createEllipse(d.start.x + size / 2, d.start.y + size / 2, size / 2, size / 2);
      else if (id === "polygon") node = createPolygon(d.start.x + size / 2, d.start.y + size / 2, size / 2, size / 2, this.polygonSides);
      else if (id === "star") node = createStar(d.start.x + size / 2, d.start.y + size / 2, size / 2, size / 2, this.starPoints, this.starInner);
      else if (id === "line") node = createLine(d.start.x, d.start.y, d.start.x + size, d.start.y);
      else if (id === "spiral") node = createPath(spiralSubpaths(d.start.x, d.start.y, size / 2), { name: "Spiral", fill: null, stroke: { ...(app.newStroke()) } });
      else if (id === "arc") node = createPath(arcSubpaths(d.start.x, d.start.y, d.start.x + size, d.start.y + size / 3), { name: "Arc", fill: null, stroke: { ...app.newStroke() } });
      else node = createRect(d.start.x, d.start.y, size, size, { rx: id === "roundrect" ? 12 : 0 });
      app.history.record();
      this.styleNewNode(node);
      app.addNode(node);
      app.requestRender(true);
      return;
    }

    app.history.beginGesture();
    let node;
    switch (d.kind) {
      case "ellipse":
        node = createEllipse(b.x + w / 2, b.y + h / 2, Math.abs(w) / 2, Math.abs(h) / 2);
        break;
      case "polygon":
        node = createPolygon(b.x + w / 2, b.y + h / 2, Math.abs(w) / 2, Math.abs(h) / 2, this.polygonSides);
        break;
      case "star":
        node = createStar(b.x + w / 2, b.y + h / 2, Math.abs(w) / 2, Math.abs(h) / 2, this.starPoints, this.starInner);
        break;
      case "line":
        node = createLine(d.start.x, d.start.y, d.start.x + w, d.start.y + h);
        break;
      case "arc":
        node = createPath(arcSubpaths(d.start.x, d.start.y, d.start.x + w, d.start.y + h), { name: "Arc", fill: null });
        node.stroke = { ...app.newStroke() };
        break;
      case "spiral":
        node = createPath(spiralSubpaths(b.x + w / 2, b.y + h / 2, Math.min(Math.abs(w), Math.abs(h)) / 2), { name: "Spiral", fill: null });
        node.stroke = { ...app.newStroke() };
        break;
      case "grid": {
        node = createPath(buildGridSubpaths(b, 4, 4), { name: "Rectangular Grid", fill: null });
        node.stroke = { ...app.newStroke(), width: 0.75 };
        break;
      }
      case "roundrect":
        node = createRect(b.x, b.y, Math.abs(w), Math.abs(h), { rx: this.cornerRadius || Math.min(Math.abs(w), Math.abs(h)) * 0.12 });
        break;
      default:
        node = createRect(b.x, b.y, Math.abs(w), Math.abs(h));
        break;
    }
    if (node.kind !== "line" && node.kind !== "arc" && node.kind !== "spiral" && node.kind !== "grid") {
      this.styleNewNode(node);
    }
    app.addNode(node);
    app.history.endGesture(true);
    app.setSelection([node.id]);
    app.requestRender(true);
  }

  styleNewNode(node) {
    const app = this.app;
    const fill = app.target === "fill" ? app.fill : null;
    const stroke = app.target === "stroke" ? app.stroke : app.stroke?.enabled ? app.stroke : null;
    node.fill = fill ? (fill.type === "gradient" ? JSON.parse(JSON.stringify(fill)) : { ...fill }) : null;
    node.stroke = stroke ? { ...stroke } : null;
    if (app.target === "stroke" && app.stroke?.enabled) {
      node.stroke = { ...app.stroke };
      node.fill = fill ? { ...fill } : null;
    }
  }

  /* ------------------------------------------------------------- pen */

  finishPen(close) {
    const app = this.app;
    const pen = this.pen;
    this.pen = null;
    app.toolState.penPreview = null;
    if (!pen || pen.nodes.length < 2) {
      app.requestOverlay();
      return;
    }
    const node = createPath([{ nodes: pen.nodes.map(n => ({ ...n })), closed: close }], { name: "Path" });
    this.styleNewNode(node);
    if (!node.fill) node.fill = null;
    if (!node.stroke) node.stroke = { ...app.newStroke(), width: 1.5 };
    app.history.record();
    app.addNode(node);
    app.setSelection([node.id]);
    app.requestRender(true);
  }

  /** Called by the app when Escape / Enter ends the pen path. */
  commitActivePen(close = false) {
    if (this.pen) this.finishPen(close);
  }

  /* ------------------------------------------------------------- freehand */

  startFreehand(e, dp, p) {
    const app = this.app;
    this.drag = {
      mode: "freehand",
      kind: app.tool,
      points: [dp],
      changed: false,
      strokeWidth: app.tool === "brush" ? Math.max(2, app.stroke?.width || 4) : 1,
    };
    app.history.beginGesture();
    app.requestOverlay();
  }

  updateFreehandPreview(d) {
    const app = this.app;
    const pts = d.points;
    const sub = smoothToSubpaths(pts, false, 1.2 / app.view.zoom);
    d.previewSubpaths = sub;
    app.toolState.freehandPreview = sub;
    app.requestOverlay();
  }

  commitFreehand(d) {
    const app = this.app;
    app.toolState.freehandPreview = null;
    if (d.points.length < 2) return;
    const pts = d.points.filter((p, i) => i === 0 || Math.hypot(p.x - d.points[i - 1].x, p.y - d.points[i - 1].y) > 0.4);
    if (pts.length < 2) return;
    const sub = smoothToSubpaths(pts, false, 1.6 / app.view.zoom);
    const node = createPath(sub, { name: d.kind === "brush" ? "Brush Stroke" : "Pencil Path", fill: null });
    node.stroke = { ...app.newStroke(), width: d.kind === "brush" ? Math.max(1, app.stroke?.width || 4) : Math.max(1, app.stroke?.width || 1.5), cap: "round", join: "round" };
    app.addNode(node);
    app.history.endGesture(true);
    app.setSelection([node.id]);
    app.requestRender(true);
  }

  /* ------------------------------------------------------------- type */

  async startType(e, dp, p) {
    const app = this.app;
    const existing = app.renderer.hitTest(dp);
    if (existing) {
      const node = app.findNode(existing);
      if (node?.type === "text") {
        app.beginTextEdit(node);
        return;
      }
    }
    app.history.record();
    const node = createText(dp.x, dp.y, "", {
      fill: app.fill?.type === "solid" ? { ...app.fill } : { type: "solid", color: "#111111" },
    });
    node.fontSize = app.typeSize || 36;
    node.text = "";
    app.addNode(node);
    app.setSelection([node.id]);
    app.requestRender(true);
    await nextFrame();
    app.beginTextEdit(node, true);
  }

  /* ------------------------------------------------------------- misc tools */

  pickStyle(dp, e) {
    const app = this.app;
    const id = app.renderer.hitTest(dp);
    if (!id) {
      app.setStatus("Eyedropper: no artwork under cursor");
      return;
    }
    const source = app.findNode(id);
    const targets = app.selectionNodes().length ? app.selectionNodes() : [];
    if (!targets.length) {
      app.fill = source.fill ? JSON.parse(JSON.stringify(source.fill)) : null;
      app.stroke = source.stroke ? { ...source.stroke } : { enabled: false, width: 1 };
      app.toast("Picked appearance — click artwork to apply");
      app.syncFillStroke();
      app.refreshPanels();
      return;
    }
    app.history.record();
    for (const t of targets) {
      if (t.type === "group") continue;
      t.fill = source.fill ? JSON.parse(JSON.stringify(source.fill)) : null;
      t.stroke = source.stroke ? { ...source.stroke } : null;
      if (t.type === "text") {
        t.fontFamily = source.fontFamily || t.fontFamily;
        t.fontSize = source.fontSize || t.fontSize;
        t.fontWeight = source.fontWeight || t.fontWeight;
      }
    }
    app.requestRender(true);
    app.refreshPanels();
    app.toast("Appearance applied");
  }

  runShapeBuilder(e, dp) {
    const app = this.app;
    if (app.selection.length < 2) {
      app.toast("Shape Builder: select two or more overlapping shapes");
      return;
    }
    app.history.record();
    const docAtStart = app.doc;
    import("./pathops.js").then(async ({ pathfinder, ringsToPath }) => {
      if (app.doc !== docAtStart) return;
      const nodes = app.selectionNodes().filter((n) => n.type === "path");
      if (!nodes.length) return;
      const rings = pathfinder("unite", nodes.map((n) => n.subpaths));
      const first = nodes[0];
      const subpaths = ringsToPath(rings);
      const united = createPath(subpaths, {
        name: "Merged Shape",
        fill: first.fill ? JSON.parse(JSON.stringify(first.fill)) : null,
        stroke: first.stroke ? { ...first.stroke } : null,
      });
      const parent = findNode(app.doc, first.id)?.parent;
      const list = parent ? parent.children : app.doc.layers;
      const idx = list.findIndex((n) => n.id === first.id);
      for (const n of nodes) {
        const p = findNode(app.doc, n.id);
        if (!p) continue;
        const l = p.parent ? p.parent.children : app.doc.layers;
        const i = l.findIndex((c) => c.id === n.id);
        if (i >= 0) l.splice(i, 1);
      }
      list.splice(Math.max(0, idx), 0, united);
      app.setSelection([united.id]);
      app.requestRender(true);
      app.refreshPanels();
      app.toast("Shapes merged");
    });
  }

  /* ------------------------------------------------------------- anchors */

  deleteSelectedAnchors() {
    const app = this.app;
    const anchors = app.selectedAnchors || [];
    if (!anchors.length) return false;
    app.history.record();
    const byNode = new Map();
    for (const a of anchors) {
      if (!byNode.has(a.nodeId)) byNode.set(a.nodeId, []);
      byNode.get(a.nodeId).push(a);
    }
    for (const [nodeId, list] of byNode) {
      const node = app.findNode(nodeId);
      if (!node || node.type !== "path") continue;
      for (const a of list) {
        const sp = node.subpaths[a.si];
        if (!sp) continue;
        sp.nodes.splice(a.ni, 1);
      }
      node.subpaths = node.subpaths.filter((sp) => sp.nodes.length > 1);
      if (!node.subpaths.length) {
        const hit = findNode(app.doc, nodeId);
        if (hit) {
          const parentList = hit.parent ? hit.parent.children : app.doc.layers;
          const i = parentList.findIndex((n) => n.id === nodeId);
          if (i >= 0) parentList.splice(i, 1);
          app.setSelection([]);
        }
      }
    }
    app.selectedAnchors = [];
    app.requestRender(true);
    app.refreshPanels();
    return true;
  }
}

/* ------------------------------------------------------------------ utils */

export function replaceNodeGeometry(node, source) {
  node.subpaths = JSON.parse(JSON.stringify(source.subpaths));
  for (const key of ["rect", "ellipse", "polygon", "star"]) {
    if (source[key]) node[key] = { ...source[key] };
    else delete node[key];
  }
  if (source.type === "text") {
    node.x = source.x;
    node.y = source.y;
  }
}

export function applyMatrixToNode(node, source, m) {
  // reset the live node from its gesture-time snapshot, then transform
  replaceNodeGeometry(node, source);
  if (node.type === "text") {
    const p = applyM(m, { x: source.x, y: source.y });
    node.x = p.x;
    node.y = p.y;
    const scale = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c));
    if (Math.abs(scale - 1) > 0.01) {
      node.fontSize = Math.max(2, source.fontSize * scale);
    }
    return;
  }
  node.subpaths = transformSubpaths(node.subpaths, m);
  const axisAligned = Math.abs(m.b) < 1e-9 && Math.abs(m.c) < 1e-9;
  if (axisAligned && (source.rect || source.ellipse || source.polygon || source.star)) {
    if (source.rect) {
      const p = applyM(m, { x: source.rect.x, y: source.rect.y });
      node.rect = { ...source.rect, x: p.x, y: p.y, w: source.rect.w * gauss(m.a), h: source.rect.h * gauss(m.d) };
      refreshPrimitive(node);
    } else if (source.ellipse) {
      const p = applyM(m, { x: source.ellipse.cx, y: source.ellipse.cy });
      node.ellipse = { ...source.ellipse, cx: p.x, cy: p.y, rx: Math.abs(source.ellipse.rx * m.a), ry: Math.abs(source.ellipse.ry * m.d) };
      refreshPrimitive(node);
    } else if (source.polygon) {
      const p = applyM(m, { x: source.polygon.cx, y: source.polygon.cy });
      node.polygon = { ...source.polygon, cx: p.x, cy: p.y, rx: Math.abs(source.polygon.rx * m.a), ry: Math.abs(source.polygon.ry * m.d) };
      refreshPrimitive(node);
    } else if (source.star) {
      const p = applyM(m, { x: source.star.cx, y: source.star.cy });
      node.star = { ...source.star, cx: p.x, cy: p.y, rx: Math.abs(source.star.rx * m.a), ry: Math.abs(source.star.ry * m.d) };
      refreshPrimitive(node);
    }
  } else {
    delete node.rect;
    delete node.ellipse;
    delete node.polygon;
    delete node.star;
    node.kind = "path";
  }
}

const gauss = (v) => (Math.abs(v) < 1e-9 ? 1 : v);

export function reidNode(node) {
  node.id = uid(node.type === "text" ? "t" : node.type === "group" ? "gr" : "p");
  if (node.children) node.children.forEach(reidNode);
}

export function collectSelectable(nodes, out) {
  for (const n of nodes) {
    if (n.visible === false || n.locked) continue;
    out.push(n);
  }
  return out;
}

export function walkNodes(nodes, fn) {
  for (const n of nodes) {
    fn(n);
    if (n.children) walkNodes(n.children, fn);
  }
}

function isDescendantOfSelection(app, node) {
  for (const id of app.selection) {
    const hit = findNode(app.doc, id);
    if (!hit) continue;
    let found = false;
    walkNodes([hit.node], (n) => { if (n === node) found = true; });
    if (found) return true;
  }
  return false;
}

/** Catmull-Rom → cubic Bézier smoothing for pencil/brush strokes. */
export function smoothToSubpaths(points, closed = false, tolerance = 1.5) {
  if (points.length < 2) return [];
  const simplified = tolerance > 0 ? simplifyRing(points, tolerance) : points;
  if (simplified.length < 2) return [];
  const nodes = simplified.map((p) => makeNode(p.x, p.y));
  for (let i = 0; i < nodes.length; i++) {
    const prev = nodes[i - 1] || (closed ? nodes[nodes.length - 1] : nodes[i]);
    const next = nodes[i + 1] || (closed ? nodes[0] : nodes[i]);
    const dx = (next.x - prev.x) / 6;
    const dy = (next.y - prev.y) / 6;
    nodes[i].ox = nodes[i].x + dx;
    nodes[i].oy = nodes[i].y + dy;
    nodes[i].ix = nodes[i].x - dx;
    nodes[i].iy = nodes[i].y - dy;
  }
  if (closed && nodes.length === 2) {
    return [{ nodes, closed: false }];
  }
  return [{ nodes, closed }];
}

function buildGridSubpaths(b, cols, rows) {
  const subpaths = [];
  for (let i = 0; i <= cols; i++) {
    const x = b.x + (b.w / cols) * i;
    subpaths.push({ nodes: [makeNode(x, b.y), makeNode(x, b.y + b.h)], closed: false });
  }
  for (let j = 0; j <= rows; j++) {
    const y = b.y + (b.h / rows) * j;
    subpaths.push({ nodes: [makeNode(b.x, y), makeNode(b.x + b.w, y)], closed: false });
  }
  return subpaths;
}
