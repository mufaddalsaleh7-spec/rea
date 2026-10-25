/**
 * Context-sensitive control bar: tool options on the left, transform and
 * appearance for the current selection, document information when nothing is
 * selected, and view controls on the right — mirroring Illustrator's control
 * bar layout and ordering.
 */

import { app, TOOL_LABELS, TOOL_DEFS_ICON } from "../studio/app.js";
import { activeArtboard, textMetrics } from "../engine/doc.js";
import { fmt, hexToHsv, hsvToHex } from "../engine/util.js";
import { notify, openMenu, setUI, ui } from "../ui/overlays.js";
import { moveSelection, resizeSelection, rotateBy, flip } from "../studio/selectionOps.js";
import { Btn, Icon, IconButton, NumField, SelectField, Divider } from "./ui.jsx";

const FONTS = [
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

const gradientCss = (paint) => {
  if (!paint) return "transparent";
  if (paint.type === "gradient" || paint.type === "radial") {
    const stops = (paint.stops || []).map((stop) => `${stop.color} ${Math.round(stop.offset * 100)}%`).join(",");
    return paint.type === "radial" ? `radial-gradient(circle, ${stops})` : `linear-gradient(120deg, ${stops})`;
  }
  return paint.color || "transparent";
};

function ToolOptions() {
  const tool = app.tool;
  const shapeTools = ["rect", "roundrect", "ellipse", "polygon", "star", "line", "arc", "spiral", "grid"];
  if (shapeTools.includes(tool)) {
    return (
      <div className="controlbar__group">
        {tool === "roundrect" ? (
          <>
            <span className="controlbar__label">Corner radius</span>
            <NumField value={app.tools?.cornerRadius ?? 12} min={0} dp={0} width={62} onChange={(value) => { app.tools.cornerRadius = value; }} />
          </>
        ) : null}
        {tool === "polygon" ? (
          <>
            <span className="controlbar__label">Sides</span>
            <NumField value={app.tools?.polygonSides ?? 6} min={3} max={64} step={1} dp={0} width={52} onChange={(value) => { app.tools.polygonSides = Math.round(value); }} />
          </>
        ) : null}
        {tool === "star" ? (
          <>
            <span className="controlbar__label">Points</span>
            <NumField value={app.tools?.starPoints ?? 5} min={3} max={40} step={1} dp={0} width={46} onChange={(value) => { app.tools.starPoints = Math.round(value); }} />
            <span className="controlbar__label">Inner</span>
            <NumField value={(app.tools?.starInner ?? 0.5) * 100} min={1} max={100} step={1} dp={0} width={52} onChange={(value) => { app.tools.starInner = value / 100; }} />
          </>
        ) : null}
        {["arc", "spiral", "line", "grid", "ellipse", "rect"].includes(tool) ? (
          <span className="controlbar__label controlbar__hint">Drag on the artboard to draw</span>
        ) : null}
      </div>
    );
  }
  const hints = {
    pen: "Click to add anchors · drag for curves · click the first anchor to close",
    curvature: "Draw smooth curves · anchors are placed automatically",
    pencil: "Drag to draw · strokes are simplified to smooth Bézier curves",
    brush: "Drag to paint · pressure is emulated from speed",
    smooth: "Drag across a path to smooth its anchors",
    blob: "Drag to build a filled blob brush shape",
    gradient: "Drag across artwork to set gradient direction",
    artboard: "Drag to create an artboard · click to activate",
    measure: "Drag to measure distance and angle",
    eyedropper: "Click artwork to sample its appearance",
    type: "Click to place type · drag to define a text area",
    shapeBuilder: "Drag across overlapping shapes to unite or subtract",
  };
  if (!hints[tool]) return null;
  return (
    <div className="controlbar__group">
      <span className="controlbar__label controlbar__hint" title={hints[tool]}>{hints[tool]}</span>
    </div>
  );
}

export function ControlBar() {
  const nodes = app.selectionNodes();
  const first = nodes[0];
  const bounds = app.selectionBounds();
  const artboard = app.doc ? activeArtboard(app.doc) : null;
  const fill = first ? first.fill : app.fill;
  const stroke = first ? first.stroke : app.stroke;
  const isText = first?.type === "text";

  return (
    <div id="controlbar" className="controlbar" aria-label="Control bar">
      <div className="controlbar__group">
        <span className="controlbar__tool-icon">
          <Icon name={TOOL_DEFS_ICON[app.tool] || "select"} size={16} />
        </span>
        <span className="controlbar__title">{TOOL_LABELS[app.tool] || "Selection Tool"}</span>
      </div>
      <ToolOptions />
      <Divider vertical />

      {first ? (
        <>
          <div className="controlbar__group">
            <span className="controlbar__label">X</span>
            <NumField value={bounds ? bounds.x : 0} dp={2} width={68} onChange={(value) => moveSelection("x", value)} title="X position" />
            <span className="controlbar__label">Y</span>
            <NumField value={bounds ? bounds.y : 0} dp={2} width={68} onChange={(value) => moveSelection("y", value)} title="Y position" />
            <span className="controlbar__label">W</span>
            <NumField value={bounds ? bounds.w : 0} min={0.01} dp={2} width={68} onChange={(value) => resizeSelection("w", value)} title="Width" />
            <span className="controlbar__label">H</span>
            <NumField value={bounds ? bounds.h : 0} min={0.01} dp={2} width={68} onChange={(value) => resizeSelection("h", value)} title="Height" />
            <IconButton name="link" title="Constrain width and height proportions" onClick={() => notify()} />
          </div>
          <Divider vertical />
          <div className="controlbar__group">
            <button
              type="button"
              className="appearance-row__swatch"
              style={{ width: 20, height: 20, background: gradientCss(fill), outline: app.target === "fill" ? "1px solid var(--accent)" : "none" }}
              title="Fill"
              aria-label="Fill"
              onClick={() => { app.setTarget("fill"); notify(); }}
            />
            <button
              type="button"
              className="appearance-row__swatch"
              style={{
                width: 20,
                height: 20,
                background: stroke && stroke.width ? stroke.color : "transparent",
                outline: app.target === "stroke" ? "1px solid var(--accent)" : "none",
              }}
              title="Stroke"
              aria-label="Stroke"
              onClick={() => { app.setTarget("stroke"); notify(); }}
            />
            <span className="controlbar__label">Stroke</span>
            <NumField value={stroke?.width ?? 0} min={0} step={0.25} dp={2} width={58} onChange={(value) => app.setStrokeProp("width", value)} title="Stroke weight" />
            <span className="controlbar__label">Opacity</span>
            <NumField
              value={Math.round((first.opacity ?? 1) * 100)}
              min={0}
              max={100}
              dp={0}
              width={54}
              onChange={(value) => app.setOpacity(value / 100)}
              title="Opacity"
            />
            <span className="controlbar__label">%</span>
          </div>

          {isText ? (
            <>
              <Divider vertical />
              <div className="controlbar__group">
                <SelectField
                  value={first.fontFamily}
                  options={FONTS.map(([value, label]) => ({ value, label }))}
                  width={132}
                  title="Font family"
                  onChange={(value) => app.setTextProps({ fontFamily: value })}
                />
                <NumField value={first.fontSize} min={1} dp={0} width={52} onChange={(value) => app.setTextProps({ fontSize: value })} title="Font size" />
                <SelectField
                  value={String(first.fontWeight || 400)}
                  options={[
                    { value: "300", label: "Light" },
                    { value: "400", label: "Regular" },
                    { value: "500", label: "Medium" },
                    { value: "700", label: "Bold" },
                    { value: "900", label: "Black" },
                  ]}
                  width={78}
                  title="Font weight"
                  onChange={(value) => app.setTextProps({ fontWeight: Number(value) })}
                />
                <IconButton name="typeLeft" title="Align left" active={first.align === "left"} onClick={() => app.setTextProps({ align: "left" })} />
                <IconButton name="typeCenter" title="Align center" active={first.align === "center"} onClick={() => app.setTextProps({ align: "center" })} />
                <IconButton name="typeRight" title="Align right" active={first.align === "right"} onClick={() => app.setTextProps({ align: "right" })} />
                <IconButton name="tracking" title="Letter spacing" onClick={() => setUI({ panelTab: "character" })} />
              </div>
            </>
          ) : null}

          <Divider vertical />
          <div className="controlbar__group">
            <IconButton name="rotateLeft" title="Rotate 90° CCW" onClick={() => rotateBy(-90)} />
            <IconButton name="rotateRight" title="Rotate 90° CW" onClick={() => rotateBy(90)} />
            <IconButton name="flipH" title="Reflect horizontally" onClick={() => flip("h")} />
            <IconButton name="flipV" title="Reflect vertically" onClick={() => flip("v")} />
            <IconButton name="alignLeft" title="Bring to front" onClick={() => app.arrange("front")} />
            <IconButton name="alignRight" title="Send to back" onClick={() => app.arrange("back")} />
          </div>
        </>
      ) : (
        <>
          <div className="controlbar__group">
            <span className="controlbar__label">Document</span>
            <span className="controlbar__value">{app.doc?.name || "Untitled"}</span>
            <span className="controlbar__label">W</span>
            <NumField value={artboard?.w ?? 0} min={1} dp={0} width={66} onChange={(value) => { if (artboard) { artboard.w = value; app.dirty = true; app.requestRender(true); app.refreshPanels(); } }} />
            <span className="controlbar__label">H</span>
            <NumField value={artboard?.h ?? 0} min={1} dp={0} width={66} onChange={(value) => { if (artboard) { artboard.h = value; app.dirty = true; app.requestRender(true); app.refreshPanels(); } }} />
            <span className="controlbar__label">Units</span>
            <SelectField
              value={app.doc?.units || "px"}
              options={[
                { value: "px", label: "Pixels" },
                { value: "pt", label: "Points" },
                { value: "mm", label: "Millimetres" },
                { value: "in", label: "Inches" },
              ]}
              width={96}
              onChange={(value) => { app.doc.units = value; app.dirty = true; app.refreshPanels(); }}
            />
          </div>
        </>
      )}

      <div className="spacer" />

      <div className="controlbar__group">
        <span className="controlbar__label" style={{ whiteSpace: "nowrap" }}>
          {nodes.length ? `${nodes.length} selected` : "Ready"}
        </span>
        <IconButton name="grid" title="Toggle grid" active={app.showGrid} onClick={() => app.toggleGrid()} />
        <IconButton name="eye" title="Outline / preview" active={app.outlineMode} onClick={() => app.toggleOutline()} />
        <IconButton
          name="gear"
          title="Preferences"
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            openMenu(rect.right - 220, rect.bottom + 2, [
              { label: "Show Rulers", checked: app.showRulers, action: () => app.toggleRulers() },
              { label: "Show Grid", checked: app.showGrid, action: () => app.toggleGrid() },
              { label: "Show Guides", checked: app.showGuides, action: () => app.toggleGuides() },
              { label: "Smart Guides", checked: app.showSmartGuides, action: () => app.toggleSmartGuides() },
              { separator: true },
              { label: "Dark Theme", checked: ui.theme === "dark", action: () => app.setTheme("dark") },
              { label: "Light Theme", checked: ui.theme === "light", action: () => app.setTheme("light") },
              { separator: true },
              { label: "Collapse Panels", checked: ui.panelsCollapsed, action: () => setUI({ panelsCollapsed: !ui.panelsCollapsed }) },
              { label: "Workspace Browser…", action: () => setUI({ browseOpen: true }) },
            ]);
          }}
        />
        <Btn small onClick={() => app.toggleDock()} title="Show or hide the panel dock">
          {app.dockCollapsed ? "Show Panels" : "Hide Panels"}
        </Btn>
      </div>
    </div>
  );
}
