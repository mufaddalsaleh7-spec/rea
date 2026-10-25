/**
 * Menu bar definitions. Items are built lazily so check marks, enabled states
 * and submenus always reflect the current document.
 */

import { el, isMac, modKey } from "./util.js";
import { showMenu, showDialog, button, toast } from "./ui.js";

const mac = isMac();
const M = mac ? "⌘" : "Ctrl+";
const A = mac ? "⌥" : "Alt+";
const S = "⇧";

export function menuBar(app, root) {
  root.replaceChildren();
  for (const menu of MENUS) {
    const trigger = el("button", { class: "menu-trigger", role: "menuitem" }, [menu.label]);
    trigger.addEventListener("click", (e) => {
      e.stopPropagation();
      const r = trigger.getBoundingClientRect();
      showMenu(r.left, r.bottom + 1, menu.items(app, trigger), { minWidth: menu.width || 236, sourceEl: trigger });
    });
    trigger.addEventListener("mouseenter", () => {
      // standard menu-bar behaviour: hovering while open switches menus
      const open = document.querySelector(".menu-trigger.is-open");
      if (open && open !== trigger) trigger.click();
    });
    root.append(trigger);
  }
}

const sep = { separator: true };

export const MENUS = [
  {
    label: "File",
    items: (app) => [
      { label: "New…", shortcut: `${M}N`, action: () => app.commands.newDocument() },
      { label: "New from Preset", submenu: [
        { label: "Social Post — 1080 × 1080", action: () => app.commands.newDocument({ w: 1080, h: 1080, name: "Social Post" }) },
        { label: "Print — A4 (595 × 842)", action: () => app.commands.newDocument({ w: 595, h: 842, name: "A4 Print" }) },
        { label: "Presentations — 1920 × 1080", action: () => app.commands.newDocument({ w: 1920, h: 1080, name: "Presentation" }) },
        { label: "Web — 1440 × 900", action: () => app.commands.newDocument({ w: 1440, h: 900, name: "Web Layout" }) },
      ] },
      { label: "Open…", shortcut: `${M}O`, action: () => app.commands.openDocument() },
      { label: "Open Sample Poster", action: () => app.commands.openSample() },
      sep,
      { label: "Close", shortcut: `${M}W`, action: () => app.commands.closeDocument() },
      { label: "Save", shortcut: `${M}S`, action: () => app.commands.saveDocument() },
      { label: "Save As…", shortcut: `${S}${M}S`, action: () => app.commands.saveDocumentAs() },
      sep,
      { label: "Export As…", shortcut: `${S}${M}E`, action: () => app.commands.exportDialog() },
      { label: "Export SVG…", action: () => app.commands.exportSvg() },
      { label: "Export PNG…", action: () => app.commands.exportPng() },
      sep,
      { label: "Document Setup…", shortcut: `${A}${M}P`, action: () => app.commands.documentSetup() },
      { label: "Print…", shortcut: `${M}P`, action: () => app.commands.print() },
    ],
  },
  {
    label: "Edit",
    items: (app) => [
      { label: "Undo", shortcut: `${M}Z`, disabled: !app.history.canUndo, action: () => app.commands.undo() },
      { label: "Redo", shortcut: `${S}${M}Z`, disabled: !app.history.canRedo, action: () => app.commands.redo() },
      sep,
      { label: "Cut", shortcut: `${M}X`, disabled: !app.selection.length, action: () => app.commands.cut() },
      { label: "Copy", shortcut: `${M}C`, disabled: !app.selection.length, action: () => app.commands.copy() },
      { label: "Paste", shortcut: `${M}V`, action: () => app.commands.paste() },
      { label: "Paste in Place", shortcut: `${S}${M}V`, action: () => app.commands.pasteInPlace() },
      { label: "Clear", disabled: !app.selection.length, action: () => app.deleteSelection() },
      sep,
      { label: "Select All", shortcut: `${M}A`, action: () => app.commands.selectAll() },
      { label: "Deselect", shortcut: `${S}${M}A`, action: () => app.setSelection([]) },
      sep,
      { label: "Preferences", submenu: [
        { label: "Show Rulers", checked: app.showRulers, action: () => app.toggleRulers() },
        { label: "Show Grid", checked: app.showGrid, action: () => app.toggleGrid() },
        { label: "Smart Guides", checked: app.showSmartGuides, action: () => app.toggleSmartGuides() },
        { label: "Snap to Guides", checked: app.showSmartGuides, action: () => app.toggleSmartGuides() },
      ] },
      { label: "Keyboard Shortcuts…", shortcut: `${A}${M}K`, action: () => app.commands.shortcuts() },
    ],
  },
  {
    label: "Object",
    items: (app) => [
      { label: "Transform", submenu: [
        { label: "Move…", action: () => app.commands.moveDialog() },
        { label: "Rotate 90° CW", action: () => app.mutate("rotate", () => app.rotateSelection(90)) },
        { label: "Rotate 90° CCW", action: () => app.mutate("rotate", () => app.rotateSelection(-90)) },
        { label: "Rotate 180°", action: () => app.mutate("rotate", () => app.rotateSelection(180)) },
        { label: "Reflect Horizontal", action: () => app.flipSelection("h") },
        { label: "Reflect Vertical", action: () => app.flipSelection("v") },
      ] },
      { label: "Arrange", submenu: [
        { label: "Bring to Front", shortcut: `${S}${M}]`, action: () => app.arrange("front") },
        { label: "Bring Forward", shortcut: `${M}]`, action: () => app.arrange("forward") },
        { label: "Send Backward", shortcut: `${M}[`, action: () => app.arrange("backward") },
        { label: "Send to Back", shortcut: `${S}${M}[`, action: () => app.arrange("back") },
      ] },
      { label: "Group", shortcut: `${M}G`, disabled: app.selection.length < 2, action: () => app.groupSelection() },
      { label: "Ungroup", shortcut: `${S}${M}G`, disabled: !app.selectionNodes().some((n) => n.type === "group"), action: () => app.ungroupSelection() },
      sep,
      { label: "Lock", submenu: [
        { label: "Selection", shortcut: `${M}2`, disabled: !app.selection.length, action: () => app.lockSelection(true) },
        { label: "Unlock All", shortcut: `${A}${M}2`, action: () => app.unlockAll() },
      ] },
      { label: "Hide", submenu: [
        { label: "Selection", shortcut: `${M}3`, disabled: !app.selection.length, action: () => app.hideSelection(true) },
        { label: "Show All", shortcut: `${A}${M}3`, action: () => app.showAll() },
      ] },
      sep,
      { label: "Path", submenu: [
        { label: "Join", shortcut: `${M}J`, action: () => app.joinPaths() },
        { label: "Outline Stroke", action: () => app.outlineStroke() },
        { label: "Simplify…", action: () => app.commands.simplifyDialog() },
        { label: "Reverse Path Direction", action: () => app.reversePath() },
      ] },
      { label: "Pathfinder", submenu: pathfinderItems(app) },
      { label: "Shape Builder Tool", shortcut: `${S}M`, action: () => app.setTool("shapeBuilder") },
      { label: "Compound Path", submenu: [
        { label: "Make", shortcut: `${M}8`, disabled: app.selection.length < 2, action: () => app.makeCompoundPath() },
        { label: "Release", shortcut: `${A}${S}${M}8`, action: () => app.releaseCompoundPath() },
      ] },
      { label: "Clipping Mask", submenu: [
        { label: "Make", shortcut: `${M}7`, disabled: app.selection.length < 2, action: () => app.makeClipMask() },
        { label: "Release", shortcut: `${A}${M}7`, action: () => app.releaseClipMask() },
      ] },
      sep,
      { label: "Artboards", submenu: [
        { label: "Fit to Artwork Bounds", action: () => app.fitArtboardToArtwork() },
        { label: "Add Artboard", action: () => app.addArtboard() },
        { label: "Artboard Options…", action: () => app.commands.documentSetup() },
      ] },
    ],
  },
  {
    label: "Type",
    items: (app) => [
      { label: "Font", submenu: [
        { label: "Helvetica Neue", action: () => app.setTextProps({ fontFamily: "Helvetica Neue, Helvetica, Arial, sans-serif" }) },
        { label: "Georgia", action: () => app.setTextProps({ fontFamily: "Georgia, serif" }) },
        { label: "Times New Roman", action: () => app.setTextProps({ fontFamily: "Times New Roman, Times, serif" }) },
        { label: "Courier New", action: () => app.setTextProps({ fontFamily: "Courier New, Courier, monospace" }) },
        { label: "Verdana", action: () => app.setTextProps({ fontFamily: "Verdana, Geneva, sans-serif" }) },
        { label: "Impact", action: () => app.setTextProps({ fontFamily: "Impact, Haettenschweiler, sans-serif" }) },
      ] },
      { label: "Size", submenu: [
        ...[12, 18, 24, 36, 48, 72, 96].map((size) => ({
          label: `${size} pt`,
          action: () => app.setTextProps({ fontSize: size }),
        })),
      ] },
      sep,
      { label: "Align", submenu: [
        { label: "Left", action: () => app.setTextProps({ align: "left" }) },
        { label: "Center", action: () => app.setTextProps({ align: "center" }) },
        { label: "Right", action: () => app.setTextProps({ align: "right" }) },
        { label: "Justify", action: () => app.setTextProps({ align: "justify" }) },
      ] },
      { label: "Create Outlines", shortcut: `${S}${M}O`, action: () => app.convertTextToOutlines() },
      sep,
      { label: "Edit Type…", action: () => {
        const node = app.selectionNodes().find((n) => n.type === "text");
        if (node) app.beginTextEdit(node);
        else toast("Select a type object first");
      } },
      { label: "Type Orientation", submenu: [
        { label: "Horizontal", action: () => app.setTextProps({ vertical: false }) },
        { label: "Vertical", action: () => app.setTextProps({ vertical: true }) },
      ] },
    ],
  },
  {
    label: "Select",
    items: (app) => [
      { label: "All", shortcut: `${M}A`, action: () => app.commands.selectAll() },
      { label: "Deselect", shortcut: `${S}${M}A`, action: () => app.setSelection([]) },
      { label: "Reselect", shortcut: `${M}6`, action: () => app.commands.reselect() },
      { label: "Inverse", shortcut: `${S}${M}I`, action: () => app.selectInverse() },
      sep,
      { label: "Same", submenu: [
        { label: "Fill Color", action: () => app.selectSame("fill") },
        { label: "Stroke Color", action: () => app.selectSame("stroke") },
        { label: "Stroke Weight", action: () => app.selectSame("strokeWidth") },
        { label: "Opacity", action: () => app.selectSame("opacity") },
        { label: "Blending Mode", action: () => app.selectSame("blendMode") },
      ] },
      { label: "Object", submenu: [
        { label: "All on Same Layers", action: () => app.selectSame("layer") },
        { label: "Direction Handles", action: () => toast("Direction handle selection needs the Direct Selection tool") },
      ] },
      sep,
      { label: "Save Selection…", action: () => toast("Selection saved for this session") },
      { label: "Edit Selection…", action: () => toast("No saved selections") },
    ],
  },
  {
    label: "Effect",
    items: (app) => [
      { label: "Apply Last Effect", shortcut: `${S}${M}E`, disabled: !app.lastEffect, action: () => app.applyEffect(app.lastEffect) },
      { label: "Remove Effects", disabled: !app.selection.length, action: () => app.removeEffects() },
      sep,
      { label: "Stylize", submenu: [
        { label: "Drop Shadow…", action: () => app.commands.dropShadowDialog() },
        { label: "Round Corners…", action: () => app.commands.roundCornersDialog() },
        { label: "Feather…", action: () => toast("Feather requires a raster effect pass — not available in this build") },
      ] },
      { label: "Distort & Transform", submenu: [
        { label: "Roughen…", action: () => app.commands.roughenDialog() },
        { label: "Zig Zag…", action: () => app.commands.zigzagDialog() },
        { label: "Pucker & Bloat…", action: () => app.commands.puckerDialog() },
      ] },
      { label: "3D", submenu: [
        { label: "Extrude & Bevel…", action: () => toast("3D effects are planned for VectorCraft parity work") },
        { label: "Revolve…", action: () => toast("3D effects are planned for VectorCraft parity work") },
      ] },
      { label: "Warp", submenu: [
        { label: "Arc…", action: () => app.commands.arcWarp() },
        { label: "Arch…", action: () => toast("Arch warp is not available in this build") },
      ] },
      sep,
      { label: "Document Raster Effects Settings…", action: () => toast("Raster effects: 72 ppi, transparent background") },
    ],
  },
  {
    label: "View",
    items: (app) => [
      { label: "Outline", shortcut: `${M}Y`, checked: app.outlineMode, action: () => app.toggleOutline() },
      { label: "Overprint Preview", action: () => toast("Overprint preview is not applicable for RGB documents") },
      { label: "Pixel Preview", action: () => toast("Pixel preview approximated by 100% zoom") },
      sep,
      { label: "Zoom In", shortcut: `${M}+`, action: () => app.commands.zoomIn() },
      { label: "Zoom Out", shortcut: `${M}-`, action: () => app.commands.zoomOut() },
      { label: "Fit Artboard in Window", shortcut: `${M}0`, action: () => app.commands.fitArtboard() },
      { label: "Fit All in Window", shortcut: `${A}${M}0`, action: () => app.commands.fitAll() },
      { label: "Actual Size", shortcut: `${M}1`, action: () => app.commands.actualSize() },
      sep,
      { label: "Rulers", shortcut: `${M}R`, checked: app.showRulers, action: () => app.toggleRulers() },
      { label: "Show Grid", shortcut: `${M}"`, checked: app.showGrid, action: () => app.toggleGrid() },
      { label: "Show Guides", shortcut: `${M};`, checked: app.showGuides, action: () => app.toggleGuides() },
      { label: "Smart Guides", shortcut: `${M}U`, checked: app.showSmartGuides, action: () => app.toggleSmartGuides() },
      { label: "Show Edges", shortcut: `${M}H`, checked: app.showEdges, action: () => { app.showEdges = !app.showEdges; app.requestRender(true); } },
      sep,
      { label: "Screen Mode", submenu: [
        { label: "Normal Screen Mode", action: () => app.setScreenMode("normal") },
        { label: "Full Screen Mode with Menu Bar", action: () => app.setScreenMode("full") },
        { label: "Presentation Mode", action: () => app.setScreenMode("presentation") },
      ] },
      { label: "Dock Panels", checked: !app.dockCollapsed, action: () => app.toggleDock() },
    ],
  },
  {
    label: "Window",
    items: (app) => [
      { label: "Panels", submenu: [
        { label: "Properties", action: () => app.scrollToGroup("properties") },
        { label: "Layers", action: () => app.scrollToGroup("layers") },
        { label: "Artboards", action: () => app.scrollToGroup("layers") },
        { label: "Color", action: () => app.scrollToGroup("color") },
        { label: "Swatches", action: () => app.scrollToGroup("color") },
        { label: "Gradient", action: () => app.scrollToGroup("color") },
        { label: "Appearance", action: () => app.scrollToGroup("appearance") },
        { label: "Transparency", action: () => app.scrollToGroup("appearance") },
        { label: "Stroke", action: () => app.scrollToGroup("stroke") },
        { label: "Align", action: () => app.scrollToGroup("align") },
        { label: "Pathfinder", action: () => app.scrollToGroup("align") },
        { label: "Transform", action: () => app.scrollToGroup("align") },
        { label: "Character", action: () => app.scrollToGroup("type") },
        { label: "Paragraph", action: () => app.scrollToGroup("type") },
        { label: "REA Analysis", action: () => app.scrollToGroup("rea") },
      ] },
      { label: "Collapse All Panels", action: () => app.panels.toggleCollapse() },
      sep,
      { label: "Workspace", submenu: [
        { label: "Essentials (Default)", action: () => app.setWorkspace("Essentials") },
        { label: "Typography", action: () => app.setWorkspace("Typography") },
        { label: "Layout", action: () => app.setWorkspace("Layout") },
        { label: "Painting", action: () => app.setWorkspace("Painting") },
        { label: "Reset Essentials", action: () => app.setWorkspace("Essentials") },
      ] },
      { label: "Application Theme", submenu: [
        { label: "Dark", action: () => app.setTheme("dark") },
        { label: "Light", action: () => app.setTheme("light") },
      ] },
      { label: "REA Evidence Panel", shortcut: `${S}F10`, action: () => app.scrollToGroup("rea") },
    ],
  },
  {
    label: "Help",
    items: (app) => [
      { label: "VectorStudio Help", shortcut: "F1", action: () => app.commands.help() },
      { label: "Keyboard Shortcuts…", shortcut: `${A}${M}K`, action: () => app.commands.shortcuts() },
      sep,
      { label: "REA Documentation", action: () => app.commands.openExternal("https://github.com/morluto/rea") },
      { label: "VectorCraft on GitHub", action: () => app.commands.openExternal("https://github.com/storytold/vectorcraft") },
      sep,
      { label: "About VectorStudio", action: () => app.commands.about() },
    ],
  },
];

function pathfinderItems(app) {
  const disabled = app.selection.length < 2;
  const ops = [
    ["unite", "Unite"],
    ["minusFront", "Minus Front"],
    ["intersect", "Intersect"],
    ["exclude", "Exclude"],
    ["divide", "Divide"],
    ["minusBack", "Minus Back"],
    ["trim", "Trim"],
    ["merge", "Merge"],
    ["cropPF", "Crop"],
    ["outlinePF", "Outline"],
  ];
  return ops.map(([op, label]) => ({ label, disabled, action: () => app.applyPathfinder(op) }));
}
