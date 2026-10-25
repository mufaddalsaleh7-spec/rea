/**
 * Panel dock: Properties, Layers, Artboards, Color, Swatches, Gradient,
 * Appearance, Stroke, Transparency, Align, Pathfinder, Transform, Character,
 * Paragraph and the REA Analysis panel.
 *
 * Panels are built once, then refreshed from the document; focused inputs are
 * never overwritten mid-edit.
 */

import { el, fmt, clamp, hexToHsv, hsvToHex, rgbToHex, hexToRgb, luminance, withAlpha } from "./util.js";
import { icon } from "./icons.js";
import {
  numField, textField, selectField, iconButton, button, checkbox, slider, segmented,
  swatch, colorField, showMenu, showDialog, toast,
} from "./ui.js";
import { SWATCHES, nodeBounds, textMetrics, activeArtboard, createLayer } from "./doc.js";

const FONT_FAMILIES = [
  "Helvetica Neue, Helvetica, Arial, sans-serif",
  "Arial, Helvetica, sans-serif",
  "Georgia, serif",
  "Times New Roman, Times, serif",
  "Courier New, Courier, monospace",
  "Verdana, Geneva, sans-serif",
  "Trebuchet MS, sans-serif",
  "Impact, Haettenschweiler, sans-serif",
  "Palatino, Palatino Linotype, serif",
  "Gill Sans, Gill Sans MT, sans-serif",
  "Baskerville, serif",
  "Futura, Trebuchet MS, sans-serif",
  "SF Pro Display, -apple-system, BlinkMacSystemFont, sans-serif",
  "Menlo, Consolas, monospace",
];

const FAMILY_LABELS = {
  "Helvetica Neue, Helvetica, Arial, sans-serif": "Helvetica Neue",
  "Arial, Helvetica, sans-serif": "Arial",
  "Georgia, serif": "Georgia",
  "Times New Roman, Times, serif": "Times New Roman",
  "Courier New, Courier, monospace": "Courier New",
  "Verdana, Geneva, sans-serif": "Verdana",
  "Trebuchet MS, sans-serif": "Trebuchet MS",
  "Impact, Haettenschweiler, sans-serif": "Impact",
  "Palatino, Palatino Linotype, serif": "Palatino",
  "Gill Sans, Gill Sans MT, sans-serif": "Gill Sans",
  "Baskerville, serif": "Baskerville",
  "Futura, Trebuchet MS, sans-serif": "Futura",
  "SF Pro Display, -apple-system, BlinkMacSystemFont, sans-serif": "SF Pro Display",
  "Menlo, Consolas, monospace": "Menlo",
};

/* ------------------------------------------------------------------ helpers */

function panelRow(label, controls, { labelWidth = 34 } = {}) {
  return el("div", { class: "row" }, [
    el("span", { class: "label", style: { minWidth: `${labelWidth}px` } }, [label]),
    ...controls,
  ]);
}

function gridRow(cols, children, gap = 4) {
  return el("div", {
    style: { display: "grid", gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: `${gap}px` },
  }, children);
}

function group(title, children) {
  return el("div", { class: "dialog__section", style: { border: "0", padding: "0", gap: "6px" } }, [
    title ? el("h4", { text: title }) : null,
    ...children,
  ]);
}

/* ================================================================== panels */

function propertiesPanel(app) {
  const root = el("div", { class: "panel__body" });

  const x = numField({ label: "X", value: 0, onChange: (v) => moveSelection(app, "x", v) });
  const y = numField({ label: "Y", value: 0, onChange: (v) => moveSelection(app, "y", v) });
  const w = numField({ label: "W", value: 0, min: 0.01, onChange: (v) => resizeSelection(app, "w", v) });
  const h = numField({ label: "H", value: 0, min: 0.01, onChange: (v) => resizeSelection(app, "h", v) });
  const linkBtn = iconButton("link", { title: "Constrain width and height proportions" });
  let linked = false;
  linkBtn.addEventListener("click", () => {
    linked = !linked;
    linkBtn.classList.toggle("is-active", linked);
  });

  const row1 = gridRow(2, [x.el, y.el]);
  const row2 = el("div", { style: { display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr) 20px", gap: "4px", alignItems: "center" } }, [w.el, h.el, linkBtn]);

  const fillChip = el("button", { class: "appearance-row__swatch", title: "Fill" });
  fillChip.style.width = "20px"; fillChip.style.height = "20px";
  const strokeChip = el("button", { class: "appearance-row__swatch", title: "Stroke" });
  strokeChip.style.width = "20px"; strokeChip.style.height = "20px";
  const strokeWidth = numField({ label: "W", value: 1, min: 0, step: 0.25, dp: 2, width: 62, onChange: (v) => app.setStrokeProp("width", v) });
  const opacity = numField({ label: "", value: 100, min: 0, max: 100, dp: 0, width: 52, onChange: (v) => app.setOpacity(v / 100) });
  opacity.el.firstChild.textContent = "";

  fillChip.addEventListener("click", () => { app.setTarget("fill"); app.refreshPanels(); });
  strokeChip.addEventListener("click", () => { app.setTarget("stroke"); app.refreshPanels(); });

  const appearance = el("div", { style: { display: "flex", flexDirection: "column", gap: "5px" } }, [
    el("div", { class: "row row--tight" }, [
      el("span", { class: "label", style: { minWidth: "34px" } }, ["Fill"]),
      fillChip,
      el("span", { class: "label", style: { marginLeft: "8px" } }, ["Stroke"]),
      strokeChip,
      el("span", { class: "spacer" }),
    ]),
    el("div", { style: { display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: "4px" } }, [
      el("div", { class: "row row--tight" }, [el("span", { class: "label" }, ["Stroke"]), strokeWidth.el]),
      el("div", { class: "row row--tight" }, [el("span", { class: "label" }, ["Opacity"]), opacity.el, el("span", { class: "label" }, ["%"])]),
    ]),
  ]);

  const alignRow = el("div", { class: "align-grid" });
  const alignDefs = [
    ["alignLeft", "align", "horizontalAlignLeft"], ["alignCenterH", "align", "horizontalAlignCenter"],
    ["alignRight", "align", "horizontalAlignRight"], ["alignTop", "align", "verticalAlignTop"],
    ["alignCenterV", "align", "verticalAlignCenter"], ["alignBottom", "align", "verticalAlignBottom"],
    ["distributeH", "distribute", "distributeHorizontalCenter"], ["distributeV", "distribute", "distributeVerticalCenter"],
  ];
  for (const [ic, kind, mode] of alignDefs) {
    const b = el("button", { class: "align-btn", html: icon(ic, 15), title: mode.replace(/([A-Z])/g, " $1") });
    b.addEventListener("click", () => app.align(kind, mode));
    alignRow.append(b);
  }

  const pfRow = el("div", { class: "pf-grid" });
  for (const [ic, op, label] of [
    ["unite", "unite", "Unite"], ["minusFront", "minusFront", "Minus Front"],
    ["intersect", "intersect", "Intersect"], ["exclude", "exclude", "Exclude"],
    ["divide", "divide", "Divide"],
  ]) {
    const b = el("button", { class: "pf-btn", html: icon(ic, 16), title: `Pathfinder: ${label}` });
    b.addEventListener("click", () => app.applyPathfinder(op));
    pfRow.append(b);
  }

  const quick = el("div", { class: "row row--wrap" }, [
    button("Group", { small: true, onClick: () => app.groupSelection() }),
    button("Ungroup", { small: true, onClick: () => app.ungroupSelection() }),
    button("Duplicate", { small: true, onClick: () => app.duplicateSelection() }),
    button("Outline", { small: true, title: "Outline stroke", onClick: () => app.outlineStroke() }),
  ]);

  const docInfo = el("div", { class: "info-grid" });
  const docSection = el("div", { style: { display: "none" } }, [
    group("Document", [docInfo]),
  ]);

  root.append(
    el("div", { class: "row" }, [
      el("span", { class: "label", style: { minWidth: "52px" } }, ["Transform"]),
      el("div", { class: "grow" }, [row1]),
    ]),
    el("div", { class: "row" }, [el("span", { style: { minWidth: "52px" } }), el("div", { class: "grow" }, [row2])]),
    el("div", { class: "controlbar__divider", style: { width: "100%", height: "1px", opacity: "0.5" } }),
    appearance,
    el("div", { class: "controlbar__divider", style: { width: "100%", height: "1px", opacity: "0.5" } }),
    el("div", { class: "row" }, [el("span", { class: "label", style: { minWidth: "34px" } }, ["Align"]), alignRow]),
    el("div", { class: "controlbar__divider", style: { width: "100%", height: "1px", opacity: "0.5" } }),
    el("div", { class: "row" }, [el("span", { class: "label", style: { minWidth: "34px" } }, ["Pathfinder"]), pfRow]),
    el("div", { class: "controlbar__divider", style: { width: "100%", height: "1px", opacity: "0.5" } }),
    group("Quick Actions", [quick]),
    docSection,
    el("div", { class: "dialog__hint", id: "props-hint", text: "Select artwork to edit its transform and appearance." }),
  );

  const update = () => {
    const nodes = app.selectionNodes();
    const b = app.selectionBounds();
    const has = nodes.length > 0;
    docSection.style.display = has ? "none" : "flex";
    root.querySelectorAll(".row").forEach((r) => { r.style.opacity = has ? "1" : "0.55"; });
    root.querySelector("#props-hint").textContent = has
      ? `${nodes.length} object${nodes.length > 1 ? "s" : ""} selected`
      : "Select artwork to edit its transform and appearance.";
    if (b) {
      x.set(b.x); y.set(b.y); w.set(b.w); h.set(b.h);
    } else {
      x.set(0); y.set(0); w.set(0); h.set(0);
    }
    const first = nodes[0];
    const fill = first?.fill || app.fill;
    const stroke = first?.stroke || (app.stroke?.enabled ? app.stroke : null);
    paintChip(fillChip, fill);
    paintChip(strokeChip, stroke ? { type: "solid", color: stroke.color } : null);
    strokeWidth.set(stroke?.width ?? app.stroke?.width ?? 0);
    opacity.set(Math.round((first?.opacity ?? 1) * 100));
    fillChip.style.outline = app.target === "fill" ? "1px solid var(--accent)" : "none";
    fillChip.style.outlineOffset = "1px";
    strokeChip.style.outline = app.target === "stroke" ? "1px solid var(--accent)" : "none";
    strokeChip.style.outlineOffset = "1px";
    const ab = activeArtboard(app.doc);
    docInfo.replaceChildren(
      el("span", { class: "label" }, ["Name"]), el("span", { class: "value" }, [ab.name]),
      el("span", { class: "label" }, ["Size"]), el("span", { class: "value" }, [`${fmt(ab.w, 0)} × ${fmt(ab.h, 0)} px`]),
      el("span", { class: "label" }, ["Mode"]), el("span", { class: "value" }, ["RGB / 72 ppi"]),
      el("span", { class: "label" }, ["Artboards"]), el("span", { class: "value" }, [String(app.doc.artboards.length)]),
    );
  };

  return { el: root, update };
}

function paintChip(node, paint) {
  if (!paint) {
    node.style.background = "";
    node.classList.add("proxy__none");
    return;
  }
  node.classList.remove("proxy__none");
  if (paint.type === "gradient" || paint.type === "radial") {
    const stops = (paint.stops || []).map((s) => `${s.color} ${Math.round(s.offset * 100)}%`).join(", ");
    node.style.background = paint.type === "radial"
      ? `radial-gradient(circle, ${stops || "#fff, #000"})`
      : `linear-gradient(90deg, ${stops || "#fff, #000"})`;
  } else {
    node.style.background = paint.color;
  }
}

function moveSelection(app, axis, value) {
  const b = app.selectionBounds();
  if (!b) return;
  const delta = value - (axis === "x" ? b.x : b.y);
  if (Math.abs(delta) < 1e-6) return;
  app.mutate(`move-${axis}`, () => {
    for (const n of app.selectionNodes()) app.translateNode(n, axis === "x" ? delta : 0, axis === "y" ? delta : 0);
  });
}

function resizeSelection(app, dim, value) {
  const b = app.selectionBounds();
  if (!b) return;
  const current = dim === "w" ? b.w : b.h;
  if (current < 1e-6) return;
  const scale = value / current;
  if (Math.abs(scale - 1) < 1e-6) return;
  app.mutate(`resize-${dim}`, () => {
    for (const n of app.selectionNodes()) app.transformNodeScale(n, dim === "w" ? scale : 1, dim === "h" ? scale : 1, b.x, b.y);
  });
}

/* ------------------------------------------------------------------ layers */

function layersPanel(app) {
  const root = el("div", { class: "panel__body panel__body--flush" });
  const toolbar = el("div", { class: "panel__footer" });
  const list = el("div", { class: "layers" });
  root.append(toolbar, list);

  const addLayerBtn = iconButton("plus", {
    title: "New Layer",
    onClick: () => {
      app.history.record();
      const layer = createLayer(`Layer ${app.doc.layers.length + 1}`);
      app.doc.layers.push(layer);
      app.activeLayerId = layer.id;
      app.refreshPanels();
      app.requestRender(true);
    },
  });
  const deleteBtn = iconButton("trash", { title: "Delete Selection", onClick: () => app.deleteSelection() });
  const duplicateBtn = iconButton("duplicate", { title: "Duplicate Selection", onClick: () => app.duplicateSelection() });
  const menuBtn = iconButton("more", {
    title: "Layer Options",
    onClick: (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      showMenu(r.left - 140, r.bottom + 2, [
        { label: "New Layer", action: () => addLayerBtn.click() },
        { label: "Duplicate Layer", disabled: !app.activeLayerId, action: () => app.duplicateLayer(app.activeLayerId) },
        { separator: true },
        { label: "Show All", action: () => { app.doc.layers.forEach((l) => { l.visible = true; }); app.requestRender(true); app.refreshPanels(); } },
        { label: "Hide Others", action: () => { app.doc.layers.forEach((l) => { l.visible = l.id === app.activeLayerId; }); app.requestRender(true); app.refreshPanels(); } },
        { label: "Lock Others", action: () => { app.doc.layers.forEach((l) => { l.locked = l.id !== app.activeLayerId; }); app.refreshPanels(); } },
        { separator: true },
        { label: "Delete Layer", disabled: app.doc.layers.length < 2, action: () => app.deleteLayer(app.activeLayerId) },
      ]);
    },
  });
  toolbar.append(
    el("span", { class: "label", text: "Layers" }),
    el("span", { class: "spacer" }),
    duplicateBtn, addLayerBtn, deleteBtn, menuBtn,
  );

  let renaming = null;

  const update = () => {
    if (renaming || app._renamingId || document.activeElement?.closest(".layers")) return;
    list.replaceChildren();
    const rows = [];
    for (const layer of app.doc.layers) {
      rows.push({ node: layer, depth: 0, layer });
      if (layer.expanded) {
        collectRows(layer.children, rows, 1, layer);
      }
    }
    for (const row of rows) {
      list.append(buildRow(app, row, { onRename: (node) => { renaming = node.id; update(); }, onRenameDone: () => { renaming = null; update(); } }));
    }
  };

  return {
    el: root,
    update,
    actions: toolbar,
    isRenaming: () => renaming,
  };
}

function collectRows(nodes, rows, depth, layer) {
  const list = nodes.slice().reverse();
  for (const node of list) {
    rows.push({ node, depth, layer });
    if (node.children && node.children.length && node.expanded) {
      collectRows(node.children, rows, depth + 1, layer);
    }
  }
}

function buildRow(app, { node, depth, layer }, handlers) {
  const isLayer = node.type === "layer";
  const selected = app.selection.includes(node.id) || (isLayer && app.activeLayerId === node.id);
  const row = el("div", {
    class: `layer${selected ? " is-selected" : ""}${depth > 0 ? " layer--nested" : ""}`,
    style: { paddingLeft: `${4 + depth * 11}px` },
    draggable: "false",
  });

  const eye = el("button", {
    class: `layer__eye${node.visible !== false ? " is-on" : ""}`,
    title: node.visible !== false ? "Hide" : "Show",
    html: icon(node.visible !== false ? "eye" : "eyeOff", 13),
  });
  eye.addEventListener("click", (e) => {
    e.stopPropagation();
    node.visible = node.visible === false;
    app.requestRender(true);
    app.refreshPanels();
  });

  const lock = el("button", {
    class: `layer__lock${node.locked ? " is-on" : ""}`,
    title: node.locked ? "Unlock" : "Lock",
    html: icon(node.locked ? "lock" : "unlock", 12),
  });
  lock.addEventListener("click", (e) => {
    e.stopPropagation();
    node.locked = !node.locked;
    app.refreshPanels();
  });

  const target = el("button", {
    class: `layer__target${app.activeLayerId === (isLayer ? node.id : layer.id) && depth === 0 ? " is-on" : ""}`,
    title: "Target layer",
  });
  target.addEventListener("click", (e) => {
    e.stopPropagation();
    app.activeLayerId = isLayer ? node.id : layer.id;
    app.refreshPanels();
  });

  const twisty = el("button", {
    class: `layer__twisty${node.expanded ? " is-open" : ""}`,
    html: node.children && node.children.length ? icon("chevronRight", 9) : "",
  });
  if (node.children) {
    twisty.addEventListener("click", (e) => {
      e.stopPropagation();
      node.expanded = !node.expanded;
      app.refreshPanels();
    });
  }

  const label = el("div", { class: "layer__name" });
  if (!isLayer) {
    const thumb = el("span", { class: "layer__thumb" });
    if (node.type === "text") {
      thumb.style.background = "#fff";
      thumb.style.border = "0";
      thumb.style.display = "grid";
      thumb.style.placeItems = "center";
      thumb.style.color = "#333";
      thumb.innerHTML = "<span style='font:700 10px Georgia,serif;line-height:1'>T</span>";
    } else {
      thumb.style.background = node.fill?.type === "solid" ? node.fill.color : gradientCss(node.fill);
    }
    if (node.stroke && node.stroke.width > 0 && node.type !== "text" && !node.fill) {
      thumb.style.background = "#fff";
      thumb.style.boxShadow = `inset 0 0 0 3px ${node.stroke.color}`;
    }
    label.append(thumb);
  } else {
    label.append(el("span", { class: "layer__thumb", style: { background: "linear-gradient(135deg,#fff 50%,#d0d0d0 50%)" } }));
  }
  const nameSpan = el("span", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, [node.name]);
  label.append(nameSpan);

  if (handlers && node.id === app._renamingId) {
    // reserved for inline rename
  }
  label.addEventListener("dblclick", (e) => {
    e.stopPropagation();
    app._renamingId = node.id;
    const input = el("input", { value: node.name, spellcheck: "false" });
    label.replaceChildren(input);
    input.focus();
    input.select();
    const finish = () => {
      app._renamingId = null;
      const next = input.value.trim();
      if (next && next !== node.name) {
        app.mutate("rename", () => { node.name = next; });
      }
      app.refreshPanels();
    };
    input.addEventListener("blur", finish);
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") input.blur();
      if (ev.key === "Escape") { input.value = node.name; input.blur(); }
    });
  });

  row.append(eye, lock, twisty, label);
  const count = node.children && node.children.length
    ? el("span", { class: "layer__count" }, [String(node.children.length)])
    : el("span", { class: "layer__count" });
  row.append(count);

  row.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    if (isLayer) {
      app.activeLayerId = node.id;
    }
    if (e.shiftKey && !isLayer) {
      app.setSelection(Array.from(new Set([...app.selection, node.id])));
    } else if (e.metaKey || e.ctrlKey) {
      app.setSelection(app.selection.includes(node.id)
        ? app.selection.filter((id) => id !== node.id)
        : [...app.selection, node.id]);
    } else if (!isLayer && !app.selection.includes(node.id)) {
      app.setSelection([node.id]);
    } else if (isLayer) {
      app.setSelection([]);
    }
    app.refreshPanels();
  });

  row.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isLayer) app.setSelection([node.id]);
    const r = row.getBoundingClientRect();
    showMenu(r.left + 40, r.top + 12, layerContextItems(app, node, isLayer));
  });

  return row;
}

function gradientCss(paint) {
  if (paint?.type === "gradient" || paint?.type === "radial") {
    const stops = (paint.stops || []).map((s) => `${s.color} ${Math.round(s.offset * 100)}%`).join(", ");
    return `linear-gradient(120deg, ${stops || "#fff, #888"})`;
  }
  return "#7a7a7a";
}

function layerContextItems(app, node, isLayer) {
  const items = [];
  if (!isLayer) {
    items.push({ label: "Bring to Front", shortcut: "⇧⌘]", action: () => app.arrange("front") });
    items.push({ label: "Bring Forward", shortcut: "⌘]", action: () => app.arrange("forward") });
    items.push({ label: "Send Backward", shortcut: "⌘[", action: () => app.arrange("backward") });
    items.push({ label: "Send to Back", shortcut: "⇧⌘[", action: () => app.arrange("back") });
    items.push({ separator: true });
  }
  items.push({ label: "Group", shortcut: "⌘G", disabled: app.selection.length < 2, action: () => app.groupSelection() });
  items.push({ label: "Ungroup", shortcut: "⇧⌘G", disabled: node.type !== "group", action: () => app.ungroupSelection() });
  items.push({ separator: true });
  items.push({ label: "Duplicate", shortcut: "⌘D", action: () => (isLayer ? app.duplicateLayer(node.id) : app.duplicateSelection()) });
  items.push({ label: "Delete", action: () => (isLayer ? app.deleteLayer(node.id) : app.deleteSelection()) });
  if (isLayer) {
    items.push({ separator: true });
    items.push({ label: "Show All Layers", action: () => { app.doc.layers.forEach((l) => { l.visible = true; }); app.requestRender(true); app.refreshPanels(); } });
    items.push({ label: "Hide Other Layers", action: () => { app.doc.layers.forEach((l) => { l.visible = l.id === node.id; }); app.requestRender(true); app.refreshPanels(); } });
  }
  return items;
}

/* ------------------------------------------------------------------ artboards */

function artboardsPanel(app) {
  const root = el("div", { class: "panel__body panel__body--flush" });
  const list = el("div", { class: "layers", style: { maxHeight: "190px" } });
  const form = el("div", { class: "panel__body", style: { gap: "6px" } });

  const preset = selectField({
    options: [
      { value: "custom", label: "Custom" },
      { value: "800x600", label: "Illustration 800 × 600" },
      { value: "1080x1080", label: "Social 1080 × 1080" },
      { value: "1920x1080", label: "HD 1920 × 1080" },
      { value: "595x842", label: "A4 Print (72 ppi)" },
      { value: "612x792", label: "US Letter (72 ppi)" },
    ],
    value: "800x600",
    onChange: (v) => {
      if (v === "custom") return;
      const [wv, hv] = v.split("x").map(Number);
      const ab = activeArtboard(app.doc);
      app.mutate("artboard-size", () => { ab.w = wv; ab.h = hv; });
      app.requestRender(true);
      app.refreshPanels();
    },
  });
  const wField = numField({ label: "W", value: 800, min: 1, dp: 0, onChange: (v) => { const ab = activeArtboard(app.doc); app.mutate("artboard-w", () => { ab.w = v; }); app.requestRender(true); } });
  const hField = numField({ label: "H", value: 600, min: 1, dp: 0, onChange: (v) => { const ab = activeArtboard(app.doc); app.mutate("artboard-h", () => { ab.h = v; }); app.requestRender(true); } });

  form.append(
    el("div", { class: "row" }, [el("span", { class: "label", style: { minWidth: "42px" } }, ["Preset"]), preset.el]),
    el("div", { class: "row row--tight" }, [wField.el, hField.el]),
    el("div", { class: "row row--tight" }, [
      button("New Artboard", { small: true, onClick: () => app.addArtboard() }),
      button("Fit to Artwork", { small: true, onClick: () => app.fitArtboardToArtwork() }),
      button("Delete", { small: true, onClick: () => app.deleteArtboard() }),
    ]),
  );

  root.append(list, form);

  const update = () => {
    list.replaceChildren();
    for (const ab of app.doc.artboards) {
      const row = el("div", {
        class: `layer${ab.id === app.doc.activeArtboardId ? " is-selected" : ""}`,
        style: { paddingLeft: "8px" },
      }, [
        el("span", { class: "layer__thumb", style: { width: "14px", height: "12px" } }),
        el("span", { style: { flex: "1", overflow: "hidden", textOverflow: "ellipsis" } }, [ab.name]),
        el("span", { class: "layer__count", style: { width: "auto", paddingRight: "8px" } }, [`${fmt(ab.w, 0)} × ${fmt(ab.h, 0)}`]),
      ]);
      row.addEventListener("click", () => {
        app.doc.activeArtboardId = ab.id;
        app.refreshPanels();
        app.requestRender(true);
      });
      row.addEventListener("dblclick", () => {
        const name = prompt("Artboard name", ab.name);
        if (name) { app.mutate("artboard-name", () => { ab.name = name; }); app.refreshPanels(); }
      });
      list.append(row);
    }
    const ab = activeArtboard(app.doc);
    wField.set(ab.w);
    hField.set(ab.h);
    preset.set(app.doc.artboards.length ? `${ab.w}x${ab.h}` : "custom");
  };

  return { el: root, update };
}

/* ------------------------------------------------------------------ colour */

function colorPanel(app) {
  const root = el("div", { class: "panel__body" });

  const proxy = el("div", { class: "proxy" });
  const fillBox = el("button", { class: "proxy__fill", title: "Fill" });
  const strokeBox = el("button", { class: "proxy__stroke", title: "Stroke" });
  proxy.append(fillBox, strokeBox);
  fillBox.addEventListener("click", () => { app.setTarget("fill"); app.refreshPanels(); });
  strokeBox.addEventListener("click", () => { app.setTarget("stroke"); app.refreshPanels(); });

  const spectrum = el("div", { class: "spectrum", title: "Hue" });
  const spectrumThumb = el("div", { class: "spectrum__thumb" });
  spectrum.append(spectrumThumb);

  const hex = textField({
    value: "#3b6ea5",
    onChange: (v) => {
      const color = v.startsWith("#") ? v : `#${v}`;
      if (/^#[0-9a-f]{6}$/i.test(color)) applyColor(color);
    },
  });
  const r = numField({ label: "R", value: 0, min: 0, max: 255, dp: 0, onChange: () => fromRgbFields() });
  const g = numField({ label: "G", value: 0, min: 0, max: 255, dp: 0, onChange: () => fromRgbFields() });
  const b = numField({ label: "B", value: 0, min: 0, max: 255, dp: 0, onChange: () => fromRgbFields() });
  const noneBtn = button("None", { small: true, onClick: () => applyColor(null) });

  const swatchGrid = el("div", { class: "swatch-grid" });

  const currentColor = () => {
    if (app.target === "fill") return app.currentFill()?.type === "gradient" ? app.currentFill().stops?.[0]?.color : app.currentFill()?.color;
    return app.currentStroke()?.color;
  };

  const applyColor = (color) => {
    app.applyColor(color);
    app.refreshPanels();
    app.requestRender(true);
  };

  const fromRgbFields = () => {
    const color = rgbToHex({ r: r.get(), g: g.get(), b: b.get() });
    applyColor(color);
  };

  let hue = 210;
  const setHue = (h) => {
    hue = h;
    spectrumThumb.style.left = `${(h / 360) * 100}%`;
    const cur = hexToHsv(hex.get() || "#3b6ea5");
    const next = hsvToHex({ h, s: cur.s, v: cur.v });
    hex.set(next);
    applyColor(next);
  };
  const scrubSpectrum = (e) => {
    const rect = spectrum.getBoundingClientRect();
    const t = clamp((e.clientX - rect.left) / rect.width, 0, 1);
    setHue(Math.round(t * 360));
  };
  let spectrumDrag = false;
  spectrum.addEventListener("pointerdown", (e) => {
    spectrumDrag = true;
    spectrum.setPointerCapture?.(e.pointerId);
    scrubSpectrum(e);
  });
  spectrum.addEventListener("pointermove", (e) => { if (spectrumDrag) scrubSpectrum(e); });
  spectrum.addEventListener("pointerup", () => { spectrumDrag = false; });
  spectrum.addEventListener("pointercancel", () => { spectrumDrag = false; });

  for (const color of SWATCHES) {
    swatchGrid.append(swatch(color, { onClick: () => applyColor(color) }));
  }
  const addSwatch = el("button", {
    class: "btn btn--sm",
    style: { width: "100%", marginTop: "2px" },
    text: "Add Current Color",
  });
  addSwatch.addEventListener("click", () => {
    const color = currentColor();
    if (!color) return;
    if (!SWATCHES.includes(color)) SWATCHES.push(color);
    app.toast(`Added ${color} to swatches`);
    app.refreshPanels();
  });

  root.append(
    el("div", { class: "row" }, [
      proxy,
      el("div", { class: "grow", style: { display: "flex", flexDirection: "column", gap: "5px" } }, [
        spectrum,
        el("div", { class: "row row--tight" }, [
          el("span", { class: "label" }, ["Hex"]),
          hex.el,
        ]),
      ]),
    ]),
    el("div", { class: "row row--tight" }, [r.el, g.el, b.el]),
    el("div", { class: "row" }, [
      el("span", { class: "label", text: "Swatches" }),
      el("span", { class: "spacer" }),
      noneBtn,
    ]),
    swatchGrid,
    addSwatch,
  );

  const update = () => {
    const color = currentColor() || "#808080";
    const hsv = hexToHsv(color);
    hue = hsv.h;
    spectrumThumb.style.left = `${(hsv.h / 360) * 100}%`;
    spectrumThumb.style.background = color;
    hex.set(color);
    const rgb = hexToRgb(color);
    r.set(rgb.r); g.set(rgb.g); b.set(rgb.b);
    paintChip(fillBox, app.currentFill());
    fillBox.classList.toggle("is-target", app.target === "fill");
    const st = app.currentStroke();
    strokeBox.classList.toggle("is-target", app.target === "stroke");
    if (st) {
      strokeBox.style.background = st.color;
      strokeBox.classList.remove("proxy__none");
    } else {
      strokeBox.style.background = "";
      strokeBox.classList.add("proxy__none");
    }
  };

  return { el: root, update };
}

/* ------------------------------------------------------------------ swatches */

function swatchesPanel(app) {
  const root = el("div", { class: "panel__body" });
  const grid = el("div", { class: "swatch-grid" });
  root.append(
    el("div", { class: "row" }, [el("span", { class: "label" }, ["Document Swatches"]), el("span", { class: "spacer" })]),
    grid,
    el("div", { class: "row" }, [
      button("New Swatch", { small: true, onClick: () => {
        const color = (app.target === "fill" ? app.currentFill()?.color : app.currentStroke()?.color) || "#000000";
        if (!SWATCHES.includes(color)) SWATCHES.push(color);
        app.refreshPanels();
      } }),
      button("Select All Unused", { small: true, onClick: () => app.toast("All swatches are in use") }),
    ]),
    el("div", { class: "empty-state", text: "Click a swatch to apply it to the selected fill or stroke." }),
  );
  const update = () => {
    grid.replaceChildren();
    const current = (app.target === "fill" ? app.currentFill()?.color : app.currentStroke()?.color) || "";
    for (const color of SWATCHES) {
      grid.append(swatch(color, {
        active: color.toLowerCase() === String(current).toLowerCase(),
        onClick: () => { app.applyColor(color); app.requestRender(true); app.refreshPanels(); },
      }));
    }
  };
  return { el: root, update };
}

/* ------------------------------------------------------------------ gradient */

function gradientPanel(app) {
  const root = el("div", { class: "panel__body" });
  const typeSelect = selectField({
    options: [{ value: "linear", label: "Linear Gradient" }, { value: "radial", label: "Radial Gradient" }],
    value: "linear",
    onChange: (v) => {
      const fill = app.currentFill();
      const base = fill && (fill.type === "gradient" || fill.type === "radial")
        ? JSON.parse(JSON.stringify(fill))
        : { stops: [{ offset: 0, color: "#ffffff" }, { offset: 1, color: "#000000" }], angle: 90 };
      base.type = v;
      app.applyFillPaint(base);
      app.requestRender(true);
      app.refreshPanels();
    },
  });
  const angle = numField({ label: "∠", value: 90, min: -360, max: 360, dp: 0, width: 66, onChange: (v) => setGradient({ angle: v }) });
  const bar = el("div", { class: "gradient-bar" });
  const stopColor = textField({ value: "#000000", onChange: (v) => {
    if (!selectedStop) return;
    setStopColor(v);
  } });
  const reverseBtn = iconButton("flipH", { title: "Reverse Gradient", onClick: () => {
    const fill = app.currentFill();
    if (!fill || fill.type !== "gradient") return;
    const next = JSON.parse(JSON.stringify(fill));
    next.stops = next.stops.map((s) => ({ ...s, offset: 1 - s.offset })).reverse();
    app.applyFillPaint(next);
    app.refreshPanels();
  } });
  const addStopBtn = iconButton("plus", { title: "Add Stop", onClick: () => {
    const fill = app.currentFill();
    if (!fill || fill.type !== "gradient") return;
    const stops = fill.stops.slice().sort((a, b2) => a.offset - b2.offset);
    const next = JSON.parse(JSON.stringify(fill));
    const mid = 0.5;
    const color = stops.length ? stops[Math.floor(stops.length / 2)].color : "#ffffff";
    next.stops.push({ offset: mid, color });
    app.applyFillPaint(next);
    app.refreshPanels();
  } });
  const removeStopBtn = iconButton("minus", { title: "Remove Stop", onClick: () => {
    const fill = app.currentFill();
    if (!fill || !selectedStop || fill.stops.length <= 2) return;
    const next = JSON.parse(JSON.stringify(fill));
    next.stops.splice(selectedStop, 1);
    selectedStop = null;
    app.applyFillPaint(next);
    app.refreshPanels();
  } });

  let selectedStop = null;

  const setGradient = (patch) => {
    const fill = app.currentFill();
    if (!fill || fill.type !== "gradient") return;
    app.applyFillPaint({ ...JSON.parse(JSON.stringify(fill)), ...patch });
    app.requestRender(true);
  };

  const setStopColor = (color) => {
    const fill = app.currentFill();
    if (!fill || !selectedStop) return;
    const next = JSON.parse(JSON.stringify(fill));
    next.stops[selectedStop].color = color;
    app.applyFillPaint(next);
    app.requestRender(true);
  };

  const renderBar = () => {
    const fill = app.currentFill();
    bar.replaceChildren();
    if (!fill || fill.type !== "gradient") {
      bar.style.background = "#4a4a4a";
      return;
    }
    const stops = fill.stops.slice().sort((a, b) => a.offset - b.offset);
    bar.style.background = `linear-gradient(90deg, ${stops.map((s) => `${s.color} ${Math.round(s.offset * 100)}%`).join(", ")})`;
    fill.stops.forEach((stop, index) => {
      const handle = el("div", {
        class: `gradient-stop${index === selectedStop ? " is-active" : ""}`,
        style: { left: `${stop.offset * 100}%`, background: stop.color },
        title: stop.color,
      });
      handle.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        selectedStop = index;
        stopColor.set(stop.color);
        renderBar();
        const move = (ev) => {
          const rect = bar.getBoundingClientRect();
          const offset = clamp((ev.clientX - rect.left) / rect.width, 0, 1);
          const next = JSON.parse(JSON.stringify(app.currentFill()));
          next.stops[index].offset = offset;
          app.applyFillPaint(next);
          renderBar();
        };
        const up = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
          app.refreshPanels();
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      });
      bar.append(handle);
    });
  };

  bar.addEventListener("pointerdown", (e) => {
    const fill = app.currentFill();
    if (!fill || fill.type !== "gradient") return;
    const rect = bar.getBoundingClientRect();
    const offset = clamp((e.clientX - rect.left) / rect.width, 0, 1);
    const sorted = fill.stops.slice().sort((a, b) => a.offset - b.offset);
    let color = "#ffffff";
    for (let i = 0; i < sorted.length - 1; i++) {
      if (offset >= sorted[i].offset && offset <= sorted[i + 1].offset) {
        color = offset - sorted[i].offset < sorted[i + 1].offset - offset ? sorted[i].color : sorted[i + 1].color;
      }
    }
    const next = JSON.parse(JSON.stringify(fill));
    next.stops.push({ offset, color });
    selectedStop = next.stops.length - 1;
    app.applyFillPaint(next);
    app.refreshPanels();
  });

  root.append(
    el("div", { class: "row" }, [typeSelect.el]),
    el("div", { class: "row" }, [
      el("span", { class: "label", style: { minWidth: "34px" } }, ["Angle"]),
      angle.el,
      el("span", { class: "spacer" }),
      reverseBtn, addStopBtn, removeStopBtn,
    ]),
    bar,
    el("div", { class: "row" }, [
      el("span", { class: "label", style: { minWidth: "34px" } }, ["Stop"]),
      stopColor.el,
    ]),
    el("div", { class: "dialog__hint", text: "Click the gradient bar to add a stop; drag stops to move them." }),
  );

  const update = () => {
    const fill = app.currentFill();
    const isGradient = fill?.type === "gradient" || fill?.type === "radial";
    typeSelect.set(fill?.type === "radial" ? "radial" : "linear");
    root.querySelectorAll(".num, .text-input, .gradient-bar").forEach((n) => { n.style.opacity = isGradient ? "1" : "0.5"; });
    if (isGradient) {
      angle.set(fill.angle ?? 90);
      if (selectedStop == null && fill.stops.length) {
        selectedStop = 0;
      }
      const stop = fill.stops[selectedStop];
      if (stop) stopColor.set(stop.color);
      renderBar();
    } else {
      bar.style.background = "#3d3d3d";
      bar.replaceChildren();
    }
  };

  return { el: root, update };
}

/* ------------------------------------------------------------------ appearance */

function appearancePanel(app) {
  const root = el("div", { class: "panel__body" });
  const list = el("div", { class: "appearance-list" });
  const addFill = button("Add New Fill", { small: true, onClick: () => {
    if (!app.selection.length) return;
    app.mutate("add-fill", () => {
      for (const n of app.selectionNodes()) n.fill = { type: "solid", color: app.fill?.color || "#2d8ceb" };
    });
    app.requestRender(true);
    app.refreshPanels();
  } });
  const clearAppearance = iconButton("trash", { title: "Clear Appearance", onClick: () => {
    app.mutate("clear-appearance", () => {
      for (const n of app.selectionNodes()) { n.fill = null; n.stroke = null; }
    });
    app.requestRender(true);
    app.refreshPanels();
  } });
  const opacitySlider = slider({
    value: 100, min: 0, max: 100, step: 1,
    onChange: (v) => app.setOpacity(v / 100),
  });

  root.append(
    el("div", { class: "row" }, [
      el("span", { class: "label", text: "Appearance" }),
      el("span", { class: "spacer" }),
      clearAppearance,
    ]),
    list,
    el("div", { class: "row row--tight" }, [
      el("span", { class: "label", text: "Opacity" }),
      opacitySlider.el,
    ]),
    el("div", { class: "row row--wrap" }, [
      addFill,
      button("Add Stroke", { small: true, onClick: () => {
        if (!app.selection.length) return;
        app.mutate("add-stroke", () => {
          for (const n of app.selectionNodes()) n.stroke = { ...app.newStroke() };
        });
        app.requestRender(true);
        app.refreshPanels();
      } }),
    ]),
  );

  const update = () => {
    list.replaceChildren();
    const nodes = app.selectionNodes();
    if (!nodes.length) {
      list.append(el("div", { class: "empty-state", text: "No selection. Appearance applies to new artwork." }));
      opacitySlider.set(100);
      return;
    }
    const first = nodes[0];
    opacitySlider.set(Math.round((first.opacity ?? 1) * 100));
    const rows = [];
    if (first.fill) rows.push({ kind: "fill", label: first.fill.type === "radial" ? "Radial Fill" : first.fill.type === "gradient" ? "Gradient Fill" : "Fill", paint: first.fill });
    if (first.stroke) rows.push({ kind: "stroke", label: "Stroke", paint: { type: "solid", color: first.stroke.color }, stroke: first.stroke });
    if (!rows.length) rows.push({ kind: "none", label: "No Fill or Stroke" });
    for (const row of rows) {
      const rowEl = el("div", { class: `appearance-row${app.target === row.kind ? " is-active" : ""}` }, [
        el("button", { class: "appearance-row__eye", html: icon("eye", 12), title: "Toggle visibility" }),
        (() => {
          const chip = el("div", { class: "appearance-row__swatch" });
          if (row.paint) paintChip(chip, row.paint);
          else chip.classList.add("proxy__none");
          chip.style.width = "16px";
          chip.style.height = "14px";
          return chip;
        })(),
        el("span", { text: row.label }),
        el("span", { class: "appearance-row__value", text: row.kind === "stroke" ? `${fmt(row.stroke.width, 2)} px` : row.kind === "fill" ? (row.paint.type === "gradient" ? "Linear" : row.paint.type === "radial" ? "Radial" : row.paint.color) : "" }),
      ]);
      rowEl.addEventListener("click", () => {
        app.setTarget(row.kind === "stroke" ? "stroke" : "fill");
        app.refreshPanels();
      });
      list.append(rowEl);
    }
    list.append(el("div", { class: "appearance-row" }, [
      el("button", { class: "appearance-row__eye", html: icon("transparency", 12) }),
      el("div", { class: "appearance-row__swatch", style: { background: "linear-gradient(90deg,#fff,#999)", width: "16px", height: "14px" } }),
      el("span", { text: "Opacity" }),
      el("span", { class: "appearance-row__value", text: `${Math.round((first.opacity ?? 1) * 100)}%` }),
    ]));
  };

  return { el: root, update };
}

/* ------------------------------------------------------------------ stroke */

function strokePanel(app) {
  const root = el("div", { class: "panel__body" });
  const weight = numField({ label: "W", value: 1, min: 0, max: 500, step: 0.5, dp: 2, width: 74, onChange: (v) => app.setStrokeProp("width", v) });
  const weightSlider = slider({ value: 1, min: 0, max: 24, step: 0.5, onChange: (v) => { weight.set(v); app.setStrokeProp("width", v); } });
  const capSeg = segmented([
    { value: "butt", icon: "capButt", title: "Butt Cap" },
    { value: "round", icon: "capRound", title: "Round Cap" },
    { value: "square", icon: "capSquare", title: "Projecting Cap" },
  ], { value: "butt", onChange: (v) => app.setStrokeProp("cap", v) });
  const joinSeg = segmented([
    { value: "miter", icon: "joinMiter", title: "Miter Join" },
    { value: "round", icon: "joinRound", title: "Round Join" },
    { value: "bevel", icon: "joinBevel", title: "Bevel Join" },
  ], { value: "miter", onChange: (v) => app.setStrokeProp("join", v) });
  const dashSelect = selectField({
    options: [
      { value: "", label: "Solid Line" },
      { value: "4 3", label: "Dashed 4 / 3" },
      { value: "1 3", label: "Dotted 1 / 3" },
      { value: "8 4 2 4", label: "Dash Dot" },
      { value: "12 6", label: "Long Dash" },
      { value: "2 2", label: "Fine Dash" },
    ],
    value: "",
    onChange: (v) => app.setStrokeProp("dash", v ? v.split(" ").map(Number) : []),
  });
  const profile = selectField({
    options: [
      { value: "uniform", label: "Uniform" },
      { value: "taper", label: "Tapered" },
    ],
    value: "uniform",
    onChange: () => app.toast("Variable-width profiles are not available in this build"),
  });
  const dashPresets = el("div", { class: "stroke-presets" });
  for (const [title, dash, thickness] of [
    ["1 pt", [], 1], ["2 pt", [], 2], ["3 pt", [], 3], ["4 pt", [], 4],
    ["Dashed", [4, 3], 2], ["Dotted", [1, 3], 2], ["Dash Dot", [8, 4, 2, 4], 2],
  ]) {
    const b = el("button", { class: "stroke-preset", title: `${title} stroke` }, [
      el("div", { class: "stroke-preset__bar", style: { height: `${thickness}px` } }),
    ]);
    b.addEventListener("click", () => {
      app.setStrokeProp("width", thickness);
      app.setStrokeProp("dash", dash);
      app.refreshPanels();
    });
    dashPresets.append(b);
  }

  root.append(
    el("div", { class: "row" }, [
      el("span", { class: "label", style: { minWidth: "34px" } }, ["Weight"]),
      weight.el,
      el("span", { class: "spacer" }),
      el("span", { class: "label" }, ["px"]),
    ]),
    weightSlider.el,
    el("div", { class: "row" }, [
      el("span", { class: "label", style: { minWidth: "34px" } }, ["Cap"]), capSeg.el,
      el("span", { class: "label", style: { marginLeft: "8px" } }, ["Join"]), joinSeg.el,
    ]),
    el("div", { class: "row" }, [
      el("span", { class: "label", style: { minWidth: "34px" } }, ["Dash"]),
      dashSelect.el,
    ]),
    el("div", { class: "row" }, [
      el("span", { class: "label", style: { minWidth: "34px" } }, ["Profile"]),
      profile.el,
    ]),
    dashPresets,
    el("div", { class: "row" }, [
      button("Outline Stroke", { small: true, onClick: () => app.outlineStroke() }),
      button("Reset", { small: true, onClick: () => {
        app.setStrokeProp("width", 1);
        app.setStrokeProp("dash", []);
        app.refreshPanels();
      } }),
    ]),
  );

  const update = () => {
    const stroke = app.currentStrokeWithDefaults();
    weight.set(stroke.width);
    weightSlider.set(stroke.width);
    capSeg.set(stroke.cap || "butt");
    joinSeg.set(stroke.join || "miter");
    const dash = (stroke.dash || []).join(" ");
    dashSelect.set(dash);
    if (dashSelect.input.value !== dash) dashSelect.input.value = "";
  };

  return { el: root, update };
}

/* ------------------------------------------------------------------ transparency */

function transparencyPanel(app) {
  const root = el("div", { class: "panel__body" });
  const opacity = numField({ label: "", value: 100, min: 0, max: 100, dp: 0, width: 58, onChange: (v) => app.setOpacity(v / 100) });
  const opacitySlider = slider({ value: 100, min: 0, max: 100, step: 1, onChange: (v) => { opacity.set(v); app.setOpacity(v / 100); } });
  const blend = selectField({
    options: [
      { value: "source-over", label: "Normal" },
      { value: "multiply", label: "Multiply" },
      { value: "screen", label: "Screen" },
      { value: "overlay", label: "Overlay" },
      { value: "darken", label: "Darken" },
      { value: "lighten", label: "Lighten" },
      { value: "color-dodge", label: "Color Dodge" },
      { value: "color-burn", label: "Color Burn" },
      { value: "hard-light", label: "Hard Light" },
      { value: "soft-light", label: "Soft Light" },
      { value: "difference", label: "Difference" },
      { value: "exclusion", label: "Exclusion" },
      { value: "hue", label: "Hue" },
      { value: "saturation", label: "Saturation" },
      { value: "color", label: "Color" },
      { value: "luminosity", label: "Luminosity" },
    ],
    value: "source-over",
    onChange: (v) => {
      app.mutate("blend", () => {
        for (const n of app.selectionNodes()) n.blendMode = v;
      });
      app.requestRender(true);
    },
  });
  const isolate = checkbox("Isolate Blending", { onChange: () => app.toast("Isolate blending is a group-level preview hint") });

  root.append(
    el("div", { class: "row" }, [
      el("span", { class: "label", style: { minWidth: "34px" } }, ["Opacity"]),
      opacity.el, el("span", { class: "label" }, ["%"]),
    ]),
    opacitySlider.el,
    el("div", { class: "row" }, [
      el("span", { class: "label", style: { minWidth: "34px" } }, ["Blend"]),
      blend.el,
    ]),
    isolate.el,
    el("div", { class: "dialog__hint", text: "Transparency affects the selected artwork and composites against the artboard." }),
  );

  const update = () => {
    const first = app.selectionNodes()[0];
    const value = Math.round((first?.opacity ?? 1) * 100);
    opacity.set(value);
    opacitySlider.set(value);
    blend.set(first?.blendMode || "source-over");
  };
  return { el: root, update };
}

/* ------------------------------------------------------------------ align */

function alignPanel(app) {
  const root = el("div", { class: "panel__body" });
  const keySelect = selectField({
    options: [
      { value: "selection", label: "Align to Selection" },
      { value: "artboard", label: "Align to Artboard" },
      { value: "key", label: "Align to Key Object" },
    ],
    value: "selection",
    onChange: (v) => { app.alignTo = v; },
  });

  const grid = el("div", { class: "align-grid", style: { gridTemplateColumns: "repeat(6, 1fr)", gap: "3px" } });
  const defs = [
    ["alignLeft", "horizontalAlignLeft"], ["alignCenterH", "horizontalAlignCenter"], ["alignRight", "horizontalAlignRight"],
    ["alignTop", "verticalAlignTop"], ["alignCenterV", "verticalAlignCenter"], ["alignBottom", "verticalAlignBottom"],
    ["distributeH", "distributeHorizontalCenter"], ["distributeV", "distributeVerticalCenter"],
    ["spaceH", "distributeSpacingHorizontal"], ["spaceV", "distributeSpacingVertical"],
  ];
  for (const [ic, mode] of defs) {
    const isDistribute = mode.startsWith("distribute");
    const b = el("button", { class: "align-btn", html: icon(ic, 16), title: mode.replace(/([A-Z])/g, " $1").toLowerCase() });
    b.addEventListener("click", () => app.align(isDistribute ? "distribute" : "align", mode));
    grid.append(b);
  }

  const spacing = numField({ label: "", value: 10, min: 0, dp: 1, width: 60, onChange: (v) => { app.spacing = v; } });

  root.append(
    el("div", { class: "row" }, [keySelect.el]),
    grid,
    el("div", { class: "row" }, [
      el("span", { class: "label", style: { minWidth: "34px" } }, ["Spacing"]),
      spacing.el,
      el("span", { class: "label" }, ["px"]),
      el("span", { class: "spacer" }),
      iconButton("alignLeft", { title: "Align to Artboard", onClick: () => app.align("align", "horizontalAlignLeft", true) }),
      iconButton("alignTop", { title: "Align Top to Artboard", onClick: () => app.align("align", "verticalAlignTop", true) }),
    ]),
    el("div", { class: "row row--tight" }, [
      button("Horizontal Distribute", { small: true, onClick: () => app.align("distribute", "distributeHorizontalCenter") }),
      button("Vertical Center", { small: true, onClick: () => app.align("align", "verticalAlignCenter") }),
    ]),
    el("div", { class: "dialog__hint", text: "Select objects to align. With one object selected, alignment uses the active artboard." }),
  );

  return { el: root, update: () => {} };
}

/* ------------------------------------------------------------------ pathfinder */

function pathfinderPanel(app) {
  const root = el("div", { class: "panel__body" });
  const grid = el("div", { class: "pf-grid", style: { gridTemplateColumns: "repeat(5, 1fr)" } });
  const defs = [
    ["unite", "Unite", "Adds the front shapes to the back shape"],
    ["minusFront", "Minus Front", "Subtracts the front shapes from the back shape"],
    ["intersect", "Intersect", "Keeps only the overlapping region"],
    ["exclude", "Exclude", "Keeps the non-overlapping regions"],
    ["divide", "Divide", "Splits overlapping artwork into pieces"],
    ["minusBack", "Minus Back", "Subtracts the back shape from the front shapes"],
    ["trim", "Trim", "Removes hidden parts of overlapping shapes"],
    ["merge", "Merge", "Joins shapes with the same fill"],
    ["cropPF", "Crop", "Crops artwork to the frontmost shape"],
    ["outlinePF", "Outline", "Converts fills to outlines"],
  ];
  for (const [ic, label, tip] of defs) {
    const b = el("button", { class: "pf-btn", html: icon(ic, 17), title: `${label} — ${tip}` });
    b.addEventListener("click", () => app.applyPathfinder(ic));
    grid.append(b);
  }
  const mode = selectField({
    options: [{ value: "unite", label: "Unite" }, { value: "minusFront", label: "Minus Front" }, { value: "intersect", label: "Intersect" }, { value: "exclude", label: "Exclude" }],
    value: "unite",
  });
  root.append(
    grid,
    el("div", { class: "row row--tight" }, [
      button("Unite", { small: true, onClick: () => app.applyPathfinder("unite") }),
      button("Minus Front", { small: true, onClick: () => app.applyPathfinder("minusFront") }),
      button("Intersect", { small: true, onClick: () => app.applyPathfinder("intersect") }),
    ]),
    el("div", { class: "dialog__hint", text: "Pathfinder operations use the shape stacking order: the backmost selected shape receives minus-front subtractions." }),
    el("div", { class: "row" }, [el("span", { class: "label", style: { minWidth: "34px" } }, ["Mode"]), mode.el]),
  );
  return { el: root, update: () => {} };
}

/* ------------------------------------------------------------------ transform */

function transformPanel(app) {
  const root = el("div", { class: "panel__body" });
  const reference = el("div", { class: "row", style: { justifyContent: "center", gap: "1px" } });
  const refGrid = el("div", { style: { display: "grid", gridTemplateColumns: "repeat(3, 14px)", gridAutoRows: "14px", gap: "2px" } });
  let refPoint = "center";
  for (let y = 0; y < 3; y++) {
    for (let x = 0; x < 3; x++) {
      const key = `${["top", "center", "bottom"][y]}-${["left", "center", "right"][x]}`;
      const dot = el("button", {
        style: {
          width: "12px", height: "12px", border: "1px solid var(--field-border)",
          background: key === refPoint ? "var(--accent)" : "var(--field)", borderRadius: "1px",
        },
        title: `Reference point: ${key}`,
      });
      dot.addEventListener("click", () => {
        refPoint = key;
        refGrid.querySelectorAll("button").forEach((n, i) => {
          n.style.background = `${["top-left", "top-center", "top-right", "center-left", "center-center", "center-right", "bottom-left", "bottom-center", "bottom-right"][i]}` === key ? "var(--accent)" : "var(--field)";
        });
        app.refPoint = key;
      });
      refGrid.append(dot);
    }
  }
  reference.append(refGrid);

  const angleField = numField({ label: "∠", value: 0, dp: 1, width: 70, onChange: (v) => {
    if (!app.selection.length) return;
    app.mutate("rotate-field", () => {
      app.rotateSelection(v - (app._rotationFieldValue || 0));
    });
    app._rotationFieldValue = v;
  }});
  const shearField = numField({ label: "⤢", value: 0, dp: 1, width: 70, onChange: (v) => {
    if (!app.selection.length) return;
    app.mutate("shear-field", () => app.shearSelection(v - (app._shearFieldValue || 0)));
    app._shearFieldValue = v;
  }});
  const flipH = iconButton("flipH", { title: "Flip Horizontal", onClick: () => app.flipSelection("h") });
  const flipV = iconButton("flipV", { title: "Flip Vertical", onClick: () => app.flipSelection("v") });
  const rotateL = iconButton("rotateLeft", { title: "Rotate 90° Counter-clockwise", onClick: () => app.mutate("rotate", () => app.rotateSelection(-90)) });
  const rotateR = iconButton("rotateRight", { title: "Rotate 90° Clockwise", onClick: () => app.mutate("rotate", () => app.rotateSelection(90)) });

  root.append(
    el("div", { class: "row" }, [
      el("span", { class: "label", style: { minWidth: "34px" } }, ["Ref"]),
      reference,
      el("span", { class: "spacer" }),
      rotateL, rotateR, flipH, flipV,
    ]),
    el("div", { class: "row row--tight" }, [angleField.el, shearField.el]),
    el("div", { class: "row row--tight" }, [
      button("Rotate 45°", { small: true, onClick: () => app.mutate("rotate", () => app.rotateSelection(45)) }),
      button("Reset Rotation", { small: true, onClick: () => app.toast("Rotation is baked into path coordinates") }),
    ]),
    el("div", { class: "dialog__hint", text: "Transforms apply around the selected reference point." }),
  );
  return { el: root, update: () => {} };
}

/* ------------------------------------------------------------------ character */

function characterPanel(app) {
  const root = el("div", { class: "panel__body" });
  const family = selectField({
    options: FONT_FAMILIES.map((f) => ({ value: f, label: FAMILY_LABELS[f] || f })),
    value: FONT_FAMILIES[0],
    onChange: (v) => app.setTextProps({ fontFamily: v }),
  });
  const size = numField({ label: "", value: 36, min: 1, max: 400, dp: 1, width: 52, onChange: (v) => app.setTextProps({ fontSize: v }) });
  const leading = numField({ label: "", value: 43, min: 1, dp: 1, width: 52, onChange: (v) => app.setTextProps({ lineHeight: v }) });
  const tracking = numField({ label: "", value: 0, min: -20, max: 100, dp: 1, width: 52, onChange: (v) => app.setTextProps({ letterSpacing: v }) });
  const weight = selectField({
    options: [
      { value: "300", label: "Light" },
      { value: "400", label: "Regular" },
      { value: "500", label: "Medium" },
      { value: "600", label: "Semibold" },
      { value: "700", label: "Bold" },
      { value: "800", label: "Extra Bold" },
      { value: "900", label: "Black" },
    ],
    value: "400",
    onChange: (v) => app.setTextProps({ fontWeight: Number(v) }),
  });
  const italicBtn = iconButton("italic", { title: "Italic", onClick: () => {
    const node = app.selectionNodes().find((n) => n.type === "text");
    app.setTextProps({ fontStyle: node?.fontStyle === "italic" ? "normal" : "italic" });
    app.refreshPanels();
  } });
  const boldBtn = iconButton("bold", { title: "Bold", onClick: () => {
    const node = app.selectionNodes().find((n) => n.type === "text");
    app.setTextProps({ fontWeight: node?.fontWeight === 700 ? 400 : 700 });
    app.refreshPanels();
  } });
  const alignRow = el("div", { class: "character-style-row" });
  for (const [ic, value, title] of [["typeLeft", "left", "Align Left"], ["typeCenter", "center", "Align Center"], ["typeRight", "right", "Align Right"], ["typeJustify", "justify", "Justify"]]) {
    const b = iconButton(ic, { title, onClick: () => { app.setTextProps({ align: value }); app.refreshPanels(); } });
    b.dataset.align = value;
    alignRow.append(b);
  }
  const colorBtn = el("button", { class: "appearance-row__swatch", title: "Type Color" });
  colorBtn.style.width = "20px"; colorBtn.style.height = "20px";
  colorBtn.addEventListener("click", () => { app.setTarget("fill"); app.refreshPanels(); });
  const editBtn = button("Edit Text", { small: true, onClick: () => {
    const node = app.selectionNodes().find((n) => n.type === "text");
    if (node) app.beginTextEdit(node);
  } });

  root.append(
    el("div", { class: "row" }, [el("span", { class: "label", style: { minWidth: "34px" } }, ["Font"]), family.el]),
    el("div", { class: "row row--tight" }, [
      el("span", { class: "label", style: { minWidth: "34px" } }, ["Style"]), weight.el, italicBtn, boldBtn,
    ]),
    gridRow(3, [size.el, leading.el, tracking.el]),
    el("div", { class: "row" }, [
      el("span", { class: "label", style: { minWidth: "34px" } }, ["Align"]), alignRow,
      el("span", { class: "spacer" }), colorBtn,
    ]),
    el("div", { class: "row" }, [
      editBtn,
      button("Convert to Outlines", { small: true, onClick: () => app.convertTextToOutlines() }),
    ]),
    el("div", { class: "dialog__hint", text: "Double-click type on the canvas to edit it in place." }),
  );

  const update = () => {
    const node = app.selectionNodes().find((n) => n.type === "text");
    const enabled = !!node;
    root.style.opacity = enabled ? "1" : "0.6";
    if (!node) return;
    family.set(node.fontFamily);
    size.set(node.fontSize);
    leading.set(node.lineHeight || node.fontSize * 1.2);
    tracking.set(node.letterSpacing || 0);
    weight.set(String(node.fontWeight || 400));
    alignRow.querySelectorAll(".icon-btn").forEach((b) => b.classList.toggle("is-active", b.dataset.align === node.align));
    italicBtn.classList.toggle("is-active", node.fontStyle === "italic");
    boldBtn.classList.toggle("is-active", (node.fontWeight || 400) >= 700);
    colorBtn.style.background = node.fill?.color || "#000";
  };

  return { el: root, update };
}

/* ------------------------------------------------------------------ paragraph */

function paragraphPanel(app) {
  const root = el("div", { class: "panel__body" });
  const alignRow = el("div", { class: "character-style-row" });
  for (const [ic, value, title] of [["typeLeft", "left", "Align Left"], ["typeCenter", "center", "Align Center"], ["typeRight", "right", "Align Right"], ["typeJustify", "justify", "Justify All Lines"]]) {
    alignRow.append(iconButton(ic, { title, onClick: () => { app.setTextProps({ align: value }); app.refreshPanels(); } }));
  }
  const indentL = numField({ label: "L", value: 0, dp: 1, width: 62, onChange: () => app.toast("Indents are not available in this build") });
  const spaceBefore = numField({ label: "B", value: 0, dp: 1, width: 62, onChange: () => app.toast("Space before/after is not available in this build") });
  root.append(
    el("div", { class: "row" }, [
      el("span", { class: "label", style: { minWidth: "34px" } }, ["Align"]), alignRow,
    ]),
    el("div", { class: "row row--tight" }, [indentL.el, spaceBefore.el]),
    el("div", { class: "empty-state", text: "Paragraph alignment applies to the active type object." }),
  );
  return { el: root, update: () => {} };
}

/* ------------------------------------------------------------------ REA */

function reaPanel(app) {
  const root = el("div", { class: "panel__body" });
  const stats = el("div", { class: "rea-audit" });
  const evidence = el("div", { class: "rea-evidence" });
  const actions = el("div", { class: "rea-actions" });
  const header = el("div", { class: "row" }, [
    el("span", { class: "label", style: { display: "flex", alignItems: "center", gap: "4px" } }, [
      el("span", { html: icon("rea", 12), style: { color: "var(--accent)" } }),
      "REA · document evidence",
    ]),
  ]);

  const analyzeBtn = button("Analyze Document", { small: true, onClick: () => {
    app.rea.analyze(app.doc);
    app.refreshPanels();
  } });
  const exportBtn = button("Export JSON", { small: true, onClick: () => app.rea.exportEvidence() });
  const copyBtn = button("Copy Digest", { small: true, onClick: () => app.rea.copyDigest() });
  const svgBtn = button("Inspect SVG", { small: true, onClick: () => app.rea.inspectSvg(app) });

  actions.append(analyzeBtn, exportBtn, copyBtn, svgBtn);
  root.append(header, stats, evidence, actions);
  root.append(el("div", {
    class: "dialog__hint",
    text: "VectorStudio records structural evidence for every edit: object counts, path topology, paint usage and a content digest. Export it as JSON for review in REA.",
  }));

  const update = () => {
    const report = app.rea.report || app.rea.analyze(app.doc);
    stats.replaceChildren(
      statRow("Objects", report.objects),
      statRow("Paths / nodes", `${report.paths} / ${report.nodes}`),
      statRow("Layers", report.layers),
      statRow("Fills / strokes", `${report.fills} / ${report.strokes}`),
      statRow("Colors", report.colors.length),
      statRow("Digest", report.digest),
    );
    evidence.textContent = report.log.slice(0, 8).map((l) => `${l.time}  ${l.label}`).join("\n") || "No operations recorded yet.";
  };

  return { el: root, update };
}

function statRow(label, value) {
  return el("div", { class: "rea-stat" }, [
    el("span", { class: "rea-stat__label", text: label }),
    el("span", { class: "rea-stat__value", text: String(value) }),
  ]);
}

/* ================================================================== manager */

export class PanelDock {
  constructor(app, root) {
    this.app = app;
    this.root = root;
    this.groups = [
      {
        id: "properties",
        tabs: [{ id: "properties", title: "Properties", build: propertiesPanel }],
      },
      {
        id: "layers",
        tabs: [
          { id: "layers", title: "Layers", build: layersPanel },
          { id: "artboards", title: "Artboards", build: artboardsPanel },
        ],
      },
      {
        id: "color",
        tabs: [
          { id: "color", title: "Color", build: colorPanel },
          { id: "swatches", title: "Swatches", build: swatchesPanel },
          { id: "gradient", title: "Gradient", build: gradientPanel },
        ],
      },
      {
        id: "appearance",
        tabs: [
          { id: "appearance", title: "Appearance", build: appearancePanel },
          { id: "transparency", title: "Transparency", build: transparencyPanel },
        ],
      },
      {
        id: "stroke",
        tabs: [{ id: "stroke", title: "Stroke", build: strokePanel }],
      },
      {
        id: "align",
        tabs: [
          { id: "align", title: "Align", build: alignPanel },
          { id: "pathfinder", title: "Pathfinder", build: pathfinderPanel },
          { id: "transform", title: "Transform", build: transformPanel },
        ],
      },
      {
        id: "type",
        tabs: [
          { id: "character", title: "Character", build: characterPanel },
          { id: "paragraph", title: "Paragraph", build: paragraphPanel },
        ],
      },
      {
        id: "rea",
        tabs: [{ id: "rea", title: "REA Analysis", build: reaPanel }],
      },
    ];
    this.panels = [];
    this.mount();
  }

  mount() {
    for (const groupDef of this.groups) {
      const section = el("section", { class: "panel", dataset: { group: groupDef.id } });
      const header = el("div", { class: "panel__header" });
      const tabs = el("div", { class: "panel__tabs", role: "tablist" });
      const actions = el("div", { class: "panel__actions" });
      const bodies = [];
      let active = 0;

      groupDef.tabs.forEach((tabDef, index) => {
        const built = tabDef.build(this.app);
        const body = el("div", { class: "panel__tabs-body" });
        body.append(built.el);
        body.style.display = index === 0 ? "flex" : "none";
        bodies.push({ body, built, tabDef });
        const tab = el("button", {
          class: `panel__tab${index === 0 ? " is-active" : ""}`,
          role: "tab",
          "aria-selected": index === 0 ? "true" : "false",
        }, [tabDef.title]);
        tab.addEventListener("click", () => {
          active = index;
          tabs.querySelectorAll(".panel__tab").forEach((t, i) => {
            t.classList.toggle("is-active", i === index);
            t.setAttribute("aria-selected", i === index ? "true" : "false");
          });
          bodies.forEach((b, i) => { b.body.style.display = i === index ? "flex" : "none"; });
          this.update();
        });
        tabs.append(tab);
        section.append(body);
        this.panels.push({ id: tabDef.id, group: groupDef.id, ...built, index, body });
      });

      header.append(tabs, actions);
      section.prepend(header);
      section.querySelectorAll(".panel__tabs-body").forEach((n) => n.remove());
      bodies.forEach((b) => {
        b.body.className = "panel__tabs-body";
        section.append(b.body);
      });
      this.root.append(section);
      this.root.dataset.group = groupDef.id;
    }
  }

  update() {
    for (const panel of this.panels) {
      if (!panel.update) continue;
      try {
        panel.update();
      } catch (err) {
        console.error(`[panels] ${panel.id} update failed`, err);
      }
    }
  }

  /** Collapse/expand every panel group (Window > Panels > Collapse). */
  toggleCollapse() {
    this.root.querySelectorAll(".panel").forEach((p) => p.classList.toggle("panel--collapsed"));
  }
}
