/**
 * Dock panels, in React.
 *
 * Each panel reads the live document from the studio core and mutates it through
 * the same commands the menus use, so nothing here owns state. Inputs are
 * uncontrolled-until-focus (see <NumField>) to avoid clobbering a value the user
 * is typing while the document re-renders.
 */

import { useState } from "react";
import { app } from "../studio/app.js";
import { SWATCHES, createLayer, activeArtboard, textMetrics } from "../engine/doc.js";
import { fmt, hexToHsv, hsvToHex, hexToRgb, rgbToHex } from "../engine/util.js";
import { moveSelection, resizeSelection, rotateBy, shearBy, flip } from "../studio/selectionOps.js";
import { notify, setUI, ui, pushToast } from "../ui/overlays.js";
import {
  Btn, Checkbox, ColorField, Divider, Icon, IconButton, NumField, Row, RowLabel,
  SelectField, Slider, Swatch, TextField,
} from "./ui.jsx";

/* -------------------------------------------------------------- utilities */

const paintCss = (paint) => {
  if (!paint) return "transparent";
  if (paint.type === "gradient" || paint.type === "radial") {
    const stops = (paint.stops || []).map((stop) => `${stop.color} ${Math.round(stop.offset * 100)}%`).join(",");
    return paint.type === "radial"
      ? `radial-gradient(circle, ${stops || "#fff, #000"})`
      : `linear-gradient(90deg, ${stops || "#fff, #000"})`;
  }
  return paint.color || "transparent";
};

const currentColor = () => {
  if (app.target === "fill") {
    const fill = app.currentFill();
    return fill?.type === "gradient" || fill?.type === "radial" ? fill.stops?.[0]?.color : fill?.color;
  }
  return app.currentStroke()?.color;
};

const setOpacity = (value) => app.setOpacity(value);

function Hint({ children }) {
  return <div className="dialog__hint">{children}</div>;
}

function Empty({ children }) {
  return <div className="empty-state">{children}</div>;
}

/* -------------------------------------------------------------- properties */

export function PropertiesPanel() {
  const [linked, setLinked] = useState(false);
  const nodes = app.selectionNodes();
  const bounds = app.selectionBounds();
  const first = nodes[0];
  const artboard = app.doc ? activeArtboard(app.doc) : null;
  const has = nodes.length > 0;
  const fill = first ? first.fill : app.fill;
  const stroke = first ? first.stroke : app.stroke?.enabled ? app.stroke : null;

  return (
    <div className="panel__body" style={{ opacity: has ? 1 : 0.72 }}>
      <Row>
        <RowLabel width={52}>Transform</RowLabel>
        <div className="grow" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
          <NumField label="X" value={bounds?.x ?? 0} onChange={(value) => moveSelection("x", value)} title="X position" />
          <NumField label="Y" value={bounds?.y ?? 0} onChange={(value) => moveSelection("y", value)} title="Y position" />
        </div>
      </Row>
      <Row>
        <span style={{ minWidth: 52 }} />
        <div className="grow" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 22px", gap: 4, alignItems: "center" }}>
          <NumField label="W" value={bounds?.w ?? 0} min={0.01} onChange={(value) => resizeSelection("w", value, false)} title="Width" />
          <NumField label="H" value={bounds?.h ?? 0} min={0.01} onChange={(value) => resizeSelection("h", value, false)} title="Height" />
          <IconButton name={linked ? "link" : "unlink"} title="Constrain proportions" active={linked} onClick={() => setLinked(!linked)} size={12} />
        </div>
      </Row>
      <Divider />
      <Row tight>
        <RowLabel>Fill</RowLabel>
        <button
          type="button"
          className="appearance-row__swatch"
          style={{ width: 20, height: 20, background: paintCss(fill), outline: app.target === "fill" ? "1px solid var(--accent)" : "none" }}
          title="Target the fill"
          onClick={() => { app.setTarget("fill"); notify(); }}
        />
        <span className="label" style={{ marginLeft: 8 }}>Stroke</span>
        <button
          type="button"
          className="appearance-row__swatch"
          style={{
            width: 20,
            height: 20,
            background: stroke ? (stroke.color || "transparent") : "transparent",
            outline: app.target === "stroke" ? "1px solid var(--accent)" : "none",
          }}
          title="Target the stroke"
          onClick={() => { app.setTarget("stroke"); notify(); }}
        />
        <span className="spacer" />
      </Row>
      <Row>
        <RowLabel>Weight</RowLabel>
        <NumField value={stroke?.width ?? 0} min={0} step={0.25} dp={2} width={62} onChange={(value) => app.setStrokeProp("width", value)} />
        <RowLabel>Opacity</RowLabel>
        <NumField value={Math.round((first?.opacity ?? 1) * 100)} min={0} max={100} dp={0} width={52} onChange={(value) => setOpacity(value / 100)} />
        <span className="label">%</span>
      </Row>
      <Divider />
      <Row>
        <RowLabel>Align</RowLabel>
        <div className="align-grid">
          {[
            ["alignLeft", "horizontalAlignLeft"], ["alignCenterH", "horizontalAlignCenter"], ["alignRight", "horizontalAlignRight"],
            ["alignTop", "verticalAlignTop"], ["alignCenterV", "verticalAlignCenter"], ["alignBottom", "verticalAlignBottom"],
            ["distributeH", "distributeHorizontalCenter"], ["distributeV", "distributeVerticalCenter"],
          ].map(([iconName, mode]) => (
            <button
              key={mode}
              type="button"
              className="align-btn"
              title={mode.replace(/([A-Z])/g, " $1").toLowerCase()}
              onClick={() => app.align(mode.startsWith("distribute") ? "distribute" : "align", mode)}
            >
              <Icon name={iconName} size={15} />
            </button>
          ))}
        </div>
      </Row>
      <Divider />
      <Row>
        <RowLabel>Pathfinder</RowLabel>
        <div className="pf-grid">
          {[["unite", "Unite"], ["minusFront", "Minus Front"], ["intersect", "Intersect"], ["exclude", "Exclude"], ["divide", "Divide"]].map(([iconName, label]) => (
            <button
              key={iconName}
              type="button"
              className="pf-btn"
              title={`Pathfinder: ${label}`}
              disabled={nodes.length < 2}
              onClick={() => app.applyPathfinder(iconName)}
            >
              <Icon name={iconName} size={16} />
            </button>
          ))}
        </div>
      </Row>
      <div className="dialog__section" style={{ border: 0, padding: 0, gap: 6 }}>
        <h4>Quick Actions</h4>
        <Row wrap>
          <Btn small onClick={() => app.groupSelection()} disabled={nodes.length < 2}>Group</Btn>
          <Btn small onClick={() => app.ungroupSelection()}>Ungroup</Btn>
          <Btn small onClick={() => app.duplicateSelection()}>Duplicate</Btn>
          <Btn small onClick={() => app.outlineStroke()} title="Outline stroke">Outline</Btn>
        </Row>
      </div>
      {!has && artboard ? (
        <div className="info-grid">
          <span className="label">Name</span><span className="value">{artboard.name}</span>
          <span className="label">Size</span><span className="value">{fmt(artboard.w, 0)} × {fmt(artboard.h, 0)} px</span>
        </div>
      ) : null}
      <Hint>{has ? `${nodes.length} object${nodes.length > 1 ? "s" : ""} selected` : "Select artwork to edit its transform and appearance."}</Hint>
    </div>
  );
}

/* ------------------------------------------------------------------ layers */

function LayerRow({ node, depth, layer, onChange }) {
  const [renaming, setRenaming] = useState(false);
  const selected = app.selection.includes(node.id);
  const isGroup = node.type === "group";
  return (
    <>
      <div
        className={`layer-row${selected ? " is-selected" : ""}`}
        style={{ paddingLeft: 6 + depth * 14 }}
        onClick={(event) => {
          if (event.shiftKey) app.setSelection([...app.selection, node.id]);
          else app.setSelection([node.id]);
        }}
        onDoubleClick={() => setRenaming(true)}
        role="treeitem"
        aria-selected={selected}
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === "Enter") setRenaming(true);
        }}
      >
        <button
          type="button"
          className="layer-row__icon"
          title={node.visible === false ? "Show" : "Hide"}
          onClick={(event) => {
            event.stopPropagation();
            app.mutate("visibility", () => { node.visible = node.visible === false; });
            app.requestRender(true);
            onChange();
          }}
        >
          <Icon name={node.visible === false ? "eyeOff" : "eye"} size={12} />
        </button>
        <button
          type="button"
          className="layer-row__icon"
          title={node.locked ? "Unlock" : "Lock"}
          onClick={(event) => {
            event.stopPropagation();
            app.mutate("lock", () => { node.locked = !node.locked; });
            onChange();
          }}
        >
          <Icon name={node.locked ? "lock" : "unlock"} size={12} />
        </button>
        <span
          className="layer-row__swatch"
          style={{ background: isGroup ? "transparent" : paintCss(node.fill), border: isGroup ? "1px solid var(--hairline-soft)" : "none" }}
        />
        {renaming ? (
          <input
            className="text-input layer-row__name"
            autoFocus
            defaultValue={node.name}
            onBlur={(event) => {
              const value = event.target.value.trim();
              if (value) app.mutate("rename", () => { node.name = value; });
              setRenaming(false);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") setRenaming(false);
            }}
          />
        ) : (
          <span className="layer-row__name">{node.name}</span>
        )}
        <span className="layer-row__type">{isGroup ? `${node.children?.length ?? 0}` : node.kind || node.type}</span>
      </div>
      {isGroup
        ? (node.children || []).map((child) => (
            <LayerRow key={child.id} node={child} depth={depth + 1} layer={layer} onChange={onChange} />
          ))
        : null}
    </>
  );
}

export function LayersPanel() {
  const layers = app.doc?.layers || [];
  const [, force] = useState(0);
  const refresh = () => { force((value) => value + 1); notify(); };
  return (
    <div className="panel__body">
      <Row>
        <RowLabel width={44}>Layers</RowLabel>
        <span className="spacer" />
        <IconButton
          name="plus"
          title="New layer"
          size={12}
          onClick={() => {
            app.mutate("add-layer", () => {
              const layer = createLayer(`Layer ${layers.length + 1}`);
              app.doc.layers.push(layer);
              app.activeLayerId = layer.id;
            });
            refresh();
          }}
        />
        <IconButton
          name="duplicate"
          title="Duplicate layer"
          size={12}
          onClick={() => {
            const layer = app.activeLayer();
            if (layer) app.duplicateLayer(layer.id);
            refresh();
          }}
        />
        <IconButton
          name="trash"
          title="Delete layer"
          size={12}
          onClick={() => {
            const layer = app.activeLayer();
            if (layer && layers.length > 1) app.deleteLayer(layer.id);
            refresh();
          }}
        />
        <IconButton name="more" title="Layer options" size={12} onClick={() => setUI({ browseOpen: false })} />
      </Row>
      <div className="layer-list" role="tree">
        {layers.map((layer) => (
          <div key={layer.id} className={`layer-group${app.activeLayerId === layer.id ? " is-active" : ""}`}>
            <div
              className="layer-row layer-row--group"
              onClick={() => {
                app.activeLayerId = layer.id;
                refresh();
              }}
              role="treeitem"
              tabIndex={0}
            >
              <button
                type="button"
                className="layer-row__icon"
                title={layer.visible === false ? "Show layer" : "Hide layer"}
                onClick={(event) => {
                  event.stopPropagation();
                  app.mutate("layer-visibility", () => { layer.visible = layer.visible === false; });
                  app.requestRender(true);
                  refresh();
                }}
              >
                <Icon name={layer.visible === false ? "eyeOff" : "eye"} size={12} />
              </button>
              <button
                type="button"
                className="layer-row__icon"
                title={layer.locked ? "Unlock layer" : "Lock layer"}
                onClick={(event) => {
                  event.stopPropagation();
                  app.mutate("layer-lock", () => { layer.locked = !layer.locked; });
                  refresh();
                }}
              >
                <Icon name={layer.locked ? "lock" : "unlock"} size={12} />
              </button>
              <span className="layer-row__swatch" style={{ background: layer.color || "var(--accent)" }} />
              <span className="layer-row__name">{layer.name}</span>
              <span className="layer-row__type">{layer.children.length}</span>
            </div>
            {layer.children
              .slice()
              .reverse()
              .map((node) => (
                <LayerRow key={node.id} node={node} depth={1} layer={layer} onChange={refresh} />
              ))}
          </div>
        ))}
      </div>
      <Row tight>
        <RowLabel>Opacity</RowLabel>
        <NumField
          value={Math.round((app.activeLayer()?.opacity ?? 1) * 100)}
          min={0}
          max={100}
          dp={0}
          width={56}
          onChange={(value) => {
            const layer = app.activeLayer();
            if (!layer) return;
            app.mutate("layer-opacity", () => { layer.opacity = value / 100; });
            app.requestRender(true);
          }}
        />
        <span className="label">%</span>
        <span className="spacer" />
        <Btn small onClick={() => app.arrange("front")}>Front</Btn>
        <Btn small onClick={() => app.arrange("back")}>Back</Btn>
      </Row>
    </div>
  );
}

/* --------------------------------------------------------------- artboards */

export function ArtboardsPanel() {
  const artboards = app.doc?.artboards || [];
  return (
    <div className="panel__body">
      <div className="layer-list">
        {artboards.map((artboard, index) => (
          <div
            key={artboard.id}
            className={`layer-row${app.doc.activeArtboardId === artboard.id ? " is-selected" : ""}`}
            onClick={() => {
              app.doc.activeArtboardId = artboard.id;
              app.requestRender(true);
              notify();
            }}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === "Enter") app.doc.activeArtboardId = artboard.id;
            }}
          >
            <span className="layer-row__swatch" style={{ background: "#fff", border: "1px solid var(--hairline-soft)" }} />
            <span className="layer-row__name">{artboard.name}</span>
            <span className="layer-row__type">{fmt(artboard.w, 0)}×{fmt(artboard.h, 0)}</span>
          </div>
        ))}
      </div>
      <Row wrap>
        <Btn small onClick={() => app.addArtboard()}>New Artboard</Btn>
        <Btn small onClick={() => app.fitArtboardToArtwork()}>Fit to Artwork</Btn>
        <Btn
          small
          onClick={() => {
            const artboard = activeArtboard(app.doc);
            if (artboard && artboards.length > 1) app.deleteArtboard(artboard.id);
          }}
        >
          Delete
        </Btn>
      </Row>
      <Row>
        <RowLabel width={44}>Artboard</RowLabel>
        <span className="spacer" />
        <span className="label">{artboards.length} total</span>
      </Row>
    </div>
  );
}

/* ------------------------------------------------------------------ colour */

export function ColorPanel() {
  const color = currentColor() || "#808080";
  const hsv = hexToHsv(color);
  const rgb = hexToRgb(color);
  const fill = app.currentFill();
  const stroke = app.currentStroke();
  const apply = (next) => {
    app.applyColor(next);
    app.requestRender(true);
    app.refreshPanels();
  };

  return (
    <div className="panel__body">
      <Row>
        <div className="proxy">
          <button
            type="button"
            className={`proxy__fill${app.target === "fill" ? " is-target" : ""}${fill ? "" : " proxy__none"}`}
            style={{ background: paintCss(fill) }}
            title="Fill"
            onClick={() => { app.setTarget("fill"); notify(); }}
          />
          <button
            type="button"
            className={`proxy__stroke${app.target === "stroke" ? " is-target" : ""}${stroke ? "" : " proxy__none"}`}
            style={{ background: stroke?.color || "transparent" }}
            title="Stroke"
            onClick={() => { app.setTarget("stroke"); notify(); }}
          />
        </div>
        <div className="grow" style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <input
            className="spectrum"
            type="range"
            min={0}
            max={360}
            value={Math.round(hsv.h)}
            title="Hue"
            onChange={(event) => apply(hsvToHex({ ...hsv, h: Number(event.target.value) }))}
          />
          <Row tight>
            <RowLabel>Hex</RowLabel>
            <TextField value={color} onChange={(value) => {
              const next = value.startsWith("#") ? value : `#${value}`;
              if (/^#[0-9a-f]{6}$/i.test(next)) apply(next);
            }} />
          </Row>
        </div>
      </Row>
      <Row tight>
        <NumField label="R" value={rgb.r} min={0} max={255} dp={0} onChange={(value) => apply(rgbToHex({ ...rgb, r: value }))} />
        <NumField label="G" value={rgb.g} min={0} max={255} dp={0} onChange={(value) => apply(rgbToHex({ ...rgb, g: value }))} />
        <NumField label="B" value={rgb.b} min={0} max={255} dp={0} onChange={(value) => apply(rgbToHex({ ...rgb, b: value }))} />
      </Row>
      <Row>
        <span className="label">Swatches</span>
        <span className="spacer" />
        <Btn small onClick={() => apply(null)}>None</Btn>
      </Row>
      <div className="swatch-grid">
        {SWATCHES.map((swatchColor) => (
          <Swatch
            key={swatchColor}
            color={swatchColor}
            active={String(color).toLowerCase() === swatchColor.toLowerCase()}
            onClick={() => apply(swatchColor)}
          />
        ))}
      </div>
      <Btn
        small
        onClick={() => {
          const value = currentColor();
          if (!value) return;
          if (!SWATCHES.includes(value)) SWATCHES.push(value);
          pushToast(`Added ${value} to swatches`);
          notify();
        }}
      >
        Add Current Color
      </Btn>
    </div>
  );
}

/* ---------------------------------------------------------------- swatches */

export function SwatchesPanel() {
  const color = currentColor();
  return (
    <div className="panel__body">
      <Row>
        <span className="label">Document Swatches</span>
        <span className="spacer" />
      </Row>
      <div className="swatch-grid">
        {SWATCHES.map((swatchColor) => (
          <Swatch
            key={swatchColor}
            color={swatchColor}
            active={String(color || "").toLowerCase() === swatchColor.toLowerCase()}
            onClick={() => {
              app.applyColor(swatchColor);
              app.requestRender(true);
              app.refreshPanels();
            }}
          />
        ))}
      </div>
      <Row>
        <Btn small onClick={() => {
          if (color && !SWATCHES.includes(color)) SWATCHES.push(color);
          notify();
        }}>
          New Swatch
        </Btn>
        <Btn small onClick={() => pushToast("All swatches are in use")}>Select All Unused</Btn>
      </Row>
      <Hint>Click a swatch to apply it to the selected fill or stroke.</Hint>
    </div>
  );
}

/* ---------------------------------------------------------------- gradient */

export function GradientPanel() {
  const fill = app.currentFill();
  const isGradient = fill?.type === "gradient" || fill?.type === "radial";
  const stops = isGradient ? fill.stops || [] : [];
  const [selectedStop, setSelectedStop] = useState(0);

  const applyFill = (next) => {
    app.applyFillPaint(next);
    app.requestRender(true);
    app.refreshPanels();
  };

  const ensureGradient = () => ({
    type: "gradient",
    angle: 90,
    stops: [{ offset: 0, color: "#ffffff" }, { offset: 1, color: "#000000" }],
    ...(isGradient ? JSON.parse(JSON.stringify(fill)) : {}),
  });

  const setStop = (index, patch) => {
    const base = ensureGradient();
    base.stops = base.stops.map((stop, i) => (i === index ? { ...stop, ...patch } : stop));
    applyFill(base);
  };

  return (
    <div className="panel__body">
      <Row>
        <SelectField
          value={isGradient ? fill.type : "linear"}
          options={[{ value: "linear", label: "Linear Gradient" }, { value: "radial", label: "Radial Gradient" }]}
          onChange={(value) => {
            const base = ensureGradient();
            base.type = value;
            applyFill(base);
          }}
        />
        <NumField label="∠" value={isGradient ? fill.angle ?? 90 : 90} min={-360} max={360} dp={0} width={66} onChange={(value) => {
          const base = ensureGradient();
          base.angle = value;
          applyFill(base);
        }} />
        <IconButton
          name="flipH"
          title="Reverse gradient"
          onClick={() => {
            if (!isGradient) return;
            const next = ensureGradient();
            next.stops = next.stops.map((stop) => ({ ...stop, offset: 1 - stop.offset })).reverse();
            applyFill(next);
          }}
        />
      </Row>
      <div className={`gradient-bar${isGradient ? "" : " is-empty"}`} style={{ background: isGradient ? paintCss(fill) : "var(--well)" }}>
        {isGradient
          ? stops.map((stop, index) => (
              <button
                key={`${stop.offset}-${index}`}
                type="button"
                className={`gradient-stop${selectedStop === index ? " is-active" : ""}`}
                style={{ left: `${stop.offset * 100}%`, background: stop.color }}
                title={`Stop ${index + 1}: ${stop.color} at ${Math.round(stop.offset * 100)}%`}
                onClick={() => setSelectedStop(index)}
              />
            ))
          : null}
      </div>
      {isGradient ? (
        <>
          <Row tight>
            <RowLabel>Stop</RowLabel>
            <ColorField
              label="Color"
              value={stops[selectedStop]?.color || "#000000"}
              onChange={(value) => setStop(selectedStop, { color: value })}
            />
          </Row>
          <Row tight>
            <RowLabel>Pos</RowLabel>
            <NumField
              value={Math.round((stops[selectedStop]?.offset ?? 0) * 100)}
              min={0}
              max={100}
              dp={0}
              width={56}
              onChange={(value) => setStop(selectedStop, { offset: value / 100 })}
            />
            <span className="label">%</span>
            <span className="spacer" />
            <IconButton
              name="plus"
              title="Add stop"
              size={12}
              onClick={() => {
                const base = ensureGradient();
                base.stops = [...base.stops, { offset: 0.5, color: currentColor() || "#808080" }].sort((a, b) => a.offset - b.offset);
                applyFill(base);
              }}
            />
            <IconButton
              name="minus"
              title="Remove stop"
              size={12}
              disabled={stops.length <= 2}
              onClick={() => {
                const base = ensureGradient();
                if (base.stops.length <= 2) return;
                base.stops = base.stops.filter((_, index) => index !== selectedStop);
                applyFill(base);
              }}
            />
          </Row>
        </>
      ) : (
        <Hint>Select artwork with a fill, then choose a gradient type to convert it.</Hint>
      )}
      <Row>
        <RowLabel>Presets</RowLabel>
        <span className="spacer" />
        <Btn small onClick={() => applyFill({ type: "gradient", angle: 90, stops: [{ offset: 0, color: "#ff9a00" }, { offset: 1, color: "#330000" }] })}>Sunset</Btn>
        <Btn small onClick={() => applyFill({ type: "radial", stops: [{ offset: 0, color: "#ffffff" }, { offset: 1, color: "#2d8ceb" }] })}>Spotlight</Btn>
      </Row>
    </div>
  );
}

/* -------------------------------------------------------------- appearance */

export function AppearancePanel() {
  const nodes = app.selectionNodes();
  const first = nodes[0];
  const rows = [];
  if (first?.fill) {
    rows.push({
      kind: "fill",
      label: first.fill.type === "radial" ? "Radial Fill" : first.fill.type === "gradient" ? "Gradient Fill" : "Fill",
      value: first.fill.type === "gradient" || first.fill.type === "radial" ? first.fill.type : first.fill.color,
      paint: first.fill,
    });
  }
  if (first?.stroke) {
    rows.push({ kind: "stroke", label: "Stroke", value: `${fmt(first.stroke.width, 2)} px`, paint: { type: "solid", color: first.stroke.color } });
  }
  return (
    <div className="panel__body">
      <Row>
        <span className="label">Appearance</span>
        <span className="spacer" />
        <IconButton
          name="trash"
          title="Clear appearance"
          onClick={() => {
            app.mutate("clear-appearance", () => {
              for (const node of app.selectionNodes()) {
                node.fill = null;
                node.stroke = null;
              }
            });
            app.requestRender(true);
          }}
        />
      </Row>
      <div className="appearance-list">
        {rows.length === 0 ? <Empty>No selection. Appearance applies to new artwork.</Empty> : null}
        {rows.map((row) => (
          <div
            key={row.kind}
            className={`appearance-row${app.target === row.kind ? " is-active" : ""}`}
            onClick={() => { app.setTarget(row.kind === "stroke" ? "stroke" : "fill"); notify(); }}
            role="button"
            tabIndex={0}
            onKeyDown={() => {}}
          >
            <span className="appearance-row__eye"><Icon name="eye" size={12} /></span>
            <span className="appearance-row__swatch" style={{ background: paintCss(row.paint), width: 16, height: 14 }} />
            <span>{row.label}</span>
            <span className="appearance-row__value">{row.value}</span>
          </div>
        ))}
        <div className="appearance-row">
          <span className="appearance-row__eye"><Icon name="transparency" size={12} /></span>
          <span className="appearance-row__swatch" style={{ background: "linear-gradient(90deg,#fff,#999)", width: 16, height: 14 }} />
          <span>Opacity</span>
          <span className="appearance-row__value">{Math.round((first?.opacity ?? 1) * 100)}%</span>
        </div>
      </div>
      <Row tight>
        <RowLabel>Opacity</RowLabel>
        <Slider value={Math.round((first?.opacity ?? 1) * 100)} onChange={(value) => setOpacity(value / 100)} />
      </Row>
      <Row wrap>
        <Btn
          small
          onClick={() => {
            if (!app.selection.length) return;
            app.mutate("add-fill", () => {
              for (const node of app.selectionNodes()) node.fill = { type: "solid", color: app.fill?.color || "#2d8ceb" };
            });
            app.requestRender(true);
          }}
        >
          Add New Fill
        </Btn>
        <Btn
          small
          onClick={() => {
            if (!app.selection.length) return;
            app.mutate("add-stroke", () => {
              for (const node of app.selectionNodes()) node.stroke = { ...app.newStroke() };
            });
            app.requestRender(true);
          }}
        >
          Add Stroke
        </Btn>
      </Row>
    </div>
  );
}

/* ------------------------------------------------------------ transparency */

export function TransparencyPanel() {
  const first = app.selectionNodes()[0];
  const opacity = Math.round((first?.opacity ?? 1) * 100);
  const blend = first?.blendMode || "source-over";
  return (
    <div className="panel__body">
      <Row>
        <RowLabel>Opacity</RowLabel>
        <NumField value={opacity} min={0} max={100} dp={0} width={58} onChange={(value) => setOpacity(value / 100)} />
        <span className="label">%</span>
      </Row>
      <Slider value={opacity} onChange={(value) => setOpacity(value / 100)} />
      <Row>
        <RowLabel>Blend</RowLabel>
        <SelectField
          value={blend}
          options={[
            ["source-over", "Normal"], ["multiply", "Multiply"], ["screen", "Screen"], ["overlay", "Overlay"],
            ["darken", "Darken"], ["lighten", "Lighten"], ["color-dodge", "Color Dodge"], ["color-burn", "Color Burn"],
            ["hard-light", "Hard Light"], ["soft-light", "Soft Light"], ["difference", "Difference"],
            ["exclusion", "Exclusion"], ["hue", "Hue"], ["saturation", "Saturation"], ["color", "Color"], ["luminosity", "Luminosity"],
          ].map(([value, label]) => ({ value, label }))}
          onChange={(value) => {
            app.mutate("blend", () => {
              for (const node of app.selectionNodes()) node.blendMode = value;
            });
            app.requestRender(true);
          }}
        />
      </Row>
      <Checkbox label="Isolate Blending" onChange={() => pushToast("Isolate blending is a group-level preview hint")} />
      <Hint>Transparency affects the selected artwork and composites against the artboard.</Hint>
    </div>
  );
}

/* ------------------------------------------------------------------ stroke */

export function StrokePanel() {
  const stroke = app.currentStrokeWithDefaults();
  const dashValue = (stroke.dash || []).join(" ");
  return (
    <div className="panel__body">
      <Row>
        <RowLabel>Weight</RowLabel>
        <NumField value={stroke.width} min={0} max={500} step={0.5} dp={2} width={74} onChange={(value) => app.setStrokeProp("width", value)} />
        <span className="label">px</span>
      </Row>
      <Slider value={Math.min(24, stroke.width || 0)} min={0} max={24} step={0.5} onChange={(value) => app.setStrokeProp("width", value)} />
      <Row>
        <RowLabel>Cap</RowLabel>
        <div className="segmented">
          {[["capButt", "butt", "Butt cap"], ["capRound", "round", "Round cap"], ["capSquare", "square", "Projecting cap"]].map(([iconName, value, title]) => (
            <button
              key={value}
              type="button"
              className={`segmented__btn${(stroke.cap || "butt") === value ? " is-active" : ""}`}
              title={title}
              onClick={() => app.setStrokeProp("cap", value)}
            >
              <Icon name={iconName} size={14} />
            </button>
          ))}
        </div>
        <span className="label" style={{ marginLeft: 8 }}>Join</span>
        <div className="segmented">
          {[["joinMiter", "miter", "Miter join"], ["joinRound", "round", "Round join"], ["joinBevel", "bevel", "Bevel join"]].map(([iconName, value, title]) => (
            <button
              key={value}
              type="button"
              className={`segmented__btn${(stroke.join || "miter") === value ? " is-active" : ""}`}
              title={title}
              onClick={() => app.setStrokeProp("join", value)}
            >
              <Icon name={iconName} size={14} />
            </button>
          ))}
        </div>
      </Row>
      <Row>
        <RowLabel>Dash</RowLabel>
        <SelectField
          value={["", "4 3", "1 3", "8 4 2 4", "12 6", "2 2"].includes(dashValue) ? dashValue : ""}
          options={[
            { value: "", label: "Solid Line" },
            { value: "4 3", label: "Dashed 4 / 3" },
            { value: "1 3", label: "Dotted 1 / 3" },
            { value: "8 4 2 4", label: "Dash Dot" },
            { value: "12 6", label: "Long Dash" },
            { value: "2 2", label: "Fine Dash" },
          ]}
          onChange={(value) => app.setStrokeProp("dash", value ? value.split(" ").map(Number) : [])}
        />
      </Row>
      <div className="stroke-presets">
        {[
          ["1 pt", [], 1], ["2 pt", [], 2], ["3 pt", [], 3], ["4 pt", [], 4],
          ["Dashed", [4, 3], 2], ["Dotted", [1, 3], 2], ["Dash Dot", [8, 4, 2, 4], 2],
        ].map(([title, dash, thickness]) => (
          <button
            key={title}
            type="button"
            className="stroke-preset"
            title={`${title} stroke`}
            onClick={() => {
              app.setStrokeProp("width", thickness);
              app.setStrokeProp("dash", dash);
            }}
          >
            <span className="stroke-preset__bar" style={{ height: thickness }} />
          </button>
        ))}
      </div>
      <Row>
        <Btn small onClick={() => app.outlineStroke()}>Outline Stroke</Btn>
        <Btn small onClick={() => {
          app.setStrokeProp("width", 1);
          app.setStrokeProp("dash", []);
        }}>
          Reset
        </Btn>
      </Row>
    </div>
  );
}

/* ------------------------------------------------------------------- align */

export function AlignPanel() {
  return (
    <div className="panel__body">
      <SelectField
        value={app.alignTo}
        options={[
          { value: "selection", label: "Align to Selection" },
          { value: "artboard", label: "Align to Artboard" },
          { value: "key", label: "Align to Key Object" },
        ]}
        onChange={(value) => { app.alignTo = value; notify(); }}
      />
      <div className="align-grid" style={{ gridTemplateColumns: "repeat(6, 1fr)", gap: 3 }}>
        {[
          ["alignLeft", "horizontalAlignLeft"], ["alignCenterH", "horizontalAlignCenter"], ["alignRight", "horizontalAlignRight"],
          ["alignTop", "verticalAlignTop"], ["alignCenterV", "verticalAlignCenter"], ["alignBottom", "verticalAlignBottom"],
          ["distributeH", "distributeHorizontalCenter"], ["distributeV", "distributeVerticalCenter"],
          ["spaceH", "distributeSpacingHorizontal"], ["spaceV", "distributeSpacingVertical"],
        ].map(([iconName, mode]) => (
          <button
            key={mode}
            type="button"
            className="align-btn"
            title={mode.replace(/([A-Z])/g, " $1").toLowerCase()}
            onClick={() => app.align(mode.startsWith("distributeSpacing") ? "distribute" : mode.startsWith("distribute") ? "distribute" : "align", mode)}
          >
            <Icon name={iconName} size={16} />
          </button>
        ))}
      </div>
      <Row>
        <RowLabel>Spacing</RowLabel>
        <NumField value={app.spacing} min={0} dp={1} width={60} onChange={(value) => { app.spacing = value; }} />
        <span className="label">px</span>
        <span className="spacer" />
        <IconButton name="alignLeft" title="Align left to artboard" size={12} onClick={() => app.align("align", "horizontalAlignLeft", true)} />
        <IconButton name="alignTop" title="Align top to artboard" size={12} onClick={() => app.align("align", "verticalAlignTop", true)} />
      </Row>
      <Hint>Select objects to align. With one object selected, alignment uses the active artboard.</Hint>
    </div>
  );
}

/* -------------------------------------------------------------- pathfinder */

export function PathfinderPanel() {
  const disabled = app.selection.length < 2;
  const operations = [
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
  return (
    <div className="panel__body">
      <div className="pf-grid" style={{ gridTemplateColumns: "repeat(5, 1fr)" }}>
        {operations.map(([iconName, label, tip]) => (
          <button
            key={iconName}
            type="button"
            className="pf-btn"
            title={`${label} — ${tip}`}
            disabled={disabled}
            onClick={() => app.applyPathfinder(iconName)}
          >
            <Icon name={iconName} size={17} />
          </button>
        ))}
      </div>
      <Row wrap>
        <Btn small disabled={disabled} onClick={() => app.applyPathfinder("unite")}>Unite</Btn>
        <Btn small disabled={disabled} onClick={() => app.applyPathfinder("minusFront")}>Minus Front</Btn>
        <Btn small disabled={disabled} onClick={() => app.applyPathfinder("intersect")}>Intersect</Btn>
      </Row>
      <Hint>Pathfinder operations use the stacking order: the backmost selected shape receives minus-front subtractions.</Hint>
    </div>
  );
}

/* --------------------------------------------------------------- transform */

export function TransformPanel() {
  const bounds = app.selectionBounds();
  return (
    <div className="panel__body">
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
        <NumField label="X" value={bounds?.x ?? 0} onChange={(value) => moveSelection("x", value)} />
        <NumField label="Y" value={bounds?.y ?? 0} onChange={(value) => moveSelection("y", value)} />
        <NumField label="W" value={bounds?.w ?? 0} min={0.01} onChange={(value) => resizeSelection("w", value)} />
        <NumField label="H" value={bounds?.h ?? 0} min={0.01} onChange={(value) => resizeSelection("h", value)} />
      </div>
      <Row>
        <RowLabel>Rotate</RowLabel>
        <NumField value={0} min={-360} max={360} dp={0} width={62} onChange={(value) => rotateBy(value)} />
        <Btn small onClick={() => rotateBy(90)}>90°</Btn>
        <Btn small onClick={() => rotateBy(-90)}>-90°</Btn>
      </Row>
      <Row>
        <RowLabel>Shear</RowLabel>
        <NumField value={0} min={-80} max={80} dp={0} width={62} onChange={(value) => shearBy(value)} />
        <Btn small onClick={() => flip("h")}>Flip H</Btn>
        <Btn small onClick={() => flip("v")}>Flip V</Btn>
      </Row>
      <Row>
        <RowLabel>Arrange</RowLabel>
        <Btn small onClick={() => app.arrange("front")}>Front</Btn>
        <Btn small onClick={() => app.arrange("forward")}>+</Btn>
        <Btn small onClick={() => app.arrange("backward")}>-</Btn>
        <Btn small onClick={() => app.arrange("back")}>Back</Btn>
      </Row>
      <Hint>Values apply relative to the current selection bounds.</Hint>
    </div>
  );
}

/* --------------------------------------------------------------- character */

export function CharacterPanel() {
  const node = app.selectionNodes().find((candidate) => candidate.type === "text");
  if (!node) {
    return (
      <div className="panel__body">
        <Empty>Select type to edit its character attributes.</Empty>
        <Btn small onClick={() => app.setTool("type")}>Type Tool</Btn>
      </div>
    );
  }
  const metrics = textMetrics(node);
  return (
    <div className="panel__body">
      <Row>
        <SelectField
          value={node.fontFamily}
          options={[
            "Helvetica Neue, Helvetica, Arial, sans-serif", "Arial, Helvetica, sans-serif", "Georgia, serif",
            "Times New Roman, Times, serif", "Courier New, Courier, monospace", "Verdana, Geneva, sans-serif",
            "Trebuchet MS, sans-serif", "Impact, Haettenschweiler, sans-serif", "Palatino, Palatino Linotype, serif",
            "Baskerville, serif", "Menlo, Consolas, monospace",
          ].map((value) => ({ value, label: value.split(",")[0] }))}
          onChange={(value) => app.setTextProps({ fontFamily: value })}
        />
      </Row>
      <Row>
        <SelectField
          value={String(node.fontWeight || 400)}
          options={[
            { value: "300", label: "Light" },
            { value: "400", label: "Regular" },
            { value: "500", label: "Medium" },
            { value: "700", label: "Bold" },
            { value: "900", label: "Black" },
          ]}
          onChange={(value) => app.setTextProps({ fontWeight: Number(value) })}
        />
        <NumField value={node.fontSize} min={1} max={720} dp={0} width={54} onChange={(value) => app.setTextProps({ fontSize: value })} title="Font size" />
        <IconButton name="bold" title="Bold" active={node.fontWeight >= 600} onClick={() => app.setTextProps({ fontWeight: node.fontWeight >= 600 ? 400 : 700 })} />
        <IconButton name="italic" title="Italic" active={node.fontStyle === "italic"} onClick={() => app.setTextProps({ fontStyle: node.fontStyle === "italic" ? "normal" : "italic" })} />
      </Row>
      <Row>
        <RowLabel>Tracking</RowLabel>
        <NumField value={node.letterSpacing || 0} min={-20} max={100} step={0.5} dp={1} width={58} onChange={(value) => app.setTextProps({ letterSpacing: value })} />
        <RowLabel>Leading</RowLabel>
        <NumField
          value={node.lineHeight || Math.round(node.fontSize * 1.2)}
          min={1}
          dp={0}
          width={58}
          onChange={(value) => app.setTextProps({ lineHeight: value })}
        />
      </Row>
      <Row>
        <RowLabel>Align</RowLabel>
        <IconButton name="typeLeft" title="Left" active={node.align === "left"} onClick={() => app.setTextProps({ align: "left" })} />
        <IconButton name="typeCenter" title="Center" active={node.align === "center"} onClick={() => app.setTextProps({ align: "center" })} />
        <IconButton name="typeRight" title="Right" active={node.align === "right"} onClick={() => app.setTextProps({ align: "right" })} />
        <IconButton name="typeJustify" title="Justify" active={node.align === "justify"} onClick={() => app.setTextProps({ align: "justify" })} />
        <span className="spacer" />
        <Btn small onClick={() => app.convertTextToOutlines()}>Create Outlines</Btn>
      </Row>
      <Hint>{metrics.lines.length} line{metrics.lines.length === 1 ? "" : "s"} · {fmt(metrics.width, 1)} × {fmt(metrics.height, 1)} px</Hint>
    </div>
  );
}

/* --------------------------------------------------------------- paragraph */

export function ParagraphPanel() {
  const node = app.selectionNodes().find((candidate) => candidate.type === "text");
  if (!node) {
    return (
      <div className="panel__body">
        <Empty>Select type to edit paragraph attributes.</Empty>
      </div>
    );
  }
  return (
    <div className="panel__body">
      <Row>
        <RowLabel>Align</RowLabel>
        <IconButton name="typeLeft" title="Align left" active={node.align === "left"} onClick={() => app.setTextProps({ align: "left" })} />
        <IconButton name="typeCenter" title="Align center" active={node.align === "center"} onClick={() => app.setTextProps({ align: "center" })} />
        <IconButton name="typeRight" title="Align right" active={node.align === "right"} onClick={() => app.setTextProps({ align: "right" })} />
        <IconButton name="typeJustify" title="Justify" active={node.align === "justify"} onClick={() => app.setTextProps({ align: "justify" })} />
      </Row>
      <Row>
        <RowLabel>Leading</RowLabel>
        <NumField
          value={node.lineHeight || Math.round(node.fontSize * 1.2)}
          min={1}
          dp={0}
          width={62}
          onChange={(value) => app.setTextProps({ lineHeight: value })}
        />
        <span className="label">px</span>
      </Row>
      <Row>
        <RowLabel>Type</RowLabel>
        <SelectField
          value={node.vertical ? "vertical" : "horizontal"}
          options={[
            { value: "horizontal", label: "Horizontal" },
            { value: "vertical", label: "Vertical (rotated)" },
          ]}
          onChange={(value) => app.setTextProps({ vertical: value === "vertical" })}
        />
      </Row>
      <Hint>Paragraph options apply to the selected type object.</Hint>
    </div>
  );
}

/* --------------------------------------------------------------------- REA */

export function ReaPanel() {
  const report = app.rea?.report || null;
  const log = app.rea?.log || [];
  const rows = [
    ["Objects", report?.objects ?? "—"],
    ["Paths", report?.paths ?? "—"],
    ["Anchors", report?.nodes ?? "—"],
    ["Groups", report?.groups ?? "—"],
    ["Fills / Strokes", report ? `${report.fills} / ${report.strokes}` : "—"],
    ["Gradients", report?.gradients ?? "—"],
    ["Colors", report ? (report.colors || []).length : "—"],
    ["Digest", report?.digest || "—"],
  ];
  return (
    <div className="panel__body">
      <Row>
        <span className="label">REA Evidence</span>
        <span className="spacer" />
        <Btn
          small
          onClick={() => {
            app.rea.analyze(app.doc);
            app.rea.exportEvidence();
            pushToast("Evidence ledger exported");
            notify();
          }}
        >
          Export Ledger
        </Btn>
        <Btn small onClick={() => { app.rea.analyze(app.doc); notify(); }}>Analyze</Btn>
      </Row>
      <div className="info-grid">
        {rows.map(([label, value]) => (
          <span key={String(label)} style={{ display: "contents" }}>
            <span className="label">{label}</span>
            <span className="value">{String(value)}</span>
          </span>
        ))}
      </div>
      <div className="layer-list" style={{ maxHeight: 160 }}>
        {log.slice(0, 18).map((entry, index) => (
          <div className="layer-row" key={`${entry.time}-${index}`}>
            <span className="layer-row__name">{entry.label}</span>
            <span className="layer-row__type">{entry.time}</span>
          </div>
        ))}
      </div>
      <Hint>
        Every edit emits a structural evidence record (counts, paint usage and a stable digest) so the artwork can be
        audited with the REA toolkit.
      </Hint>
    </div>
  );
}

/* --------------------------------------------------------------- workspace */

export function WorkspacePanel() {
  const cloud = ui.cloud;
  return (
    <div className="panel__body">
      <Row>
        <span className="label">Server</span>
        <span className="spacer" />
        <span className={`pill ${cloud.status === "offline" ? "pill--local" : "pill--ok"}`}>
          {cloud.status === "offline" ? "Offline" : cloud.health?.php ? `PHP ${cloud.health.php}` : "Connected"}
        </span>
      </Row>
      <div className="info-grid">
        <span className="label">Documents</span><span className="value">{cloud.stats?.documents ?? 0}</span>
        <span className="label">Storage</span><span className="value">{cloud.stats?.bytes ? `${Math.round(cloud.stats.bytes / 1024)} KB` : "—"}</span>
        <span className="label">Current</span>
        <span className="value">
          {cloud.currentId ? `${cloud.currentId} · r${cloud.revision}` : cloud.localDraftId ? `local draft r${cloud.localRevision}` : "unsaved"}
        </span>
      </div>
      <Row wrap>
        <Btn small onClick={() => app.commands.saveDocument()}>Save</Btn>
        <Btn small onClick={() => setUI({ saveAsOpen: true })}>Save As…</Btn>
        <Btn small onClick={() => setUI({ browseOpen: true })}>Browse…</Btn>
        <Btn small onClick={() => setUI({ historyOpen: true })} disabled={!cloud.currentId?.startsWith("doc_")}>History…</Btn>
      </Row>
      <Row wrap>
        <Btn small onClick={() => app.cloud?.exportServer?.("svg")} disabled={!cloud.currentId}>Server SVG</Btn>
        <Btn small onClick={() => app.cloud?.publishPng?.()} disabled={!cloud.currentId}>Publish PNG</Btn>
      </Row>
      <Hint>Documents are validated and versioned by the PHP API; every save stores a revision you can restore.</Hint>
    </div>
  );
}
