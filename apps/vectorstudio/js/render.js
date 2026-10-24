/**
 * Canvas renderer: document painting, artboards, rulers, selection chrome,
 * Bézier handles, smart guides and live tool previews.
 *
 * Two stacked canvases are used, exactly like a professional editor:
 *   scene   – artwork, repainted only when the document or view changes
 *   overlay – UI chrome, repainted on hover/selection/drag
 */

import {
  subpathsToPath2D, subpathsBounds, transformSubpaths, applyM,
  unionBounds, boundsCenter,
} from "./geom.js";
import { nodeSubpaths, nodeBounds, textMetrics, fontString, textLines, activeArtboard } from "./doc.js";
import { withAlpha, clamp, hexToRgb } from "./util.js";

export class View {
  constructor() {
    this.zoom = 1;
    this.tx = 80;
    this.ty = 60;
    this.screenWidth = 800;
    this.screenHeight = 600;
  }

  docToScreen(p) {
    return { x: p.x * this.zoom + this.tx, y: p.y * this.zoom + this.ty };
  }

  screenToDoc(p) {
    return { x: (p.x - this.tx) / this.zoom, y: (p.y - this.ty) / this.zoom };
  }

  rectDocToScreen(r) {
    return { x: r.x * this.zoom + this.tx, y: r.y * this.zoom + this.ty, w: r.w * this.zoom, h: r.h * this.zoom };
  }

  zoomAt(factor, screenPoint) {
    const before = this.screenToDoc(screenPoint);
    this.zoom = clamp(this.zoom * factor, 0.02, 64);
    this.tx = screenPoint.x - before.x * this.zoom;
    this.ty = screenPoint.y - before.y * this.zoom;
  }

  fit(rect, padding = 52) {
    const w = Math.max(1, this.screenWidth - padding * 2);
    const h = Math.max(1, this.screenHeight - padding * 2);
    const z = Math.min(w / Math.max(1, rect.w), h / Math.max(1, rect.h));
    this.zoom = clamp(z, 0.02, 16);
    this.tx = (this.screenWidth - rect.w * this.zoom) / 2 - rect.x * this.zoom;
    this.ty = (this.screenHeight - rect.h * this.zoom) / 2 - rect.y * this.zoom;
  }

  centerOn(p) {
    this.tx = this.screenWidth / 2 - p.x * this.zoom;
    this.ty = this.screenHeight / 2 - p.y * this.zoom;
  }
}

const HANDLE = 6;
const ANCHOR = 5.5;

export class Renderer {
  constructor(app) {
    this.app = app;
    this.scene = document.getElementById("scene");
    this.overlay = document.getElementById("overlay");
    this.sctx = this.scene.getContext("2d");
    this.octx = this.overlay.getContext("2d");
    this.rulerH = document.getElementById("ruler-h");
    this.rulerV = document.getElementById("ruler-v");
    this.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this.hitCanvas = document.createElement("canvas");
    this.hctx = this.hitCanvas.getContext("2d", { willReadFrequently: false });
    this.dirty = true;
    this.dirtyOverlay = true;
    this.frame = null;
    window.addEventListener("resize", () => this.resize());
    this.resize();
  }

  resize() {
    const viewport = document.getElementById("viewport");
    const w = Math.max(1, viewport.clientWidth);
    const h = Math.max(1, viewport.clientHeight);
    const app = this.app;
    if (app?.view) {
      const centerDoc = app.view.screenToDoc({ x: app.view.screenWidth / 2, y: app.view.screenHeight / 2 });
      app.view.screenWidth = w;
      app.view.screenHeight = h;
      if (app.view.zoom) {
        app.view.tx = w / 2 - centerDoc.x * app.view.zoom;
        app.view.ty = h / 2 - centerDoc.y * app.view.zoom;
      }
    }
    for (const c of [this.scene, this.overlay]) {
      c.width = Math.round(w * this.dpr);
      c.height = Math.round(h * this.dpr);
      c.style.width = `${w}px`;
      c.style.height = `${h}px`;
    }
    const rulerH = this.rulerH;
    const rulerV = this.rulerV;
    if (rulerH && rulerV) {
      rulerH.width = Math.round(w * this.dpr);
      rulerH.height = Math.round(20 * this.dpr);
      rulerH.style.width = `${w}px`;
      rulerH.style.height = "20px";
      rulerV.width = Math.round(20 * this.dpr);
      rulerV.height = Math.round(h * this.dpr);
      rulerV.style.width = "20px";
      rulerV.style.height = `${h}px`;
    }
    this.requestRender(true);
  }

  requestRender(both = false) {
    if (both) this.dirtyOverlay = true;
    this.dirty = true;
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      this.paint();
    });
  }

  requestOverlay() {
    this.dirtyOverlay = true;
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      this.paint();
    });
  }

  paint() {
    if (this.dirty) {
      this.paintScene();
      this.dirty = false;
      this.dirtyOverlay = true;
    }
    if (this.dirtyOverlay) {
      this.paintOverlay();
      this.paintRulers();
      this.dirtyOverlay = false;
    }
  }

  /* ------------------------------------------------------------- scene */

  paintScene() {
    const app = this.app;
    const ctx = this.sctx;
    const { view, doc } = app;
    const w = view.screenWidth;
    const h = view.screenHeight;
    const dpr = this.dpr;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const styles = getComputedStyle(document.documentElement);
    ctx.fillStyle = styles.getPropertyValue("--pasteboard").trim() || "#2b2b2b";
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.setTransform(dpr * view.zoom, 0, 0, dpr * view.zoom, dpr * view.tx, dpr * view.ty);

    // artboards
    for (const ab of doc.artboards) {
      this.paintArtboard(ctx, app, ab, ab.id === doc.activeArtboardId);
    }

    // grid inside the active artboard
    if (app.showGrid) this.paintGrid(ctx, app);

    // artwork
    for (const layer of doc.layers) {
      if (!layer.visible) continue;
      this.paintNodes(ctx, app, layer.children, 1);
    }

    // guides
    if (app.showGuides) this.paintGuides(ctx, app);

    ctx.restore();

    // artboard labels (screen space, above each artboard)
    for (const ab of doc.artboards) {
      const p = view.docToScreen({ x: ab.x, y: ab.y });
      ctx.save();
      ctx.font = `500 10px ${styles.getPropertyValue("--font-ui") || "sans-serif"}`.trim();
      ctx.fillStyle = ab.id === doc.activeArtboardId ? "#c9c9c9" : "#8b8b8b";
      ctx.textBaseline = "bottom";
      ctx.fillText(ab.name, Math.round(p.x) + 1, Math.round(p.y) - 5);
      ctx.restore();
    }
  }

  paintArtboard(ctx, app, ab, active) {
    const styles = getComputedStyle(document.documentElement);
    ctx.save();
    // soft drop shadow so the page separates from the pasteboard
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.fillRect(ab.x + 3, ab.y + 4, ab.w, ab.h);
    ctx.fillStyle = styles.getPropertyValue("--artboard").trim() || "#fff";
    ctx.fillRect(ab.x, ab.y, ab.w, ab.h);
    ctx.strokeStyle = active ? "#3d3d3d" : "rgba(0,0,0,0.35)";
    ctx.lineWidth = 1 / app.view.zoom;
    ctx.strokeRect(ab.x + 0.5 / app.view.zoom, ab.y + 0.5 / app.view.zoom, ab.w, ab.h);
    ctx.restore();
  }

  paintGrid(ctx, app) {
    const ab = activeArtboard(app.doc);
    const step = app.gridSize || 20;
    const z = app.view.zoom;
    if (step * z < 6) return;
    ctx.save();
    ctx.strokeStyle = "rgba(0,0,0,0.08)";
    ctx.lineWidth = 1 / z;
    ctx.beginPath();
    for (let x = ab.x; x <= ab.x + ab.w + 0.001; x += step) {
      const p = Math.round(x) + 0.5 / z;
      ctx.moveTo(p, ab.y);
      ctx.lineTo(p, ab.y + ab.h);
    }
    for (let y = ab.y; y <= ab.y + ab.h + 0.001; y += step) {
      const p = Math.round(y) + 0.5 / z;
      ctx.moveTo(ab.x, p);
      ctx.lineTo(ab.x + ab.w, p);
    }
    ctx.stroke();
    ctx.restore();
  }

  paintGuides(ctx, app) {
    const z = app.view.zoom;
    ctx.save();
    ctx.strokeStyle = "#23c4d6";
    ctx.lineWidth = 1 / z;
    ctx.setLineDash([]);
    ctx.beginPath();
    for (const g of app.doc.guides || []) {
      if (!g.visible) continue;
      if (g.axis === "h") { ctx.moveTo(g.x0 ?? -4000, g.pos); ctx.lineTo(g.x1 ?? 4000, g.pos); }
      else { ctx.moveTo(g.pos, g.y0 ?? -4000); ctx.lineTo(g.pos, g.y1 ?? 4000); }
    }
    ctx.stroke();
    ctx.restore();
  }

  paintNodes(ctx, app, nodes, parentOpacity) {
    if (!Array.isArray(nodes)) {
      console.warn("paintNodes received non-array", nodes, new Error().stack);
      return;
    }
    for (const node of nodes) {
      if (node.visible === false) continue;
      if (node.id === app.editingTextId) continue;
      const alpha = parentOpacity * (node.opacity ?? 1);
      if (node.type === "group") {
        this.paintNodes(ctx, app, node.children, alpha);
        continue;
      }
      ctx.save();
      ctx.globalAlpha = alpha;
      if (node.blendMode && node.blendMode !== "source-over" && node.blendMode !== "normal") {
        ctx.globalCompositeOperation = node.blendMode;
      }
      if (node.type === "text") {
        if (app.outlineMode) {
          const b = nodeBounds(node);
          ctx.save();
          ctx.strokeStyle = "rgba(0,0,0,0.85)";
          ctx.lineWidth = 1 / app.view.zoom;
          ctx.strokeRect(b.x, b.y, b.w, b.h);
          ctx.restore();
        } else {
          this.paintText(ctx, node);
        }
      } else {
        this.paintShape(ctx, node);
      }
      ctx.restore();
    }
  }

  fillForNode(ctx, node) {
    const fill = node.fill;
    if (!fill) return null;
    if (fill.type === "solid") return fill.color;
    const b = nodeBounds(node);
    const angle = ((fill.angle ?? 90) * Math.PI) / 180;
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    const len = Math.max(1, Math.abs(b.w * Math.cos(angle)) + Math.abs(b.h * Math.sin(angle))) / 2;
    const grad = fill.type === "radial"
      ? ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(b.w, b.h) / 2 || 1)
      : ctx.createLinearGradient(cx - Math.cos(angle) * len, cy - Math.sin(angle) * len, cx + Math.cos(angle) * len, cy + Math.sin(angle) * len);
    for (const stop of fill.stops || []) grad.addColorStop(clamp(stop.offset, 0, 1), stop.color);
    if (!(fill.stops || []).length) grad.addColorStop(0, "#fff"), grad.addColorStop(1, "#000");
    return grad;
  }

  applyStroke(ctx, stroke, zoom) {
    if (!stroke || !stroke.width) return;
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = Math.max(stroke.width, 0.35 / zoom * 0);
    ctx.lineCap = stroke.cap === "round" ? "round" : stroke.cap === "square" ? "square" : "butt";
    ctx.lineJoin = stroke.join === "round" ? "round" : stroke.join === "bevel" ? "bevel" : "miter";
    ctx.miterLimit = 10;
    if (stroke.dash && stroke.dash.length) {
      ctx.setLineDash(stroke.dash);
    } else {
      ctx.setLineDash([]);
    }
    if (stroke.opacity != null) ctx.globalAlpha *= stroke.opacity;
  }

  paintShape(ctx, node) {
    const sp = node.subpaths;
    if (!sp || !sp.length) return;
    const p2d = subpathsToPath2D(sp);
    if (this.app.outlineMode) {
      ctx.save();
      ctx.strokeStyle = "rgba(0,0,0,0.85)";
      ctx.lineWidth = 1 / this.app.view.zoom;
      ctx.stroke(p2d);
      ctx.restore();
      return;
    }
    const shadow = node.effect?.shadow;
    if (shadow) {
      ctx.save();
      ctx.shadowColor = `rgba(${hexToRgb(shadow.color || "#000000").r}, ${hexToRgb(shadow.color || "#000000").g}, ${hexToRgb(shadow.color || "#000000").b}, ${shadow.opacity ?? 0.45})`;
      ctx.shadowBlur = (shadow.blur || 0) * this.app.view.zoom;
      ctx.shadowOffsetX = (shadow.x || 0) * this.app.view.zoom;
      ctx.shadowOffsetY = (shadow.y || 0) * this.app.view.zoom;
      ctx.fillStyle = "#000";
      ctx.fill(p2d, "nonzero");
      ctx.restore();
    }
    const fill = this.fillForNode(ctx, node);
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill(p2d, "nonzero");
    }
    if (node.stroke && node.stroke.width > 0) {
      this.applyStroke(ctx, node.stroke, this.app.view.zoom);
      ctx.stroke(p2d);
    }
  }

  paintText(ctx, node) {
    const m = textMetrics(node);
    const fill = this.fillForNode(ctx, node);
    ctx.font = fontString(node);
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    if (fill) ctx.fillStyle = fill;
    if (node.stroke && node.stroke.width) this.applyStroke(ctx, node.stroke, this.app.view.zoom);
    const tracking = node.letterSpacing || 0;
    m.lines.forEach((line, i) => {
      const lw = ctx.measureText(line).width + Math.max(0, line.length - 1) * tracking;
      let x = node.x;
      if (node.align === "center") x -= lw / 2;
      else if (node.align === "right") x -= lw;
      const y = node.y + i * m.lineHeight;
      if (tracking !== 0) {
        let cx = x;
        for (const ch of line) {
          if (fill) ctx.fillText(ch, cx, y);
          if (node.stroke && node.stroke.width) ctx.strokeText(ch, cx, y);
          cx += ctx.measureText(ch).width + tracking;
        }
      } else {
        if (fill) ctx.fillText(line, x, y);
        if (node.stroke && node.stroke.width) ctx.strokeText(line, x, y);
      }
    });
  }

  /* ------------------------------------------------------------- overlay */

  sc(p) { return this.app.view.docToScreen(p); }

  paintOverlay() {
    const app = this.app;
    const ctx = this.octx;
    const w = app.view.screenWidth;
    const h = app.view.screenHeight;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // hover outline for non-selected objects
    if (app.hoverId && !app.selection.includes(app.hoverId) && !app.isDragging) {
      const node = app.findNode(app.hoverId);
      if (node) {
        ctx.save();
        ctx.strokeStyle = "rgba(45,140,235,0.85)";
        ctx.lineWidth = 1;
        this.strokeNodeOutline(ctx, node);
        ctx.restore();
      }
    }

    if (app.showEdges) this.paintSelectionOverlay(ctx, app);
    if (app.toolState?.penPreview) this.paintPenPreview(ctx, app);
    if (app.marquee) this.paintMarquee(ctx, app.marquee);
    if (app.toolState?.guideDrag) this.paintGuideDrag(ctx, app);
    if (app.toolState?.measure) this.paintMeasure(ctx, app.toolState.measure);
    if (app.snapLines?.length) this.paintSnapLines(ctx, app);
    if (app.toolState?.shapePreview) this.paintShapePreview(ctx, app, app.toolState.shapePreview);
    if (app.toolState?.freehandPreview) this.paintFreehandPreview(ctx, app);
  }

  strokeNodeOutline(ctx, node) {
    const view = this.app.view;
    if (node.type === "text") {
      const b = nodeBounds(node);
      const r = view.rectDocToScreen(b);
      ctx.strokeRect(Math.round(r.x) + 0.5, Math.round(r.y) + 0.5, Math.round(r.w), Math.round(r.h));
      return;
    }
    if (node.type === "group") {
      node.children.forEach((c) => this.strokeNodeOutline(ctx, c));
      return;
    }
    ctx.save();
    ctx.setTransform(this.dpr * view.zoom, 0, 0, this.dpr * view.zoom, this.dpr * view.tx, this.dpr * view.ty);
    const p2d = subpathsToPath2D(node.subpaths);
    ctx.lineWidth = 1 / view.zoom;
    ctx.stroke(p2d);
    ctx.restore();
  }

  paintSelectionOverlay(ctx, app) {
    const view = app.view;
    const sel = app.selection;
    if (!sel.length) return;
    const bounds = app.selectionBounds();
    const isDirect = app.tool === "direct" || app.tool === "addAnchor";
    const isText = sel.length === 1 && app.findNode(sel[0])?.type === "text";

    // outline in screen space for crisp 1px lines
    ctx.save();
    ctx.strokeStyle = "#2d8ceb";
    ctx.lineWidth = 1;
    for (const id of sel) {
      const node = app.findNode(id);
      if (!node) continue;
      if (node.type === "text" || node.type === "group") {
        const b = nodeBounds(node);
        const r = view.rectDocToScreen(b);
        ctx.strokeRect(Math.round(r.x) + 0.5, Math.round(r.y) + 0.5, Math.round(r.w), Math.round(r.h));
      } else {
        this.strokeNodeOutline(ctx, node);
      }
    }
    ctx.restore();

    if (isDirect) {
      this.paintAnchors(ctx, app);
      return;
    }

    if (!bounds) return;
    const r = view.rectDocToScreen(bounds);
    ctx.save();
    ctx.strokeStyle = "#2d8ceb";
    ctx.lineWidth = 1;
    if (!isText) {
      ctx.strokeRect(Math.round(r.x) + 0.5, Math.round(r.y) + 0.5, Math.round(r.w), Math.round(r.h));
    }
    if (!app.isDragging) {
      const pts = [
        [r.x, r.y], [r.x + r.w / 2, r.y], [r.x + r.w, r.y],
        [r.x + r.w, r.y + r.h / 2], [r.x + r.w, r.y + r.h],
        [r.x + r.w / 2, r.y + r.h], [r.x, r.y + r.h], [r.x, r.y + r.h / 2],
      ];
      for (const [x, y] of pts) {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(Math.round(x) - HANDLE / 2, Math.round(y) - HANDLE / 2, HANDLE, HANDLE);
        ctx.strokeStyle = "#2d8ceb";
        ctx.strokeRect(Math.round(x) - HANDLE / 2 + 0.5, Math.round(y) - HANDLE / 2 + 0.5, HANDLE - 1, HANDLE - 1);
      }
    }
    ctx.restore();

    // small origin marker like Illustrator's reference point
    if (app.showSmartGuides && app.hoverAnchorLabel) {
      this.drawLabel(ctx, app.hoverAnchorLabel, { x: r.x + r.w / 2, y: r.y - 10 });
    }
  }

  paintAnchors(ctx, app) {
    const view = app.view;
    const nodes = app.selectionNodes();
    const selectedAnchors = app.selectedAnchors || [];
    ctx.save();
    let idx = 0;
    for (const node of nodes) {
      if (node.type !== "path") continue;
      const subpaths = node.subpaths;
      subpaths.forEach((sp, si) => {
        sp.nodes.forEach((n, ni) => {
          const isSel = selectedAnchors.some((a) => a.nodeId === node.id && a.si === si && a.ni === ni);
          const p = view.docToScreen(n);
          if (isSel) {
            // handles
            for (const [hx, hy] of [[n.ix, n.iy], [n.ox, n.oy]]) {
              const hp = view.docToScreen({ x: hx, y: hy });
              if (Math.hypot(hp.x - p.x, hp.y - p.y) > 0.5) {
                ctx.strokeStyle = "#2d8ceb";
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(p.x, p.y);
                ctx.lineTo(hp.x, hp.y);
                ctx.stroke();
                ctx.beginPath();
                ctx.fillStyle = "#2d8ceb";
                ctx.arc(hp.x, hp.y, 2.8, 0, Math.PI * 2);
                ctx.fill();
              }
            }
          }
          const size = isSel ? ANCHOR : ANCHOR - 1.2;
          ctx.fillStyle = isSel ? "#2d8ceb" : "#ffffff";
          ctx.strokeStyle = "#2d8ceb";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.rect(Math.round(p.x) - size / 2 + 0.5, Math.round(p.y) - size / 2 + 0.5, size, size);
          ctx.fill();
          ctx.stroke();
          idx++;
        });
      });
    }
    ctx.restore();
  }

  paintPenPreview(ctx, app) {
    const pen = app.toolState.penPreview;
    const view = app.view;
    if (!pen) return;
    ctx.save();
    ctx.strokeStyle = "#2d8ceb";
    ctx.lineWidth = 1;
    if (pen.from) {
      const a = view.docToScreen(pen.from);
      const b = view.docToScreen(pen.to);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      if (pen.out && pen.in) {
        const c1 = view.docToScreen(pen.out);
        const c2 = view.docToScreen(pen.in);
        ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, b.x, b.y);
      } else {
        ctx.lineTo(b.x, b.y);
      }
      ctx.setLineDash([3, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
      // rubber-band handles
      if (pen.showHandles) {
        const h1 = view.docToScreen(pen.h1);
        const h2 = view.docToScreen(pen.h2);
        const a2 = view.docToScreen(pen.anchor);
        ctx.strokeStyle = "rgba(45,140,235,0.8)";
        ctx.beginPath();
        ctx.moveTo(h1.x, h1.y);
        ctx.lineTo(a2.x, a2.y);
        ctx.lineTo(h2.x, h2.y);
        ctx.stroke();
        for (const hp of [h1, h2]) {
          ctx.beginPath();
          ctx.fillStyle = "#2d8ceb";
          ctx.arc(hp.x, hp.y, 2.6, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    if (pen.cursor) {
      const p = view.docToScreen(pen.cursor);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.4, 0, Math.PI * 2);
      ctx.fillStyle = "#2d8ceb";
      ctx.fill();
    }
    ctx.restore();
  }

  paintShapePreview(ctx, app, preview) {
    const view = app.view;
    const r = view.rectDocToScreen(preview.bounds);
    ctx.save();
    ctx.strokeStyle = "#2d8ceb";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    if (preview.kind === "ellipse") {
      ctx.beginPath();
      ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, Math.abs(r.w / 2), Math.abs(r.h / 2), 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (preview.kind === "line") {
      ctx.beginPath();
      ctx.moveTo(r.x, r.y);
      ctx.lineTo(r.x + r.w, r.y + r.h);
      ctx.stroke();
    } else {
      ctx.strokeRect(r.x, r.y, r.w, r.h);
    }
    ctx.setLineDash([]);
    const dim = `${Math.abs(Math.round(preview.bounds.w))} × ${Math.abs(Math.round(preview.bounds.h))} px`;
    this.drawLabel(ctx, dim, { x: r.x + r.w / 2, y: r.y + r.h + 8 });
    ctx.restore();
  }

  paintFreehandPreview(ctx, app) {
    const subpaths = app.toolState.freehandPreview;
    if (!subpaths || !subpaths.length) return;
    ctx.save();
    ctx.setTransform(this.dpr * app.view.zoom, 0, 0, this.dpr * app.view.zoom, this.dpr * app.view.tx, this.dpr * app.view.ty);
    ctx.strokeStyle = "#2d8ceb";
    ctx.lineWidth = 1.4 / app.view.zoom;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke(subpathsToPath2D(subpaths));
    ctx.restore();
  }

  paintMarquee(ctx, rect) {
    ctx.save();
    if (rect.lasso && rect.points?.length) {
      ctx.strokeStyle = "rgba(45,140,235,0.9)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      const pts = rect.points.map((p) => this.app.view.docToScreen(p));
      ctx.moveTo(pts[0].x, pts[0].y);
      for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y);
      ctx.stroke();
      ctx.restore();
      return;
    }
    ctx.fillStyle = "rgba(45,140,235,0.12)";
    ctx.strokeStyle = "rgba(45,140,235,0.9)";
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    ctx.strokeRect(Math.round(rect.x) + 0.5, Math.round(rect.y) + 0.5, Math.round(rect.w), Math.round(rect.h));
    ctx.restore();
  }

  paintGuideDrag(ctx, app) {
    const g = app.toolState.guideDrag;
    ctx.save();
    ctx.strokeStyle = "#23c4d6";
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (g.axis === "h") {
      ctx.moveTo(0, Math.round(g.pos) + 0.5);
      ctx.lineTo(app.view.screenWidth, Math.round(g.pos) + 0.5);
    } else {
      ctx.moveTo(Math.round(g.pos) + 0.5, 0);
      ctx.lineTo(Math.round(g.pos) + 0.5, app.view.screenHeight);
    }
    ctx.stroke();
    ctx.restore();
  }

  paintMeasure(ctx, m) {
    const a = this.sc(this.app.view.screenToDoc(m.a));
    const b = this.sc(this.app.view.screenToDoc(m.b));
    ctx.save();
    ctx.strokeStyle = "#ff3ec8";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    for (const p of [a, b]) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
      ctx.fillStyle = "#ff3ec8";
      ctx.fill();
    }
    const dist = Math.hypot((m.b.x - m.a.x) / this.app.view.zoom, (m.b.y - m.a.y) / this.app.view.zoom);
    const angle = (Math.atan2(m.b.y - m.a.y, m.b.x - m.a.x) * 180) / Math.PI;
    this.drawLabel(ctx, `D: ${dist.toFixed(2)} px   ∠ ${angle.toFixed(1)}°`, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - 14 });
    ctx.restore();
  }

  paintSnapLines(ctx, app) {
    ctx.save();
    ctx.strokeStyle = "#ff3ec8";
    ctx.lineWidth = 1;
    for (const line of app.snapLines) {
      ctx.beginPath();
      if (line.axis === "h") {
        const y = Math.round(app.view.docToScreen({ x: 0, y: line.pos }).y) + 0.5;
        ctx.moveTo(0, y);
        ctx.lineTo(app.view.screenWidth, y);
      } else {
        const x = Math.round(app.view.docToScreen({ x: line.pos, y: 0 }).x) + 0.5;
        ctx.moveTo(x, 0);
        ctx.lineTo(x, app.view.screenHeight);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  drawLabel(ctx, text, at) {
    ctx.save();
    ctx.font = "10px ui-sans-serif, system-ui, sans-serif";
    const w = ctx.measureText(text).width + 10;
    const h = 15;
    ctx.fillStyle = "rgba(20,20,20,0.92)";
    ctx.strokeStyle = "rgba(0,0,0,0.6)";
    ctx.lineWidth = 1;
    const x = Math.round(at.x - w / 2);
    const y = Math.round(at.y - h / 2);
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x + 0.5, y + 0.5, w, h, 2);
    else ctx.rect(x + 0.5, y + 0.5, w, h);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#f0f0f0";
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    ctx.fillText(text, at.x, at.y + 0.5);
    ctx.restore();
  }

  /* ------------------------------------------------------------- rulers */

  paintRulers() {
    const app = this.app;
    const view = app.view;
    if (!this.rulerH || !app.showRulers) return;
    const styles = getComputedStyle(document.documentElement);
    const bg = styles.getPropertyValue("--chrome").trim();
    const fg = styles.getPropertyValue("--text-faint").trim();
    const line = styles.getPropertyValue("--text-dim").trim();
    for (const [canvas, horizontal] of [[this.rulerH, true], [this.rulerV, false]]) {
      const ctx = canvas.getContext("2d");
      const w = canvas.width / this.dpr;
      const h = canvas.height / this.dpr;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = fg;
      ctx.fillStyle = fg;
      ctx.font = "9px ui-sans-serif, system-ui, sans-serif";
      ctx.lineWidth = 1;
      const zoom = view.zoom;
      const step = chooseStep(zoom);
      const originScreen = horizontal ? view.tx : view.ty;
      const length = horizontal ? w : h;
      const startDoc = -originScreen / zoom;
      const endDoc = (length - originScreen) / zoom;
      const first = Math.floor(startDoc / step) * step;
      ctx.beginPath();
      for (let v = first; v <= endDoc; v += step) {
        const s = Math.round(v * zoom + originScreen) + 0.5;
        if (s < -30 || s > length + 30) continue;
        if (horizontal) {
          ctx.moveTo(s, 14);
          ctx.lineTo(s, 20);
        } else {
          ctx.moveTo(14, s);
          ctx.lineTo(20, s);
        }
        const label = String(Math.round(v));
        ctx.fillStyle = fg;
        if (horizontal) {
          ctx.textAlign = "left";
          ctx.textBaseline = "top";
          ctx.fillText(label, s + 2, 2);
        } else {
          ctx.save();
          ctx.translate(2, s + 2);
          ctx.rotate(Math.PI / 2);
          ctx.textAlign = "left";
          ctx.textBaseline = "top";
          ctx.fillText(label, 0, -2);
          ctx.restore();
        }
      }
      ctx.strokeStyle = line;
      ctx.stroke();
      // minor ticks
      const minor = step / 5;
      if (minor * zoom > 4) {
        ctx.beginPath();
        for (let v = first; v <= endDoc; v += minor) {
          const s = Math.round(v * zoom + originScreen) + 0.5;
          if (horizontal) {
            ctx.moveTo(s, 17);
            ctx.lineTo(s, 20);
          } else {
            ctx.moveTo(17, s);
            ctx.lineTo(20, s);
          }
        }
        ctx.strokeStyle = "rgba(160,160,160,0.5)";
        ctx.stroke();
      }
    }
    // cursor tracking marks
    const cursor = app.pointerScreen;
    if (cursor) {
      const ctxH = this.rulerH.getContext("2d");
      ctxH.save();
      ctxH.strokeStyle = "#2d8ceb";
      ctxH.beginPath();
      ctxH.moveTo(Math.round(cursor.x) + 0.5, 0);
      ctxH.lineTo(Math.round(cursor.x) + 0.5, 20);
      ctxH.stroke();
      ctxH.restore();
      const ctxV = this.rulerV.getContext("2d");
      ctxV.save();
      ctxV.strokeStyle = "#2d8ceb";
      ctxV.beginPath();
      ctxV.moveTo(0, Math.round(cursor.y) + 0.5);
      ctxV.lineTo(20, Math.round(cursor.y) + 0.5);
      ctxV.stroke();
      ctxV.restore();
    }
  }

  /* ------------------------------------------------------------- hit test */

  hitTest(docPoint, { anchors = false } = {}) {
    const app = this.app;
    const ctx = this.hctx;
    this.hitCanvas.width = 1;
    this.hitCanvas.height = 1;
    const ordered = [];
    for (const layer of app.doc.layers) {
      if (!layer.visible || layer.locked) continue;
      collectHittable(layer.children, ordered);
    }
    for (let i = ordered.length - 1; i >= 0; i--) {
      const node = ordered[i];
      if (node.locked) continue;
      if (node.type === "text") {
        const b = nodeBounds(node);
        if (docPoint.x >= b.x - 2 && docPoint.x <= b.x + b.w + 2 && docPoint.y >= b.y - 2 && docPoint.y <= b.y + b.h + 2) {
          return node.id;
        }
        continue;
      }
      const p2d = subpathsToPath2D(node.subpaths);
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (node.fill && ctx.isPointInPath(p2d, docPoint.x, docPoint.y, "nonzero")) {
        ctx.restore();
        return node.id;
      }
      if (node.stroke && node.stroke.width > 0) {
        ctx.lineWidth = Math.max(node.stroke.width, 6 / app.view.zoom);
        if (ctx.isPointInStroke(p2d, docPoint.x, docPoint.y)) {
          ctx.restore();
          return node.id;
        }
      }
      ctx.restore();
    }
    return null;
  }

  /** Anchor hit test for the direct-selection tool. */
  anchorAt(screenPoint) {
    const app = this.app;
    const view = app.view;
    const hits = [];
    const nodes = app.selection.length ? app.selectionNodes() : app.doc.layers.flatMap((l) => collectPaths(l.children));
    for (const node of nodes) {
      if (node.type !== "path") continue;
      node.subpaths.forEach((sp, si) => {
        sp.nodes.forEach((n, ni) => {
          const p = view.docToScreen(n);
          const d = Math.hypot(p.x - screenPoint.x, p.y - screenPoint.y);
          if (d <= 6) hits.push({ nodeId: node.id, si, ni, dist: d, screen: p });
          for (const [hx, hy, type] of [[n.ix, n.iy, "in"], [n.ox, n.oy, "out"]]) {
            const hp = view.docToScreen({ x: hx, y: hy });
            const hd = Math.hypot(hp.x - screenPoint.x, hp.y - screenPoint.y);
            if (hd <= 6) hits.push({ nodeId: node.id, si, ni, handle: type, dist: hd, screen: hp });
          }
        });
      });
    }
    hits.sort((a, b) => a.dist - b.dist);
    return hits[0] || null;
  }
}

function collectHittable(nodes, out) {
  for (const node of nodes) {
    if (node.visible === false) continue;
    if (node.type === "group") collectHittable(node.children, out);
    else out.push(node);
  }
}

function collectPaths(nodes, out = []) {
  for (const n of nodes) {
    if (n.type === "group") collectPaths(n.children, out);
    else if (n.type === "path" && n.visible !== false) out.push(n);
  }
  return out;
}

function chooseStep(zoom) {
  const candidates = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000];
  for (const c of candidates) {
    if (c * zoom >= 54) return c;
  }
  return 10000;
}
