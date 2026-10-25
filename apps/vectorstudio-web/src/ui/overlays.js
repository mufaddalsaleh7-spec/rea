/**
 * Overlay bridge between the imperative studio core and React.
 *
 * The studio core speaks in DOM nodes and coordinates (`showMenu(x, y, items)`,
 * `showDialog({ body: [element] })`); React owns what is actually rendered.
 * This module is the seam:
 *
 *   store   – tiny external store (subscribe/notify) that React reads with
 *             useSyncExternalStore, holding menus, dialogs, toasts and chrome
 *             flags such as theme, dock state and the active workspace.
 *   openMenu / openDialog / openAlert / pushToast
 *           – the API the studio core calls; they only publish state.
 */

const listeners = new Set();
let version = 0;

/** UI-only state; document state lives on `app`. */
export const ui = {
  theme: "dark",
  workspace: "Essentials",
  menu: null,
  dialog: null,
  toast: null,
  shellHidden: false,
  panelsCollapsed: false,
  guideDrag: null,
  guidesWired: false,
  focusGroup: null,
  cloud: {
    status: "idle",
    documents: [],
    stats: null,
    currentId: null,
    revision: null,
    localDraftId: null,
    localRevision: null,
    dirty: false,
    lastSavedAt: null,
    message: null,
    browseOpen: false,
    historyOpen: false,
    history: [],
    health: null,
  },
};

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getVersion() {
  return version;
}

export function notify() {
  version += 1;
  for (const listener of listeners) listener();
}

/** Merge a partial UI update and re-render. */
export function setUI(patch) {
  Object.assign(ui, patch);
  notify();
}

/** Merge a partial cloud-state update and re-render. */
export function setCloud(patch) {
  ui.cloud = { ...ui.cloud, ...patch };
  notify();
}

/* ------------------------------------------------------------------ menus */

export function openMenu(x, y, items, options = {}) {
  setUI({ menu: { x, y, items, minWidth: options.minWidth || 224, sourceEl: options.sourceEl || null } });
  return ui.menu;
}

export function closeMenu() {
  if (ui.menu) setUI({ menu: null });
  document.querySelectorAll(".menu-trigger.is-open").forEach((node) => node.classList.remove("is-open"));
}

/* ---------------------------------------------------------------- dialogs */

let dialogSeq = 0;

/**
 * Publish a dialog. `body`/`footer` are arrays of DOM nodes produced by the
 * widget kit; React renders the frame and mounts the nodes into it.
 * Returns a handle with `close()`, mirroring the old DOM implementation.
 */
export function openDialog({ title, body, footer, width = 460, onClose = null, kind = "custom", meta = null }) {
  closeMenu();
  dialogSeq += 1;
  const id = dialogSeq;
  const nodes = {
    body: (Array.isArray(body) ? body : [body]).filter(Boolean),
    footer: (Array.isArray(footer) ? footer : [footer]).filter(Boolean),
  };
  const handle = {
    id,
    title,
    width,
    kind,
    meta,
    onClose,
    close: () => {
      if (ui.dialog?.id !== id) return;
      setUI({ dialog: null });
      onClose?.();
    },
    reopen: () => {
      setUI({ dialog: null });
      onClose?.();
    },
  };
  setUI({ dialog: { ...handle, nodes } });
  return handle;
}

export function openAlert(title, message) {
  return openDialog({
    title,
    kind: "alert",
    width: 400,
    meta: { message },
    body: [],
    footer: [],
  });
}

/* ----------------------------------------------------------------- toasts */

let toastTimer = null;

export function pushToast(message, ms = 2200) {
  if (!message) return;
  clearTimeout(toastTimer);
  setUI({ toast: { message, at: Date.now() } });
  toastTimer = setTimeout(() => setUI({ toast: null }), ms);
}

/** Close whatever dialog is currently open (used by footer buttons). */
export function closeTopDialog() {
  const current = ui.dialog;
  if (!current) return;
  setUI({ dialog: null });
  current.onClose?.();
}
