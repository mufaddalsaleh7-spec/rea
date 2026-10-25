# VectorStudio Web — React + PHP edition

The Illustrator-grade vector workspace rebuilt as a real web application:

- **React 19 front end** (`src/`) — the entire chrome is declarative: menu bar,
  context control bar, two-column tool palette with flyouts, tabbed document
  bar, rulers, panel dock, status bar, dialogs and the workspace/cloud surfaces.
- **PHP 8.1+ API** (`php/`) — zero-dependency backend that validates, stores and
  versions documents in SQLite, and re-exports artwork as SVG from the server.
- **Shared engine** (`src/engine/`) — the same geometry, document model,
  Pathfinder boolean solver, renderer and tool controller as the single-file
  edition in `../vectorstudio`, so both editions behave identically.

```
apps/vectorstudio-web
├── index.html            Vite entry (mounts #root)
├── src/
│   ├── App.jsx           application shell + store subscription
│   ├── main.jsx          React root
│   ├── api/client.js     fetch client for the PHP API (ApiError, timeouts)
│   ├── components/       MenuBar, ControlBar, ToolPalette, CanvasStage, DocTabs,
│   │                     Dock, panels.jsx (16 panels), Overlays, CloudDialogs, ui.jsx
│   ├── css/app.css       Illustrator chrome (dark + light)
│   ├── engine/           doc, geom, pathops, render, tools, exporters, rea, trace, icons
│   ├── studio/           app.js (model/commands/keyboard), menus.js, cloud.js, selectionOps.js
│   └── ui/               overlays.js (external store), widgets.js, evaluate.js
├── php/
│   ├── public/index.php  front controller
│   ├── bootstrap.php     PSR-4 autoloader (no Composer)
│   ├── src/              App, Http (Request/Response/Router/HttpError),
│   │                     Domain (DocumentValidator, SvgWriter),
│   │                     Storage (SQLite repos), Controllers (documents/assets/settings/health)
│   ├── storage/          SQLite database + uploaded assets (git-ignored)
│   └── tests/run.php     56-assertion integration suite over the real router
├── scripts/
│   ├── php-wasm-server.mjs   runs the PHP app through PHP-WASM (no php binary needed)
│   └── run-php-tests.mjs     runs the PHP suite through PHP-WASM
└── vite.config.js        dev proxy /api → PHP, relative base for portable builds
```

## Run it

### With a real PHP install (recommended)

```bash
cd apps/vectorstudio-web
npm install
npm run build                 # React bundle into dist/
npm run php                   # php -S 127.0.0.1:8080 -t php/public php/public/index.php
open http://127.0.0.1:8080    # PHP serves the bundle, the API and the SPA routes
```

Development with hot reload (two terminals):

```bash
npm run php        # API on :8080
npm run dev        # React on :5173, proxying /api to :8080
```

### Without a PHP binary (PHP-WASM)

```bash
cd apps/vectorstudio-web
npm install
npm start                     # builds, then serves React + PHP through PHP-WASM on :8080
```

`npm start` is what the preview environment uses: `@php-wasm/node` executes the
same `php/` sources (PHP 8.3) and mounts the repository so SQLite storage persists
on disk. Nothing about the API is mocked — routing, validation, SQL and SVG
writing are the production code.

## API

| Method | Path | Purpose |
| ------ | ---- | ------- |
| `GET` | `/api/health` | Service, PHP version, storage stats and limits |
| `GET` | `/api/documents?limit=&q=` | List summaries (no payload) |
| `POST` | `/api/documents` | Create from `{ name, document }` |
| `GET` | `/api/documents/{id}` | Full document + assets |
| `PUT`/`PATCH` | `/api/documents/{id}` | Save artwork (optimistic `baseRevision`) / metadata |
| `DELETE` | `/api/documents/{id}` | Delete document and revisions |
| `GET` | `/api/documents/{id}/revisions` | Revision history |
| `POST` | `/api/documents/{id}/revisions/{rev}/restore` | Restore a revision |
| `GET` | `/api/documents/{id}/export?format=svg\|json` | Server-side export download |
| `GET`/`POST` | `/api/documents/{id}/assets` | List / upload PNG·SVG exports |
| `GET` | `/api/assets/{id}` | Download a stored asset |
| `GET`/`PUT` | `/api/settings` | Workspace preferences (theme, workspace, dock) |

Storage lives in `php/storage/vectorstudio.sqlite` (WAL). Every save writes a
revision; the newest 40 are retained per document. `PUT` with a stale
`baseRevision` returns `409` with the server's revision so the UI can offer
"use server version" or "overwrite with mine" instead of losing work.

Validation (`php/src/Domain/DocumentValidator.php`) is the boundary of record:
artboards/layers are required, colours are normalised to `#rrggbb` (anything
else falls back to a safe default), node counts/depth are budgeted, and payload
size is capped (8 MB documents, 12 MB assets).

## Tests

```bash
npm run test:php          # PHP binary
npm run test:php:wasm     # PHP-WASM, no binary required
```

The suite drives the real router against in-memory SQLite: 56 assertions over
health, CRUD, conflicts, revisions, restore, validation, exports, assets,
settings, SPA fallback and deletes. Latest run: **56 passed, 0 failed**.

Browser verification (Chromium, headless): app boots with 0 console errors,
drawing creates objects, Pathfinder Unite collapses 2 → 1, undo/redo restores
counts, Create Outlines converts type to paths, autosave bumps the revision on
the server, Publish PNG uploads a 271 KB asset, theme/workspace preferences
round-trip through `/api/settings`.

## Differences from the single-file edition

| | `../vectorstudio` (classic) | this edition |
| --- | --- | --- |
| Chrome | imperative DOM kit | React components + external store |
| Persistence | file download / localStorage | PHP + SQLite, revisions, conflict handling |
| Export | in-browser SVG/PNG | in-browser **and** server-side SVG |
| Running without a server | yes (`file://`) | yes, degrades to browser drafts |

Both editions share `engine/`, so geometry, tools and rendering stay in sync.
