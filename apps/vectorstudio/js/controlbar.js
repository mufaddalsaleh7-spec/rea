/**
 * Context-sensitive control bar. Mirrors the behaviour of Illustrator's
 * control bar: tool options on the left, transform/appearance for the current
 * selection, and quick actions on the right.
 */

import { el, fmt } from "./util.js";
import { icon } from "./icons.js";
import { numField, iconButton, button, selectField } from "./ui.js";
import { nodeBounds, textMetrics, activeArtboard } from "./doc.js";
import { TOOL_LABELS, TOOL_DEFS_ICON } from "./tools.js";

const FAMILIES = [
  ["Helvetica Neue, Helvetica, Arial, sans-serif", "Helvetica Neue"],
  ["Arial, Helvetica, sans-serif", "Arial"],
  ["Georgia, serif", "Georgia"],
  ["Times New Roman, Times, serif", "Times New Roman"],
  ["Courier New, Courier, monospace", "Courier New"],
  ["Verdana, Geneva, sans-serif", "Verdana"],
  ["Trebuchet MS, sans-serif", "Trebuchet MS"],
  ["Impact, Haettenschweiler, sans-serif", "Impact"],
  ["Palatino, Palatino Linotype, serif", "Palatino"],
  ["Baskerville, serif", "Baskerville"],
  ["Menlo, Consolas, monospace", "Menlo"],
];

export class ControlBar {
  constructor(app, root) {
    this.app = app;
    this.root = root;
    this.signature = "";
    this.update();
  }

  update(force = false) {
    const app = this.app;
    if (!app.doc) return;
    if (!force && this.root.contains(document.activeElement)) return;
    const nodes = app.selectionNodes();
    const first = nodes[0];
    const sig = JSON.stringify({
      tool: app.tool,
      sel: app.selection.join(","),
      type: first?.type,
      kind: first?.kind,
      target: app.target,
      n: nodes.length,
      artboard: app.doc.activeArtboardId,
      fill: first ? JSON.stringify(first.fill) : JSON.stringify(app.fill),
      stroke: first ? JSON.stringify(first.stroke) : JSON.stringify(app.stroke),
      opacity: first?.opacity,
      text: first?.type === "text" ? JSON.stringify([first.fontFamily, first.fontSize, first.fontWeight, first.fontStyle, first.letterSpacing, first.lineHeight, first.align]) : null,
    });
    if (!force && sig === this.signature) return;
    this.signature = sig;
    this.root.replaceChildren();
    this.buildToolOptions();
    if (first) {
      this.buildTransform(nodes, first);
      this.buildAppearance(first);
      if (first.type === "text") this.buildType(first);
      this.buildArrange();
    } else {
      this.buildDocument();
    }
    this.root.append(el("div", { class: "spacer" }));
    this.buildRight();
  }

  divider() {
    return el("div", { class: "controlbar__divider" });
  }

  toolBadge() {
    const app = this.app;
    const def = TOOL_DEFS_ICON[app.tool] || "select";
    return el("div", { class: "controlbar__group" }, [
      el("span", { html: icon(def, 16), style: { color: "var(--text-dim)" } }),
      el("span", { class: "controlbar__title", text: TOOL_LABELS[app.tool] || "Selection Tool" }),
    ]);
  }

  buildToolOptions() {
    const app = this.app;
    const tool = app.tool;
    this.root.append(this.toolBadge());

    if (["rect", "roundrect", "ellipse", "polygon", "star", "line", "arc", "spiral", "grid"].includes(tool)) {
      const group = el("div", { class: "controlbar__group" });
      if (tool === "roundrect") {
        const radius = numField({
          label: "⌐", value: app.tools.cornerRadius || 12, min: 0, dp: 0, width: 62,
          onChange: (v) => { app.tools.cornerRadius = v; },
        });
        group.append(el("span", { class: "controlbar__label" }, ["Corner radius"]), radius.el);
      }
      if (tool === "polygon") {
        const sides = numField({
          label: "", value: app.tools.polygonSides || 6, min: 3, max: 64, step: 1, dp: 0, width: 52,
          onChange: (v) => { app.tools.polygonSides = Math.round(v); },
        });
        group.append(el("span", { class: "controlbar__label" }, ["Sides"]), sides.el);
      }
      if (tool === "star") {
        const points = numField({
          label: "", value: app.tools.starPoints || 5, min: 3, max: 40, step: 1, dp: 0, width: 46,
          onChange: (v) => { app.tools.starPoints = Math.round(v); },
        });
        const inner = numField({
          label: "", value: (app.tools.starInner || 0.5) * 100, min: 1, max: 100, step: 1, dp: 0, width: 52,
          onChange: (v) => { app.tools.starInner = v / 100; },
        });
        group.append(el("span", { class: "controlbar__label" }, ["Points"]), points.el,
          el("span", { class: "controlbar__label" }, ["Inner"]), inner.el);
      }
      if (["arc", "spiral"].includes(tool)) {
        group.append(el("span", { class: "controlbar__label" }, [tool === "arc" ? "Drag to draw an arc" : "Drag to draw a spiral"]));
      }
      if (group.childNodes.length) this.root.append(group, this.divider());
    }

    if (["pen", "curvature"].includes(tool)) {
      this.root.append(el("div", { class: "controlbar__group" }, [
        el("span", { class: "controlbar__label", text: "Click to add anchors · drag for curves · click the first anchor to close" }),
      ]), this.divider());
    }
    if (["pencil", "brush", "smooth", "blob"].includes(tool)) {
      this.root.append(el("div", { class: "controlbar__group" }, [
        el("span", { class: "controlbar__label", text: "Drag to draw · strokes are simplified to smooth Bézier curves" }),
      ]), this.divider());
    }
    if (tool === "gradient") {
      this.root.append(el("div", { class: "controlbar__group" }, [
        el("span", { class: "controlbar__label", text: "Drag across artwork to set gradient direction" }),
      ]), this.divider());
    }
    if (tool === "artboard") {
      this.root.append(el("div", { class: "controlbar__group" }, [
        el("span", { class: "controlbar__label", text: "Drag to create an artboard · click to activate" }),
      ]), this.divider());
    }
    if (tool === "measure") {
      this.root.append(el("div", { class: "controlbar__group" }, [
        el("span", { class: "controlbar__label", text: "Drag to measure distance and angle" }),
      ]), this.divider());
    }
  }

  buildTransform(nodes, first) {
    const app = this.app;
    const b = app.selectionBounds();
    if (!b) return;
    const multi = nodes.length > 1;
    const x = numField({
      label: "X", value: b.x, dp: 2, width: 66,
      onChange: (v) => app.mutate("cb-x", () => {
        const bb = app.selectionBounds();
        const dx = v - bb.x;
        for (const n of app.selectionNodes()) app.translateNode(n, dx, 0);
      }),
    });
    const y = numField({
      label: "Y", value: b.y, dp: 2, width: 66,
      onChange: (v) => app.mutate("cb-y", () => {
        const bb = app.selectionBounds();
        const dy = v - bb.y;
        for (const n of app.selectionNodes()) app.translateNode(n, 0, dy);
      }),
    });
    const w = numField({
      label: "W", value: b.w, min: 0.01, dp: 2, width: 68,
      onChange: (v) => {
        const bb = app.selectionBounds();
        if (bb.w < 1e-6) return;
        app.mutate("cb-w", () => {
          for (const n of app.selectionNodes()) app.transformNodeScale(n, v / bb.w, 1, bb.x, bb.y);
        });
      },
    });
    const h = numField({
      label: "H", value: b.h, min: 0.01, dp: 2, width: 68,
      onChange: (v) => {
        const bb = app.selectionBounds();
        if (bb.h < 1e-6) return;
        app.mutate("cb-h", () => {
          for (const n of app.selectionNodes()) app.transformNodeScale(n, 1, v / bb.h, bb.x, bb.y);
        });
      },
    });
    const link = iconButton("link", { title: "Constrain proportions" });
    let linked = false;
    link.addEventListener("click", () => {
      linked = !linked;
      link.classList.toggle("is-active", linked);
    });
    const group = el("div", { class: "controlbar__group" }, [
      el("span", { class: "controlbar__label", text: multi ? `${nodes.length} objects` : (first.kind === "path" ? "Path" : capitalize(first.kind || first.type)) }),
      x.el, y.el, w.el, h.el, link,
    ]);
    this.root.append(group, this.divider());
  }

  buildAppearance(first) {
    const app = this.app;
    const fillChip = el("button", { class: "appearance-row__swatch", title: "Fill" });
    fillChip.style.width = "18px";
    fillChip.style.height = "18px";
    const strokeChip = el("button", { class: "appearance-row__swatch", title: "Stroke" });
    strokeChip.style.width = "18px";
    strokeChip.style.height = "18px";
    const paintFill = () => {
      if (!first.fill) {
        fillChip.classList.add("proxy__none");
        fillChip.style.background = "";
      } else if (first.fill.type === "gradient" || first.fill.type === "radial") {
        fillChip.classList.remove("proxy__none");
        const stops = (first.fill.stops || []).map((s) => `${s.color} ${Math.round(s.offset * 100)}%`).join(",");
        fillChip.style.background = first.fill.type === "radial"
          ? `radial-gradient(circle, ${stops})`
          : `linear-gradient(90deg, ${stops})`;
      } else {
        fillChip.classList.remove("proxy__none");
        fillChip.style.background = first.fill.color;
      }
    };
    paintFill();
    if (first.stroke) {
      strokeChip.style.background = first.stroke.color;
      strokeChip.classList.remove("proxy__none");
    } else {
      strokeChip.classList.add("proxy__none");
    }
    fillChip.addEventListener("click", () => { app.setTarget("fill"); app.refreshPanels(); this.update(true); });
    strokeChip.addEventListener("click", () => { app.setTarget("stroke"); app.refreshPanels(); this.update(true); });

    const weight = numField({
      label: "", value: first.stroke?.width ?? 0, min: 0, max: 500, step: 0.5, dp: 2, width: 58,
      onChange: (v) => app.setStrokeProp("width", v),
    });
    const opacity = numField({
      label: "", value: Math.round((first.opacity ?? 1) * 100), min: 0, max: 100, dp: 0, width: 50,
      onChange: (v) => app.setOpacity(v / 100),
    });
    this.root.append(el("div", { class: "controlbar__group" }, [
      fillChip, strokeChip,
      el("span", { class: "controlbar__label", text: "Stroke" }), weight.el,
      el("span", { class: "controlbar__label", text: "Opacity" }), opacity.el,
      el("span", { class: "controlbar__label", text: "%" }),
    ]), this.divider());
  }

  buildType(first) {
    const app = this.app;
    const family = selectField({
      options: FAMILIES.map(([value, label]) => ({ value, label })),
      value: first.fontFamily,
      width: 138,
      onChange: (v) => app.setTextProps({ fontFamily: v }),
    });
    const size = numField({
      label: "", value: first.fontSize, min: 1, dp: 1, width: 52,
      onChange: (v) => app.setTextProps({ fontSize: v }),
    });
    const tracking = numField({
      label: "", value: first.letterSpacing || 0, dp: 1, width: 48,
      onChange: (v) => app.setTextProps({ letterSpacing: v }),
    });
    const leading = numField({
      label: "", value: first.lineHeight || first.fontSize * 1.2, dp: 1, width: 52,
      onChange: (v) => app.setTextProps({ lineHeight: v }),
    });
    const alignBtns = el("div", { class: "row row--tight" });
    for (const [ic, value, title] of [["typeLeft", "left", "Align left"], ["typeCenter", "center", "Align center"], ["typeRight", "right", "Align right"], ["typeJustify", "justify", "Justify"]]) {
      const b = iconButton(ic, { title, active: first.align === value, onClick: () => { app.setTextProps({ align: value }); this.update(true); } });
      alignBtns.append(b);
    }
    this.root.append(el("div", { class: "controlbar__group" }, [
      family.el, size.el,
      el("span", { class: "controlbar__label", title: "Tracking" }, ["⟷"]), tracking.el,
      el("span", { class: "controlbar__label", title: "Leading" }, ["⌃"]), leading.el,
      alignBtns,
    ]), this.divider());
  }

  buildArrange() {
    const app = this.app;
    const group = el("div", { class: "controlbar__group" });
    const defs = [
      ["alignLeft", () => app.align("align", "horizontalAlignLeft"), "Align left"],
      ["alignCenterH", () => app.align("align", "horizontalAlignCenter"), "Align horizontal center"],
      ["alignRight", () => app.align("align", "horizontalAlignRight"), "Align right"],
      ["alignTop", () => app.align("align", "verticalAlignTop"), "Align top"],
      ["alignCenterV", () => app.align("align", "verticalAlignCenter"), "Align vertical center"],
      ["alignBottom", () => app.align("align", "verticalAlignBottom"), "Align bottom"],
    ];
    for (const [ic, fn, title] of defs) {
      group.append(iconButton(ic, { title, onClick: fn }));
    }
    group.append(el("div", { class: "controlbar__divider" }));
    for (const [ic, fn, title] of [
      ["unite", () => app.applyPathfinder("unite"), "Unite"],
      ["minusFront", () => app.applyPathfinder("minusFront"), "Minus front"],
      ["intersect", () => app.applyPathfinder("intersect"), "Intersect"],
      ["exclude", () => app.applyPathfinder("exclude"), "Exclude"],
    ]) {
      group.append(iconButton(ic, { title, onClick: fn, size: 15 }));
    }
    this.root.append(group);
  }

  buildDocument() {
    const app = this.app;
    const ab = activeArtboard(app.doc);
    const w = numField({
      label: "W", value: ab.w, min: 1, dp: 0, width: 70,
      onChange: (v) => { app.mutate("doc-w", () => { ab.w = v; }); app.requestRender(true); },
    });
    const h = numField({
      label: "H", value: ab.h, min: 1, dp: 0, width: 70,
      onChange: (v) => { app.mutate("doc-h", () => { ab.h = v; }); app.requestRender(true); },
    });
    const rulers = iconButton("width", { title: "Show/Hide Rulers", active: app.showRulers, onClick: () => app.toggleRulers() });
    const grid = iconButton("gridSmall", { title: "Show/Hide Grid", active: app.showGrid, onClick: () => app.toggleGrid() });
    const guides = iconButton("line", { title: "Show/Hide Guides", active: app.showGuides, onClick: () => app.toggleGuides() });
    const smart = iconButton("target", { title: "Smart Guides", active: app.showSmartGuides, onClick: () => app.toggleSmartGuides() });
    this.root.append(
      el("div", { class: "controlbar__group" }, [
        el("span", { class: "controlbar__label", text: "Document" }),
        el("span", { class: "controlbar__title", text: ab.name }),
        w.el, h.el,
      ]),
      this.divider(),
      el("div", { class: "controlbar__group" }, [
        el("span", { class: "controlbar__label", text: "View" }), rulers, grid, guides, smart,
      ]),
    );
  }

  buildRight() {
    const app = this.app;
    const group = el("div", { class: "controlbar__group" });
    group.append(
      iconButton("folder", { title: "Save Document (⌘S)", onClick: () => app.commands.saveDocument() }),
      iconButton("duplicate", { title: "Duplicate (⌘D)", onClick: () => app.duplicateSelection() }),
      iconButton("trash", { title: "Delete (Del)", onClick: () => app.deleteSelection() }),
      el("div", { class: "controlbar__divider" }),
      iconButton("hamburger", { title: "Document Settings", onClick: () => app.commands.documentSetup() }),
    );
    this.root.append(group);
  }
}


function capitalize(s = "") {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
