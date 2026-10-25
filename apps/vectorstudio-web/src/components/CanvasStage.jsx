/**
 * Canvas stage: document tab strip, rulers, the two stacked canvases (scene and
 * overlay) and the invisible text editor. React owns the DOM; the imperative
 * renderer and tool controller attach to these exact nodes, so the engine keeps
 * full control of painting and pointer interaction.
 */

import { useEffect, useRef } from "react";
import { app, initStudio, attachGuideDragging } from "../studio/app.js";
import { DocTabs } from "./DocTabs.jsx";

export function CanvasStage() {
  const booted = useRef(false);
  const areaRef = useRef(null);

  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    initStudio();
    attachGuideDragging();
    const observer = new ResizeObserver(() => app.renderer?.resize());
    if (areaRef.current) observer.observe(areaRef.current);
    return () => observer.disconnect();
  }, []);

  return (
    <main className="stage">
      <DocTabs />
      <div className={`canvas-area${app.showRulers ? "" : " hide-rulers"}`} id="canvas-area" ref={areaRef}>
        <div className="ruler-corner" id="ruler-corner" />
        <canvas id="ruler-h" className="ruler ruler--h" />
        <canvas id="ruler-v" className="ruler ruler--v" />
        <div
          className="viewport"
          id="viewport"
          onContextMenu={(event) => {
            event.preventDefault();
            app.openContextMenu(event.clientX, event.clientY);
          }}
        >
          <canvas id="scene" className="scene" />
          <canvas id="overlay" className="overlay" />
          <div className="text-editor" id="text-editor" contentEditable suppressContentEditableWarning spellCheck={false} hidden />
          <div className="live-preview" id="live-preview" hidden />
        </div>
      </div>
    </main>
  );
}
