/**
 * Workspace dialogs — the React side of the PHP API.
 *
 *   WorkspaceBrowser  – open / rename / star / delete documents stored by PHP
 *   SaveAsDialog      – name and create a new cloud document
 *   HistoryDialog     – revisions from the server, restore any of them
 *   ConflictDialog    – optimistic-concurrency resolution
 */

import { useEffect, useState } from "react";
import { app } from "../studio/app.js";
import { ui, setUI, pushToast, setCloud } from "../ui/overlays.js";
import {
  deleteDocument, loadRevisions, openFromCloud, refreshDocuments, renameDocument,
  resolveConflictKeepMine, resolveConflictTakeServer, restoreRevision, saveAs, saveCurrent,
} from "../studio/cloud.js";
import { Btn, Icon, IconButton } from "./ui.jsx";

const bytes = (value) => {
  if (!value) return "—";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
};

const when = (iso) => {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const minutes = Math.round((Date.now() - date.getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} h ago`;
  return date.toLocaleDateString();
};

function Shell({ title, children, footer, width = 720, onClose }) {
  return (
    <div
      className="modal-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="dialog dialog--wide" role="dialog" aria-modal="true" aria-label={title} style={{ width }}>
        <div className="dialog__titlebar">
          <strong>{title}</strong>
          <button type="button" className="dialog__close" aria-label="Close" onClick={onClose}>
            <Icon name="close" size={12} />
          </button>
        </div>
        <div className="dialog__body">{children}</div>
        <div className="dialog__footer">{footer}</div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ browse */

export function WorkspaceBrowser() {
  const cloud = ui.cloud;
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const close = () => setUI({ browseOpen: false });

  useEffect(() => {
    refreshDocuments();
  }, []);

  const documents = (cloud.documents || []).filter((doc) =>
    !search.trim() || doc.name.toLowerCase().includes(search.trim().toLowerCase()),
  );

  return (
    <Shell
      title={cloud.status === "offline" ? "Workspace — offline copies" : "Workspace documents"}
      width={780}
      onClose={close}
      footer={
        <>
          <span className="dialog__hint" style={{ marginRight: "auto" }}>
            {cloud.status === "offline"
              ? "The PHP API is unreachable. Saves stay in this browser until it returns."
              : `${cloud.stats?.documents ?? documents.length} documents · ${bytes(cloud.stats?.bytes)} stored`}
          </span>
          <Btn onClick={() => app.commands.newDocument()}>New Document</Btn>
          <Btn onClick={async () => { setBusy(true); await refreshDocuments(search); setBusy(false); }} disabled={busy}>
            {busy ? "Refreshing…" : "Refresh"}
          </Btn>
          <Btn variant="primary" onClick={close}>Done</Btn>
        </>
      }
    >
      <div className="row row--tight">
        <input
          className="text-input grow"
          placeholder="Search documents…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") refreshDocuments(search);
          }}
        />
        <Btn onClick={() => refreshDocuments(search)}>Search</Btn>
      </div>

      <div className="doc-list">
        {documents.length === 0 ? (
          <div className="empty-state">No documents yet. Save the current artwork to create one.</div>
        ) : null}
        {documents.map((doc) => (
          <div
            key={doc.id}
            className={`doc-card${cloud.currentId === doc.id ? " is-active" : ""}`}
            role="button"
            tabIndex={0}
            onClick={() => openFromCloud(doc.id)}
            onKeyDown={(event) => {
              if (event.key === "Enter") openFromCloud(doc.id);
            }}
          >
            <span className="doc-card__thumb" aria-hidden="true">
              <Icon name="artboard" size={16} />
            </span>
            <span className="doc-card__meta">
              <strong>{doc.name}</strong>
              <span>
                {doc.width}×{doc.height} · {doc.objects} objects · r{doc.revision} · {when(doc.updatedAt)}
              </span>
            </span>
            <span className="doc-card__actions" onClick={(event) => event.stopPropagation()}>
              <IconButton
                name={doc.starred ? "check" : "star"}
                title={doc.starred ? "Unstar" : "Star"}
                size={13}
                onClick={async () => {
                  await refreshDocuments();
                  setCloud({ documents: ui.cloud.documents.map((item) => (item.id === doc.id ? { ...item, starred: !item.starred } : item)) });
                }}
              />
              <IconButton
                name="hamburger"
                title="Rename"
                size={13}
                onClick={() => {
                  const next = window.prompt("Document name", doc.name);
                  if (next && next.trim()) renameDocument(doc.id, next.trim());
                }}
              />
              <IconButton
                name="trash"
                title="Delete"
                size={13}
                onClick={() => {
                  if (window.confirm(`Delete “${doc.name}” and its revisions?`)) deleteDocument(doc.id);
                }}
              />
            </span>
          </div>
        ))}
      </div>
    </Shell>
  );
}

/* ----------------------------------------------------------------- save as */

export function SaveAsDialog() {
  const [name, setName] = useState(app.doc?.name || "Untitled");
  const [busy, setBusy] = useState(false);
  const close = () => setUI({ saveAsOpen: false });
  return (
    <Shell
      title="Save to Workspace As"
      width={460}
      onClose={close}
      footer={
        <>
          <Btn onClick={close}>Cancel</Btn>
          <Btn
            variant="primary"
            disabled={busy || !name.trim()}
            onClick={async () => {
              setBusy(true);
              const created = await saveAs(name.trim());
              setBusy(false);
              if (created) close();
            }}
          >
            {busy ? "Saving…" : "Save"}
          </Btn>
        </>
      }
    >
      <div className="form-row">
        <span className="label">File name</span>
        <input
          className="text-input grow"
          value={name}
          autoFocus
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && name.trim()) {
              saveAs(name.trim()).then(close);
            }
          }}
        />
      </div>
      <div className="dialog__hint">
        Saves a new revisioned document to the PHP workspace. The current document keeps its identity.
      </div>
    </Shell>
  );
}

/* ---------------------------------------------------------------- history */

export function HistoryDialog() {
  const cloud = ui.cloud;
  const close = () => setUI({ historyOpen: false });
  useEffect(() => {
    loadRevisions();
  }, [cloud.currentId]);
  return (
    <Shell
      title="Revision History"
      width={620}
      onClose={close}
      footer={
        <>
          <span className="dialog__hint" style={{ marginRight: "auto" }}>
            {cloud.currentId ? `Document ${cloud.currentId}` : "Save a document to start a history."}
          </span>
          <Btn onClick={close}>Done</Btn>
        </>
      }
    >
      {!cloud.currentId ? (
        <div className="empty-state">This artwork has not been saved to the workspace yet.</div>
      ) : (
        <div className="doc-list">
          {(cloud.history || []).map((revision) => (
            <div key={revision.revision} className={`doc-card${revision.revision === cloud.revision ? " is-active" : ""}`}>
              <span className="doc-card__meta">
                <strong>Revision {revision.revision}</strong>
                <span>
                  {when(revision.createdAt)} · {bytes(revision.bytes)} · {revision.name}
                </span>
              </span>
              <span className="doc-card__actions">
                <Btn small onClick={() => restoreRevision(revision.revision)} disabled={revision.revision === cloud.revision}>
                  Restore
                </Btn>
              </span>
            </div>
          ))}
          {(cloud.history || []).length === 0 ? <div className="empty-state">No revisions recorded yet.</div> : null}
        </div>
      )}
    </Shell>
  );
}

/* --------------------------------------------------------------- conflict */

export function ConflictDialog() {
  const cloud = ui.cloud;
  if (cloud.status !== "conflict") return null;
  return (
    <Shell
      title="Save conflict"
      width={480}
      onClose={() => setCloud({ status: "ready", message: null })}
      footer={
        <>
          <Btn onClick={() => setCloud({ status: "ready", message: null })}>Later</Btn>
          <Btn onClick={resolveConflictTakeServer}>Use server version</Btn>
          <Btn variant="primary" onClick={resolveConflictKeepMine}>Overwrite with mine</Btn>
        </>
      }
    >
      <p className="dialog__hint" style={{ margin: 0 }}>
        {cloud.message ||
          "Another session saved a newer revision. Choose which copy should win; nothing is discarded until you decide."}
      </p>
    </Shell>
  );
}

/* -------------------------------------------------------------- autosave HUD */

export function CloudStatusHud() {
  const cloud = ui.cloud;
  const label =
    cloud.status === "saving" ? "Saving…" :
    cloud.status === "conflict" ? "Save conflict" :
    cloud.status === "offline" ? "Offline — stored locally" :
    cloud.currentId?.startsWith("doc_")
      ? (cloud.lastSavedAt ? `Saved ${when(new Date(cloud.lastSavedAt).toISOString())}` : "")
      : cloud.localDraftId
        ? `Draft r${cloud.localRevision ?? 1} in this browser`
        : app.dirty ? "Draft kept locally" : "";
  if (!label) return null;
  return (
    <button
      type="button"
      className={`cloud-hud is-${cloud.status}`}
      onClick={() => {
        if (cloud.status === "conflict") setUI({ historyOpen: false });
        else if (!cloud.currentId?.startsWith("doc_")) saveCurrent();
        else setUI({ browseOpen: true });
      }}
      title="Workspace status"
    >
      <Icon name={cloud.status === "offline" ? "noColor" : cloud.status === "conflict" ? "info" : "check"} size={11} />
      {label}
    </button>
  );
}

export function useCloudToasts() {
  useEffect(() => {
    if (ui.cloud.status === "conflict") pushToast("Save conflict — open the Workspace panel to resolve");
  }, [ui.cloud.status]);
}
