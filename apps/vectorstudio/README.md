# VectorStudio

An Adobe Illustrator–style vector workspace that runs entirely in the browser.
It is a single-page, dependency-free application (plain HTML, CSS and ES modules)
built to sit alongside REA and the [VectorCraft](https://github.com/storytold/vectorcraft)
open-source vector engine:

- **REA** (`morluto/rea`) supplies the evidence-first discipline: every edit is
  recorded, document topology is counted, and a content digest can be exported as
  a `rea.evidence/1` JSON ledger from the **REA Analysis** panel.
- **VectorCraft** (pure-Rust vector editor) sets the interaction benchmark:
  artboards, Pen and Direct Selection with real Bézier anchors, Pathfinder
  booleans, live gradients, editable type, layers and dark/light themes.
- **Adobe Illustrator** sets the interface benchmark: 24 px menu bar, control bar,
  two-column tool well, panel dock, rulers, smart guides and the
  selection/scale/rotate chrome.

## Open it

**Permanent link (no sandbox, no server):**
<https://mufaddalsaleh7-spec.github.io/rea/vectorstudio.html>

That address is served by GitHub Pages from `.github/workflows/vectorstudio-pages.yml`.
Enable it once: **Settings → Pages → Build and deployment → Source: GitHub
Actions**. Every push that touches `vectorstudio.html` or `index.html` then
republishes automatically, and the link never depends on a development sandbox,
a preview proxy or a running process.

> Sandbox preview URLs (`https://<port>-<sandbox-id>.e2b.app`) are scoped to one
> ephemeral sandbox. When that sandbox pauses, resumes under a different
> binding, or is replaced, the proxy answers `502 Sandbox not found`. Use the
> Pages link or the downloaded file for anything you want to keep.

That file — `vectorstudio.html` — is a single self-contained HTML document with
the stylesheet and every module inlined. Download it and double-click; it runs
offline from `file://`.

## Run from source

The app has no dependencies and no build step:

```sh
cd apps/vectorstudio
python3 -m http.server 4173 --bind 0.0.0.0
# open http://127.0.0.1:4173/
```

Any static file server works, including a sandbox or container preview.

## Rebuild the single-file edition

`vectorstudio.html` is generated; edit the sources, then:

```sh
cd apps/vectorstudio
node build-standalone.mjs      # uses `npx esbuild` once, then inlines everything
```

Copy the result to the repository root to update the published page
(`cp vectorstudio.html ../../vectorstudio.html`).

## What works

| Area | Implemented |
| --- | --- |
| Documents | Artboards (create, resize, fit to artwork, presets), saves as `.vectorstudio` JSON, opens by file picker or drag-and-drop |
| Selection | Selection, Direct Selection (anchors + direction handles), Group, Lasso, marquee, shift/cmd multi-select, layer targeting |
| Transform | Drag-move, 8-handle scale, outside-corner rotate, shear tool, rotate/scale dialogs, flip, exact X/Y/W/H in the control bar and Properties panel |
| Paths | Pen (click for corners, drag for curves, close on first anchor), pencil/brush freehand with curve smoothing, join, reverse, simplify, add/delete anchors |
| Pathfinder | Unite, Minus Front, Intersect, Exclude, Divide, Minus Back, Trim, Merge, Crop, Outline — real boolean geometry (edge splitting, winding classification, ring chaining) |
| Paint | Solid and linear/radial gradients with draggable stops, swatches, stroke width/cap/join/dash, opacity, 16 blend modes, eyedropper |
| Type | Point type, in-place editing overlay, family/size/weight/italic/tracking/leading/alignment, Create Outlines (glyph raster tracing → Bézier contours) |
| Effects | Drop shadow, round corners, roughen, zig-zag, pucker & bloat, arc warp, outline stroke |
| Organise | Layers and groups with visibility/lock/target/rename/reorder-by-stacking, arrange front/back |
| View | Rulers with guide dragging, grid, smart guides with alignment snapping, outline mode, zoom presets, fit artboard/all, actual size, dark and light themes |
| Output | SVG (gradients, layers, text), PNG at 1×/2×/4×, print sheet, JSON round-trip |
| Evidence | Operation log, structural analysis (objects, nodes, open/closed paths, colours, fonts), content digest, SVG self-inspection, JSON export |

## Keyboard

`V` selection · `A` direct selection · `P` pen · `T` type · `M` rectangle ·
`L` ellipse · `N` pencil · `B` brush · `R` rotate · `E` free transform ·
`G` gradient · `I` eyedropper · `H` hand · `Z` zoom · `Shift+O` artboard ·
`Shift+M` shape builder · `Space` pan · `Cmd/Ctrl+Z` undo · `Cmd/Ctrl+Shift+Z`
redo · `Cmd/Ctrl+G` group · `Cmd/Ctrl+]`/`[` stack order · `Cmd/Ctrl+0` fit
artboard · `Cmd/Ctrl+1` actual size · `Cmd/Ctrl+R` rulers · `Cmd/Ctrl+U` smart
guides · `Cmd/Ctrl+Y` outline mode · `Tab` hide chrome · arrows nudge
(`Shift` ×10) · `Shift` constrain · `Alt` duplicate-while-dragging.

Full list: **Help → Keyboard Shortcuts**.

## Architecture

```
apps/vectorstudio/
├── index.html          Application shell (menu bar, control bar, tool well, dock, status bar)
├── css/app.css         Design system: dark/light themes, chrome, fields, panels
└── js/
    ├── main.js         Bootstrap, commands, keyboard map, application state
    ├── doc.js          Document model, primitives, traversal, undo history
    ├── geom.js         Bézier paths, bounds, matrices, flattening, primitives
    ├── pathops.js      Boolean arrangement solver + stroke outlining
    ├── render.js       Scene/overlay canvas renderers, rulers, hit testing
    ├── tools.js        Pointer/keyboard interaction for every tool
    ├── panels.js       Properties, Layers, Color, Stroke, Pathfinder, Type, REA…
    ├── controlbar.js   Context-sensitive control bar
    ├── menus.js        Menu bar definitions
    ├── ui.js           Numeric scrub fields, dialogs, menus, tooltips
    ├── exporters.js    SVG / PNG / print serialisation
    ├── trace.js        Glyph contour extraction for Create Outlines
    └── icons.js        Single-colour 24×24 glyph set
```

Rendering uses two stacked canvases, like a professional editor: the **scene**
canvas repaints only when the document or view changes, while the **overlay**
canvas repaints on hover, selection and drag. Documents are plain JSON, so
history snapshots and file saves are a single `JSON.stringify`.

## Notes and limits

- Everything runs locally; no network calls are made by the app.
- Raster effects that need a pixel pipeline (feather, full 3D) are marked as
  unavailable rather than simulated, and the UI says so.
- Pathfinder output is polygonised at a fine tolerance, the same trade-off
  Illustrator makes for its own boolean results; source paths are untouched.
