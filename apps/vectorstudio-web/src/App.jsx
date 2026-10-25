/**
 * Application shell.
 *
 * Layout mirrors Illustrator's chrome: menu bar, control bar, tool well, stage
 * (tabs → rulers → canvases) and the panel dock, with the status bar at the
 * bottom. React renders the chrome; the studio core paints the artwork and owns
 * the document. Cloud state (PHP workspace) is subscribed from the same store.
 */

import { useEffect, useSyncExternalStore } from "react";
import "./css/app.css";
import { subscribe, getVersion, ui, setUI } from "./ui/overlays.js";
import { app } from "./studio/app.js";
import { bootCloud, wireCloud } from "./studio/cloud.js";
import { MenuBar, DetachedMenu } from "./components/MenuBar.jsx";
import { ControlBar } from "./components/ControlBar.jsx";
import { ToolPalette } from "./components/ToolPalette.jsx";
import { CanvasStage } from "./components/CanvasStage.jsx";
import { Dock } from "./components/Dock.jsx";
import { StatusBar } from "./components/StatusBar.jsx";
import { DialogHost, ToastHost, ConfirmDialog } from "./components/Overlays.jsx";
import {
  CloudStatusHud, ConflictDialog, HistoryDialog, SaveAsDialog, WorkspaceBrowser,
} from "./components/CloudDialogs.jsx";

export function useStudioVersion() {
  return useSyncExternalStore(subscribe, getVersion, getVersion);
}

export default function App() {
  useStudioVersion();

  // Boot once: cloud wiring, stored preferences, then keep the document
  // element in sync with the UI store whenever the theme changes.
  useEffect(() => {
    wireCloud();
    bootCloud();
    const stored = localStorage.getItem("vectorstudio.theme") || "dark";
    document.documentElement.dataset.theme = stored;
    setUI({ theme: stored });
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = ui.theme || "dark";
    localStorage.setItem("vectorstudio.theme", ui.theme || "dark");
  }, [ui.theme]);

  const presentation = app.screenMode === "presentation";

  return (
    <div
      id="app"
      className={[
        "app",
        app.dockCollapsed ? "is-dock-collapsed" : "",
        ui.shellHidden ? "is-shell-hidden" : "",
        presentation ? "is-presentation" : "",
      ].filter(Boolean).join(" ")}
    >
      <MenuBar />
      <ControlBar />
      <div className="workspace">
        <ToolPalette />
        <CanvasStage />
        <Dock />
      </div>
      <StatusBar />
      <CloudStatusHud />

      <DetachedMenu />
      <DialogHost />
      <ToastHost />
      <ConfirmDialog />

      {ui.browseOpen ? <WorkspaceBrowser /> : null}
      {ui.saveAsOpen ? <SaveAsDialog /> : null}
      {ui.historyOpen ? <HistoryDialog /> : null}
      <ConflictDialog />
    </div>
  );
}
