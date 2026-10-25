/**
 * Selection-level mutations shared by the control bar and the panel dock.
 * These used to live inside the imperative panel kit; in the React edition they
 * are plain functions so both surfaces can call exactly the same code path.
 */

import { app } from "./app.js";

export function moveSelection(axis, value) {
  const bounds = app.selectionBounds();
  if (!bounds) return;
  const delta = value - (axis === "x" ? bounds.x : bounds.y);
  if (Math.abs(delta) < 1e-6) return;
  app.mutate(`move-${axis}`, () => {
    for (const node of app.selectionNodes()) {
      app.translateNode(node, axis === "x" ? delta : 0, axis === "y" ? delta : 0);
    }
  });
}

export function resizeSelection(dim, value, linked = false) {
  const bounds = app.selectionBounds();
  if (!bounds) return;
  const current = dim === "w" ? bounds.w : bounds.h;
  if (current < 1e-6) return;
  const scale = value / current;
  if (Math.abs(scale - 1) < 1e-6) return;
  const sx = linked || dim === "w" ? scale : 1;
  const sy = linked || dim === "h" ? scale : 1;
  app.mutate(`resize-${dim}`, () => {
    for (const node of app.selectionNodes()) app.transformNodeScale(node, sx, sy, bounds.x, bounds.y);
  });
}

export function rotateBy(angle) {
  app.mutate("rotate", () => app.rotateSelection(angle));
}

export function shearBy(angle) {
  app.mutate("shear", () => app.shearSelection(angle));
}

export function flip(axis) {
  app.flipSelection(axis);
}

export function align(scope, mode, toArtboard = false) {
  app.alignTo = scope;
  app.align("align", mode, toArtboard);
}

export function distribute(mode) {
  app.align("distribute", mode);
}

export function setPaintTarget(target) {
  app.setTarget(target);
  app.refreshPanels();
}

export function toggleFill() {
  app.applyFillPaint(app.currentFill() ? null : { type: "solid", color: "#3b6ea5" });
}

export function addSwatchFromCurrent() {
  const color = app.currentFill()?.color || app.currentStroke()?.color || "#3b6ea5";
  if (!app.doc.swatches) app.doc.swatches = [];
  if (!app.doc.swatches.includes(color)) app.doc.swatches.unshift(color);
  app.dirty = true;
  app.refreshPanels();
}
