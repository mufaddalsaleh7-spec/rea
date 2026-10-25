/**
 * Status bar: zoom control, active tool, artboard, colour mode, selection
 * summary and the REA evidence indicator.
 */

import { useEffect, useState } from "react";
import { app, TOOL_LABELS } from "../studio/app.js";
import { activeArtboard } from "../engine/doc.js";
import { notify, ui } from "../ui/overlays.js";
import { Icon } from "./ui.jsx";

const ZOOM_STOPS = [0.03, 0.0625, 0.125, 0.25, 0.3333, 0.5, 0.6667, 0.75, 1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32, 64];

export function StatusBar() {
  const [custom, setCustom] = useState(null);
  const level = Math.round((app.view?.zoom || 1) * 100);

  useEffect(() => {
    if (!ZOOM_STOPS.some((stop) => Math.round(stop * 100) === level)) setCustom(`${level}%`);
  }, [level]);

  const artboard = app.doc ? activeArtboard(app.doc) : null;
  const cloud = ui.cloud;

  return (
    <footer className="statusbar" id="statusbar">
      <div className="statusbar__group">
        <label className="zoom-control" title="Zoom level">
          <span className="zoom-control__icon" aria-hidden="true">
            <Icon name="zoom" size={12} />
          </span>
          <select
            id="zoom-select"
            aria-label="Zoom level"
            value={String(app.view?.zoom || 1)}
            onChange={(event) => {
              const zoom = parseFloat(event.target.value) || 1;
              app.view.zoomAt(zoom / app.view.zoom, {
                x: app.view.screenWidth / 2,
                y: app.view.screenHeight / 2,
              });
              app.requestRender(true);
              notify();
            }}
          >
            {ZOOM_STOPS.map((stop) => (
              <option key={stop} value={stop}>
                {Math.round(stop * 100)}%
              </option>
            ))}
            {custom ? (
              <option value={String(app.view.zoom)} data-custom="true">
                {custom}
              </option>
            ) : null}
          </select>
        </label>
        <span className="statusbar__sep" />
        <span id="status-tool" className="statusbar__text">
          {TOOL_LABELS[app.tool] || "Selection Tool"}
        </span>
      </div>
      <div className="statusbar__spacer" />
      <div className="statusbar__group statusbar__group--right">
        <span id="status-info" className="statusbar__text statusbar__text--muted">
          {app.status}
        </span>
        <span className="statusbar__sep" />
        <button
          type="button"
          className={`statusbar__badge statusbar__badge--cloud ${cloud.status === "offline" ? "is-local" : ""} ${cloud.status === "saving" ? "is-busy" : ""}`}
          title={
            cloud.status === "offline"
              ? "Workspace server unreachable — documents are kept in this browser"
              : `Workspace: ${cloud.health?.storage?.documents ?? 0} documents · ${cloud.health?.php ? `PHP ${cloud.health.php}` : "PHP"}`
          }
          onClick={() => app.scrollToGroup("workspace")}
        >
          {cloud.status === "offline" ? "Local" : cloud.status === "saving" ? "Saving" : "Workspace"}
        </button>
        <span className="statusbar__sep" />
        <span id="status-artboard" className="statusbar__text">
          {artboard?.name || "Artboard 1"}
        </span>
        <span className="statusbar__sep" />
        <span id="status-mode" className="statusbar__text">
          {app.outlineMode ? "Outline" : app.doc?.colorMode || "RGB"}
        </span>
        <span className="statusbar__sep" />
        <button
          type="button"
          id="status-rea"
          className="statusbar__badge"
          title="REA session: local evidence capture active"
          onClick={() => {
            app.scrollToGroup("rea");
            app.rea.analyze(app.doc);
            app.refreshPanels();
            app.toast("REA evidence refreshed");
          }}
        >
          REA
        </button>
      </div>
    </footer>
  );
}
