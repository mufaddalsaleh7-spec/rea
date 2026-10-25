/**
 * Entry point: mount the React shell. The studio engine boots from
 * <CanvasStage> once the canvases exist, so no imperative DOM setup happens here.
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";

// Debug handle for harnesses and the console (mirrors window.vectorstudio).
createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
