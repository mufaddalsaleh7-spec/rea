/**
 * Two-column tool well with flyouts, matching Illustrator's tool behaviour:
 * click selects the remembered variant, press-and-hold or right-click opens the
 * flyout, and the fill/stroke proxy sits at the bottom with swap, default and
 * target controls.
 */

import { useEffect, useRef, useState } from "react";
import { app, TOOL_DEFS, TOOL_LABELS, TOOL_DEFS_ICON } from "../studio/app.js";
import { openMenu, notify } from "../ui/overlays.js";
import { Icon } from "./ui.jsx";

function gradientCss(paint) {
  if (!paint) return "transparent";
  if (paint.type === "gradient" || paint.type === "radial") {
    const stops = (paint.stops || []).map((stop) => `${stop.color} ${Math.round(stop.offset * 100)}%`).join(",");
    return paint.type === "radial" ? `radial-gradient(circle, ${stops})` : `linear-gradient(120deg, ${stops})`;
  }
  return paint.color || "transparent";
}

export function ToolPalette() {
  const [hovered, setHovered] = useState(null);
  const holdTimer = useRef(null);

  useEffect(() => () => clearTimeout(holdTimer.current), []);

  const openFlyout = (def, element) => {
    const rect = element.getBoundingClientRect();
    openMenu(
      rect.right - 4,
      rect.top,
      (def.flyout || []).map((id) => ({
        label: TOOL_LABELS[id] || id,
        checked: app.tool === id,
        action: () => {
          app.toolMemory[def.id] = id;
          app.setTool(id);
        },
      })),
      { minWidth: 210 },
    );
  };

  const fill = app.currentFill?.() || null;
  const stroke = app.currentStroke?.() || null;

  return (
    <nav id="toolbar" className="toolbar" aria-label="Tools">
      <div className="tool-grid">
        {TOOL_DEFS.map((def) => {
          const current = app.toolMemory[def.id] || def.id;
          const active = app.tool === current || def.flyout?.includes(app.tool);
          return (
            <button
              key={def.id}
              type="button"
              className={`tool${active ? " is-active" : ""}`}
              aria-label={TOOL_LABELS[current] || def.name}
              aria-pressed={app.tool === current}
              onPointerDown={(event) => {
                clearTimeout(holdTimer.current);
                if (event.button === 2) return;
                const element = event.currentTarget;
                holdTimer.current = setTimeout(() => {
                  if (def.flyout?.length > 1) openFlyout(def, element);
                }, 320);
              }}
              onPointerUp={() => clearTimeout(holdTimer.current)}
              onPointerLeave={() => {
                clearTimeout(holdTimer.current);
                setHovered(null);
              }}
              onPointerEnter={() => setHovered(current)}
              onClick={() => {
                clearTimeout(holdTimer.current);
                app.setTool(app.toolMemory[def.id] || def.id);
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                if (def.flyout?.length > 1) openFlyout(def, event.currentTarget);
              }}
            >
              <Icon name={TOOL_DEFS_ICON[current] || "select"} size={18} />
              {def.flyout && def.flyout.length > 1 ? <span className="tool__corner" /> : null}
              {hovered === current ? (
                <span className="tool__tip">
                  {TOOL_LABELS[current] || def.name}
                  {def.key ? <em>{def.key}</em> : null}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      <div className="toolbar__spacer" />
      <div className="toolbar__footer">
        <div className="fill-stroke" title="Fill and Stroke">
          <button
            type="button"
            className={`fill-stroke__swatch fill-stroke__swatch--fill${fill ? "" : " fill-stroke__none"}`}
            style={{
              background: gradientCss(fill),
              outline: app.target === "fill" ? "1px solid var(--accent)" : "none",
            }}
            aria-label="Fill"
            title="Fill — click to target, then pick a colour"
            onClick={() => {
              app.setTarget("fill");
              app.scrollToGroup("color");
              notify();
            }}
          />
          <button
            type="button"
            className={`fill-stroke__swatch fill-stroke__swatch--stroke${stroke && stroke.width ? "" : " fill-stroke__none"}`}
            style={{
              background: stroke && stroke.width ? stroke.color : "transparent",
              outline: app.target === "stroke" ? "1px solid var(--accent)" : "none",
            }}
            aria-label="Stroke"
            title="Stroke — click to target, then pick a colour"
            onClick={() => {
              app.setTarget("stroke");
              app.scrollToGroup("color");
              notify();
            }}
          />
        </div>
        <div className="mini-tools">
          <button
            type="button"
            className="mini-tool"
            title="Swap Fill and Stroke (Shift+X)"
            onClick={() => {
              const currentFill = app.fill;
              app.fill = app.stroke?.enabled ? { type: "solid", color: app.stroke.color } : null;
              app.stroke = { ...app.newStroke(), color: currentFill?.color || "#000000", enabled: true };
              app.mutate("swap-colors", () => {
                for (const node of app.selectionNodes()) {
                  const nodeFill = node.fill;
                  node.fill = node.stroke ? { type: "solid", color: node.stroke.color } : null;
                  node.stroke = nodeFill
                    ? { ...(node.stroke || app.newStroke()), color: nodeFill.color || "#000000" }
                    : node.stroke;
                }
              });
            }}
          >
            <Icon name="swapColors" size={13} />
          </button>
          <button
            type="button"
            className="mini-tool"
            title="Default Fill and Stroke (D)"
            onClick={() => {
              app.fill = { type: "solid", color: "#ffffff" };
              app.stroke = { ...app.newStroke(), color: "#000000", width: 1 };
              app.mutate("default-colors", () => {
                for (const node of app.selectionNodes()) {
                  node.fill = { type: "solid", color: "#ffffff" };
                  node.stroke = { ...app.newStroke(), color: "#000000", width: 1 };
                }
              });
            }}
          >
            <Icon name="defaultColors" size={13} />
          </button>
          <button
            type="button"
            className="mini-tool"
            title="Toggle Fill / Stroke target (X)"
            onClick={() => {
              app.setTarget(app.target === "fill" ? "stroke" : "fill");
              notify();
            }}
          >
            <Icon name="noColor" size={13} />
          </button>
        </div>
      </div>
    </nav>
  );
}
