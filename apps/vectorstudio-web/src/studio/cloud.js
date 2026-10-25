/**
 * Cloud document workflow (React shell ↔ PHP API).
 *
 * Responsibilities:
 *   - probe the backend and keep `ui.cloud.health` current,
 *   - save / save-as / open / delete / browse documents,
 *   - optimistic-concurrency handling (409 → conflict banner, never silent),
 *   - debounced autosave while a cloud document is open,
 *   - server-side export downloads and PNG/SVG asset uploads,
 *   - an offline fallback in localStorage so the editor never blocks.
 *
 * The document format is exactly what the editor serialises; the PHP layer
 * validates and normalises it (php/src/Domain/DocumentValidator.php).
 */

import { app, commands } from "./app.js";
import { api, ApiError, probeBackend } from "../api/client.js";
import { setCloud, pushToast, setUI, ui, subscribe } from "../ui/overlays.js";
import { activeArtboard } from "../engine/doc.js";
import { toSvg, toCanvas } from "../engine/exporters.js";

const LOCAL_KEY = "vectorstudio.local-documents.v1";
const AUTOSAVE_MS = 2500;

let autosaveTimer = null;
let autosaveInFlight = false;
let pendingAutosave = false;

/** Serialisable document body (no transient editor state). */
export function documentPayload(doc = app.doc) {
  return {
    format: "vectorstudio/1",
    name: doc.name,
    units: doc.units || "px",
    colorMode: doc.colorMode || "RGB",
    artboards: doc.artboards,
    activeArtboardId: doc.activeArtboardId,
    layers: doc.layers,
    guides: doc.guides || [],
  };
}

const slug = (name) => String(name || "artwork").trim().replace(/\s+/g, "-").toLowerCase();

/* ----------------------------------------------------------------- locals */

function readLocal() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) || "[]");
  } catch {
    return [];
  }
}

function writeLocal(list) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(list.slice(0, 25)));
  } catch {
    /* storage full or blocked — cloud remains the source of truth */
  }
}

function localSave(entry) {
  const list = readLocal().filter((item) => item.id !== entry.id);
  list.unshift(entry);
  writeLocal(list);
  return entry;
}

export function localDocuments() {
  return readLocal();
}

/* ------------------------------------------------------------- connection */

export async function bootCloud() {
  const health = await probeBackend();
  if (!health?.ok) {
    setCloud({ status: "offline", health: null, message: "Offline — documents stay in this browser" });
    const locals = localDocuments();
    setCloud({ documents: locals, stats: { documents: locals.length, bytes: 0 } });
    return null;
  }
  setCloud({ status: "ready", health, message: null });
  await refreshDocuments();
  return health;
}

export async function refreshDocuments(search = "") {
  try {
    const result = await api.listDocuments(search);
    setCloud({ documents: result.documents || [], stats: result.stats || null, status: "ready" });
    return result.documents || [];
  } catch (error) {
    if (error instanceof ApiError && error.isOffline) {
      setCloud({ status: "offline", documents: localDocuments(), message: error.message });
    } else {
      pushToast(`Cloud list failed: ${error.message}`);
    }
    return [];
  }
}

/* ------------------------------------------------------------------- save */

/** Save the current document; creates a cloud document on first save. */
export async function saveCurrent({ silent = false } = {}) {
  if (!app.doc) return null;
  const payload = documentPayload();
  const cloud = ui.cloud;

  const isCloudDocument = typeof cloud.currentId === "string" && cloud.currentId.startsWith("doc_");
  if (isCloudDocument && cloud.status === "ready") {
    try {
      setCloud({ status: "saving" });
      const updated = await api.updateDocument(cloud.currentId, {
        document: payload,
        name: app.doc.name,
        baseRevision: cloud.revision,
      });
      app.dirty = false;
      setCloud({
        status: "ready",
        revision: updated.revision,
        currentId: updated.id,
        lastSavedAt: Date.now(),
        message: null,
      });
      if (!silent) pushToast(`Saved “${app.doc.name}” · r${updated.revision}`);
      return updated;
    } catch (error) {
      if (error instanceof ApiError && error.isConflict) {
        setCloud({
          status: "conflict",
          message: `Server has r${error.details?.revision ?? "?"} — your copy is newer`,
        });
        pushToast("Save conflict: the server has a newer revision");
        return null;
      }
      setCloud({ status: "offline", message: error.message });
      pushToast(`Cloud save failed — stored locally (${error.message})`);
      saveLocalCopy();
      return null;
    }
  }

  // No cloud document yet (or offline): keep a local copy and try to create.
  saveLocalCopy(isCloudDocument ? cloud.currentId : null);
  if (cloud.status === "offline") {
    if (!silent) pushToast("Saved locally — no server connection");
    app.dirty = false;
    return null;
  }
  try {
    setCloud({ status: "saving" });
    const created = await api.createDocument(app.doc.name, payload);
    app.dirty = false;
    setCloud({
      status: "ready",
      currentId: created.id,
      revision: created.revision,
      lastSavedAt: Date.now(),
      message: null,
    });
    await refreshDocuments();
    if (!silent) pushToast(`Saved to the workspace · r${created.revision}`);
    return created;
  } catch (error) {
    setCloud({ status: "offline", message: error.message });
    if (!silent) pushToast(`Could not reach the workspace server — saved locally`);
    return null;
  }
}

/**
 * Crash-safe draft in localStorage. Local drafts keep their own revision
 * counter and never masquerade as server document ids.
 */
function saveLocalCopy(cloudId = null) {
  const draftId = cloudId || `local_${slug(app.doc.name)}`;
  const previous = localDocuments().find((item) => item.id === draftId);
  const entry = {
    id: draftId,
    name: app.doc.name,
    revision: (previous?.revision || 0) + 1,
    updatedAt: new Date().toISOString(),
    bytes: JSON.stringify(documentPayload()).length,
    document: documentPayload(),
  };
  localSave(entry);
  setCloud({
    localDraftId: entry.id,
    localRevision: entry.revision,
    lastSavedAt: Date.now(),
    documents: ui.cloud.status === "offline" ? localDocuments() : ui.cloud.documents,
  });
  return entry;
}

/** Save As: always creates a new cloud document. */
export async function saveAs(name) {
  if (!app.doc) return null;
  const previousName = app.doc.name;
  if (name) app.doc.name = name;
  setCloud({ currentId: null, revision: null });
  const created = await saveCurrent({ silent: true });
  if (!created) {
    app.doc.name = previousName;
    pushToast("Save As failed — the server is unreachable");
    return null;
  }
  await refreshDocuments();
  pushToast(`Saved as “${app.doc.name}”`);
  return created;
}

/** Force-overwrite the server copy after a conflict. */
export async function resolveConflictKeepMine() {
  if (!ui.cloud.currentId?.startsWith("doc_")) return;
  try {
    const current = await api.getDocument(ui.cloud.currentId);
    setCloud({ revision: current.revision, status: "ready" });
    await saveCurrent();
  } catch (error) {
    pushToast(`Could not resolve: ${error.message}`);
  }
}

/** Reload the server copy, discarding local changes. */
export async function resolveConflictTakeServer() {
  if (!ui.cloud.currentId) return;
  await openFromCloud(ui.cloud.currentId, { force: true });
  pushToast("Loaded the server revision");
}

/* ------------------------------------------------------------------- open */

export async function openFromCloud(id, { force = false } = {}) {
  if (!force && app.dirty && !window.confirm("Discard unsaved changes and open another document?")) {
    return null;
  }
  try {
    setCloud({ status: "loading" });
    const record = await api.getDocument(id);
    if (!record?.document) throw new Error("Document payload missing");
    app.loadDocument(record.document);
    app.dirty = false;
    setCloud({
      status: "ready",
      currentId: record.id,
      revision: record.revision,
      lastSavedAt: Date.parse(record.updatedAt) || Date.now(),
      message: null,
      browseOpen: false,
    });
    pushToast(`Opened “${record.name}” · r${record.revision}`);
    return record;
  } catch (error) {
    if (id.startsWith("local_") || (error instanceof ApiError && error.isOffline)) {
      const local = localDocuments().find((item) => item.id === id);
      if (local?.document) {
        app.loadDocument(local.document);
        setCloud({ status: "offline", currentId: local.id, revision: local.revision });
        pushToast(`Opened local copy of “${local.name}”`);
        return local;
      }
    }
    setCloud({ status: ui.cloud.health ? "ready" : "offline" });
    pushToast(`Open failed: ${error.message}`);
    return null;
  }
}

export async function deleteDocument(id) {
  try {
    await api.deleteDocument(id);
    writeLocal(readLocal().filter((item) => item.id !== id));
    if (ui.cloud.currentId === id) setCloud({ currentId: null, revision: null });
    await refreshDocuments();
    pushToast("Document deleted");
  } catch (error) {
    pushToast(`Delete failed: ${error.message}`);
  }
}

export async function toggleStar(id, starred) {
  try {
    await api.renameDocument(id, undefined, starred);
    await refreshDocuments();
  } catch (error) {
    pushToast(`Could not update: ${error.message}`);
  }
}

export async function renameDocument(id, name) {
  try {
    await api.renameDocument(id, name);
    await refreshDocuments();
    pushToast("Renamed");
  } catch (error) {
    pushToast(`Rename failed: ${error.message}`);
  }
}

/* -------------------------------------------------------------- revisions */

export async function loadRevisions() {
  if (!ui.cloud.currentId) return [];
  try {
    const result = await api.revisions(ui.cloud.currentId);
    setCloud({ history: result.revisions || [] });
    return result.revisions || [];
  } catch (error) {
    pushToast(`History unavailable: ${error.message}`);
    return [];
  }
}

export async function restoreRevision(revision) {
  if (!ui.cloud.currentId) return;
  try {
    const updated = await api.restoreRevision(ui.cloud.currentId, revision);
    app.loadDocument(updated.document);
    app.dirty = false;
    setCloud({ revision: updated.revision, historyOpen: false });
    pushToast(`Restored revision ${revision}`);
    await loadRevisions();
  } catch (error) {
    pushToast(`Restore failed: ${error.message}`);
  }
}

/* ---------------------------------------------------------------- exports */

/** Export through PHP: the server writes the SVG and returns a stable URL. */
export async function exportFromServer(format = "svg") {
  if (!ui.cloud.currentId) {
    pushToast("Save to the workspace first to use server export");
    return null;
  }
  const artboard = activeArtboard(app.doc);
  const url = api.exportUrl(ui.cloud.currentId, format, artboard?.id);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.rel = "noopener";
  anchor.download = `${slug(app.doc.name)}.${format === "json" ? "vectorstudio" : format}`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  app.rea.record("Server export", `${format.toUpperCase()} ${ui.cloud.currentId}`);
  pushToast(`Server export: ${format.toUpperCase()}`);
  return url;
}

/** Upload the current artboard as a PNG asset and copy its URL. */
export async function publishPng(scale = 2) {
  if (!ui.cloud.currentId) {
    pushToast("Save to the workspace first to publish a PNG");
    return null;
  }
  const artboard = activeArtboard(app.doc);
  const canvas = toCanvas(app.doc, artboard, scale);
  const data = canvas.toDataURL("image/png");
  try {
    const asset = await api.uploadAsset(ui.cloud.currentId, {
      format: "png",
      filename: `${slug(app.doc.name)}@${scale}x.png`,
      data,
    });
    const absolute = new URL(asset.url, window.location.origin).href;
    try {
      await navigator.clipboard.writeText(absolute);
      pushToast("PNG published — link copied");
    } catch {
      pushToast("PNG published");
    }
    app.rea.record("Publish PNG", `${asset.bytes} bytes`);
    return asset;
  } catch (error) {
    pushToast(`Publish failed: ${error.message}`);
    return null;
  }
}

/** Upload an SVG snapshot (used by File ▸ Publish ▸ SVG snapshot). */
export async function publishSvg() {
  if (!ui.cloud.currentId) {
    pushToast("Save to the workspace first to publish an SVG");
    return null;
  }
  const svg = toSvg(app.doc);
  try {
    const asset = await api.uploadAsset(ui.cloud.currentId, {
      format: "svg",
      filename: `${slug(app.doc.name)}.svg`,
      data: `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`,
    });
    pushToast("SVG snapshot published");
    app.rea.record("Publish SVG", `${svg.length} bytes`);
    return asset;
  } catch (error) {
    pushToast(`Publish failed: ${error.message}`);
    return null;
  }
}

/* --------------------------------------------------------------- autosave */

export function scheduleAutosave() {
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    autosaveTimer = null;
    if (!app.dirty) return;
    if (!ui.cloud.currentId?.startsWith("doc_")) {
      // No workspace document yet: keep a crash-safe local draft instead of
      // silently creating documents the author never asked for.
      saveLocalCopy();
      return;
    }
    if (ui.cloud.status === "offline") return;
    if (autosaveInFlight) {
      pendingAutosave = true;
      return;
    }
    autosaveInFlight = true;
    saveCurrent({ silent: true }).finally(() => {
      autosaveInFlight = false;
      if (pendingAutosave) {
        pendingAutosave = false;
        scheduleAutosave();
      }
    });
  }, AUTOSAVE_MS);
}

/** Persist workspace preferences (theme, workspace, dock) through PHP. */
export async function persistSettings() {
  if (ui.cloud.status !== "ready") return;
  try {
    await api.putSettings({
      theme: ui.theme || document.documentElement.dataset.theme || "dark",
      workspace: ui.workspace || app.workspace,
      dockCollapsed: !!app.dockCollapsed,
    });
  } catch {
    /* preferences are best-effort */
  }
}

export async function loadSettings() {
  try {
    const { settings } = await api.getSettings();
    if (settings?.theme) {
      document.documentElement.dataset.theme = settings.theme;
      setUI({ theme: settings.theme });
    }
    if (settings?.workspace) {
      app.workspace = settings.workspace;
      setUI({ workspace: settings.workspace });
    }
    if (typeof settings?.dockCollapsed === "boolean") {
      app.dockCollapsed = settings.dockCollapsed;
    }
  } catch {
    /* first run or offline */
  }
}

/* ------------------------------------------------------------ app wiring */

let wired = false;

/** Register the cloud hooks the studio core calls from its File menu. */
export function wireCloud() {
  if (wired) return;
  wired = true;

  app.cloud = {
    save: () => saveCurrent(),
    saveAs: () => setUI({ saveAsOpen: true }),
    open: () => setUI({ browseOpen: true }),
    exportServer: exportFromServer,
    publishPng,
    publishSvg,
    history: () => setUI({ historyOpen: true }),
    browse: () => setUI({ browseOpen: true }),
    refresh: () => refreshDocuments(),
  };

  // Autosave rides on the panel-refresh notification that every mutation emits.
  const baseRefresh = app.refreshPanels;
  app.refreshPanels = (...args) => {
    baseRefresh(...args);
    if (app.dirty) scheduleAutosave();
  };

  // Preferences are persisted whenever the workspace-affecting UI changes.
  let settingsSig = "";
  let settingsTimer = null;
  subscribe(() => {
    const signature = JSON.stringify([ui.theme, ui.workspace, app.dockCollapsed]);
    if (signature === settingsSig) return;
    settingsSig = signature;
    clearTimeout(settingsTimer);
    settingsTimer = setTimeout(() => { persistSettings(); }, 800);
  });

  // Keep the tab title and inspector in sync with cloud state changes.
  bootCloud().then(() => loadSettings());
}

export { commands };
