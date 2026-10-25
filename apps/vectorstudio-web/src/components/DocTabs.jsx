/**
 * Document tab strip: the open artwork, its dirty/saved state and quick
 * document actions (new, document options, workspace sync status).
 */

import { app } from "../studio/app.js";
import { openMenu, setUI, ui } from "../ui/overlays.js";
import { Icon } from "./ui.jsx";

function cloudBadge(cloud) {
  if (cloud.status === "offline") return { text: "Local", tone: "is-local" };
  if (cloud.status === "saving") return { text: "Saving…", tone: "is-busy" };
  if (cloud.status === "conflict") return { text: "Conflict", tone: "is-conflict" };
  if (cloud.currentId?.startsWith("doc_")) return { text: `r${cloud.revision ?? 1}`, tone: "is-synced" };
  if (cloud.localDraftId) return { text: `draft r${cloud.localRevision ?? 1}`, tone: "is-local" };
  return { text: "New", tone: "" };
}

export function DocTabs() {
  const doc = app.doc;
  const cloud = ui.cloud;
  const badge = cloudBadge(cloud);
  return (
    <div className="tabbar" id="tabbar">
      {doc ? (
        <div
          className={`doc-tab is-active${app.dirty ? " is-dirty" : ""}`}
          role="tab"
          aria-selected="true"
          title={cloud.currentId ? `Workspace document ${cloud.currentId}` : "Draft kept in this browser — File ▸ Save to Workspace to publish"}
        >
          <span className="doc-tab__title">{doc.name}</span>
          {badge.text ? <span className={`doc-tab__cloud ${badge.tone}`}>{badge.text}</span> : null}
          <span className="doc-tab__dirty" />
          <button
            type="button"
            className="doc-tab__close"
            title="Close document"
            aria-label="Close document"
            onClick={(event) => {
              event.stopPropagation();
              app.commands.closeDocument();
            }}
          >
            <Icon name="close" size={9} />
          </button>
        </div>
      ) : null}
      <div className="tabbar__actions">
        <button
          type="button"
          className="tabbar__action"
          title="New document"
          aria-label="New document"
          onClick={() => app.commands.newDocument()}
        >
          <Icon name="plus" size={12} />
        </button>
        <button
          type="button"
          className="tabbar__action"
          title="Document options"
          aria-label="Document options"
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            openMenu(rect.right - 200, rect.bottom + 2, [
              { label: "Document Setup…", action: () => app.commands.documentSetup() },
              { label: "Duplicate Document", action: () => app.commands.duplicateDocument() },
              { separator: true },
              { label: "Workspace Browser…", action: () => setUI({ browseOpen: true }) },
              { label: "Revision History…", action: () => setUI({ historyOpen: true }) },
              { separator: true },
              { label: "Close Document", action: () => app.commands.closeDocument() },
            ]);
          }}
        >
          <Icon name="hamburger" size={12} />
        </button>
      </div>
    </div>
  );
}
