import { api } from "../api.js";
import { askConfirm, askText } from "../dialog.js";
import {
  clear,
  el,
  formatBytes,
  formatDate,
  joinPath,
  parentPath,
  replaceChildren,
} from "../dom.js";

/**
 * Files — the file manager.
 *
 * Everything here is a real platform operation: listing a directory, creating a
 * folder, renaming, and trashing an entry all go through /api/files. Deletion
 * moves items to the trash, so the destructive action is recoverable.
 */

const PLACES = [
  { label: "Home", path: "/", glyph: "⌂" },
  { label: "Desktop", path: "/Desktop", glyph: "▢" },
  { label: "Documents", path: "/Documents", glyph: "≡" },
  { label: "Downloads", path: "/Downloads", glyph: "↓" },
  { label: "Pictures", path: "/Pictures", glyph: "◍" },
];

const TRASH = { label: "Trash", path: "/.Trash", glyph: "⌫" };

export const renderFiles = (body, ctx, payload = {}) => {
  const state = {
    path: payload.path ?? "/",
    entries: [],
    selected: null,
    truncated: false,
    history: [],
    forward: [],
    inTrash: false,
  };

  const toolbar = el("div", { class: "app-toolbar" });
  const sidebar = el("aside", { class: "files-sidebar" });
  const breadcrumbs = el("div", { class: "breadcrumbs" });
  const list = el("div", { class: "files-list", role: "list" });
  const status = el("div", { class: "files-status" });
  const searchInput = el("input", {
    class: "text-input",
    type: "search",
    placeholder: "Search files",
    style: "max-width: 210px",
    "aria-label": "Search files",
  });

  const backButton = el("button", {
    class: "toolbar-button",
    text: "‹",
    title: "Back",
    "aria-label": "Back",
  });
  const forwardButton = el("button", {
    class: "toolbar-button",
    text: "›",
    title: "Forward",
    "aria-label": "Forward",
  });
  const upButton = el("button", {
    class: "toolbar-button",
    text: "↑",
    title: "Enclosing folder",
    "aria-label": "Enclosing folder",
  });
  const newFolderButton = el("button", {
    class: "toolbar-button",
    text: "＋ Folder",
    title: "New folder",
  });
  const refreshButton = el("button", {
    class: "toolbar-button",
    text: "↻",
    title: "Refresh",
    "aria-label": "Refresh",
  });
  const emptyTrashButton = el("button", {
    class: "toolbar-button",
    text: "Empty trash",
  });

  toolbar.append(
    backButton,
    forwardButton,
    upButton,
    el("span", { class: "spacer" }),
    searchInput,
    newFolderButton,
    refreshButton,
  );

  const main = el("div", { class: "files-main" }, [
    el("div", { class: "files-pathbar" }, [breadcrumbs]),
    list,
    status,
  ]);

  body.append(
    el("div", { class: "app" }, [
      toolbar,
      el("div", { class: "files-layout" }, [sidebar, main]),
    ]),
  );

  const glyphFor = (entry) => {
    if (entry.kind === "directory") return "▸";
    if (/\.(md|txt|json|js|ts|css|html)$/iu.test(entry.name)) return "≡";
    return "•";
  };

  const renderSidebar = () => {
    clear(sidebar);
    sidebar.append(el("div", { class: "sidebar-heading", text: "Places" }));
    for (const place of PLACES) {
      sidebar.append(
        el(
          "button",
          {
            class: "sidebar-item",
            "aria-current": String(!state.inTrash && state.path === place.path),
            on: { click: () => void navigate(place.path) },
          },
          [
            el("span", { class: "sidebar-glyph", text: place.glyph }),
            el("span", { text: place.label }),
          ],
        ),
      );
    }
    sidebar.append(el("div", { class: "sidebar-heading", text: "System" }));
    sidebar.append(
      el(
        "button",
        {
          class: "sidebar-item",
          "aria-current": String(state.inTrash),
          on: { click: () => void openTrash() },
        },
        [
          el("span", { class: "sidebar-glyph", text: TRASH.glyph }),
          el("span", { text: TRASH.label }),
        ],
      ),
    );
  };

  const renderBreadcrumbs = () => {
    clear(breadcrumbs);
    const segments = state.path.split("/").filter(Boolean);
    const rootButton = el("button", {
      class: "breadcrumb",
      text: "Home",
      dataset: { current: String(segments.length === 0) },
      on: { click: () => void navigate("/") },
    });
    breadcrumbs.append(rootButton);
    let accumulated = "";
    for (const segment of segments) {
      accumulated += `/${segment}`;
      const target = accumulated;
      breadcrumbs.append(
        el("span", { class: "crumb-sep", text: "›" }),
        el("button", {
          class: "breadcrumb",
          text: segment,
          dataset: { current: String(target === state.path) },
          on: { click: () => void navigate(target) },
        }),
      );
    }
  };

  const renderList = () => {
    clear(list);
    if (state.entries.length === 0) {
      list.append(
        el("div", { class: "empty-state" }, [
          el("p", {
            text: state.inTrash ? "Trash is empty." : "This folder is empty.",
          }),
          state.inTrash
            ? null
            : el("button", {
                class: "toolbar-button",
                text: "Create a folder",
                on: { click: () => void createFolder() },
              }),
        ]),
      );
      return;
    }
    for (const entry of state.entries) {
      const row = el(
        "div",
        {
          class: "file-row",
          role: "listitem",
          tabindex: "0",
          "aria-selected": String(state.selected === entry.path),
          on: {
            click: () => {
              state.selected = entry.path;
              renderList();
            },
            dblclick: () => void openEntry(entry),
            keydown: (event) => {
              if (event.key === "Enter") void openEntry(entry);
              if (event.key === "Delete") void trashEntry(entry);
            },
          },
        },
        [
          el("span", { class: "file-glyph", text: glyphFor(entry) }),
          el("span", { class: "file-name", text: entry.name }),
          el("span", {
            class: "file-size",
            text: entry.kind === "directory" ? "—" : formatBytes(entry.size),
          }),
          el("span", {
            class: "file-modified",
            text: formatDate(entry.modifiedAt),
          }),
          el("span", { class: "file-row-actions" }, [
            el("button", {
              class: "row-action",
              title: "Rename",
              text: "✎",
              on: {
                click: (event) => {
                  event.stopPropagation();
                  void renameEntry(entry);
                },
              },
            }),
            el("button", {
              class: "row-action",
              title: state.inTrash ? "Trash item" : "Move to trash",
              text: state.inTrash ? "" : "⌫",
              on: {
                click: (event) => {
                  event.stopPropagation();
                  void trashEntry(entry);
                },
              },
            }),
          ]),
        ],
      );
      if (state.inTrash)
        row.querySelector(".file-row-actions")?.replaceChildren();
      list.append(row);
    }
  };

  const renderStatus = () => {
    clear(status);
    const folders = state.entries.filter(
      (entry) => entry.kind === "directory",
    ).length;
    const files = state.entries.length - folders;
    status.append(
      el("span", {
        text: `${folders} folder${folders === 1 ? "" : "s"} · ${files} file${files === 1 ? "" : "s"}`,
      }),
      state.truncated
        ? el("span", {
            class: "badge",
            dataset: { tone: "warning" },
            text: "listing truncated",
          })
        : null,
      el("span", { class: "spacer" }),
      el("span", {
        text: state.inTrash
          ? "Items can be restored by moving them back"
          : "Deleting moves items to the trash",
      }),
    );
  };

  const load = async () => {
    const response = state.inTrash
      ? await api.trashList()
      : await api.list(state.path);
    if (!response.ok) {
      state.entries = [];
      state.truncated = false;
      renderList();
      renderStatus();
      list.append(
        el("div", { class: "empty-state" }, [
          el("p", { text: response.error.message }),
          el("button", {
            class: "toolbar-button",
            text: "Go home",
            on: { click: () => void navigate("/") },
          }),
        ]),
      );
      ctx.win.setTitle("Files", state.path);
      return;
    }
    state.entries = response.data.entries;
    state.truncated = response.data.truncated;
    state.selected = null;
    renderSidebar();
    renderBreadcrumbs();
    renderList();
    renderStatus();
    backButton.disabled = state.history.length === 0;
    forwardButton.disabled = state.forward.length === 0;
    upButton.disabled = state.inTrash || state.path === "/";
    newFolderButton.hidden = state.inTrash;
    emptyTrashButton.hidden = !state.inTrash;
    ctx.win.setTitle("Files", state.inTrash ? "Trash" : state.path);
  };

  const navigate = async (path) => {
    if (!state.inTrash && path !== state.path) state.history.push(state.path);
    state.forward = [];
    state.inTrash = false;
    state.path = path;
    await load();
  };

  const openTrash = async () => {
    state.inTrash = true;
    await load();
  };

  const openEntry = async (entry) => {
    if (entry.kind === "directory") {
      await navigate(entry.path);
      return;
    }
    ctx.openFile(entry.path);
  };

  const createFolder = async () => {
    const name = await askText({
      title: "New folder",
      label: "Folder name",
      value: "Untitled folder",
      confirmLabel: "Create",
    });
    if (name === null) return;
    const response = await api.mkdir(joinPath(state.path, name));
    if (!response.ok) {
      ctx.notify("Could not create folder", response.error.message, "error");
      return;
    }
    ctx.notify(
      "Folder created",
      `${name} was created in ${state.path}.`,
      "success",
    );
    await load();
  };

  const renameEntry = async (entry) => {
    const name = await askText({
      title: "Rename",
      label: "New name",
      value: entry.name,
      confirmLabel: "Rename",
    });
    if (name === null || name === entry.name) return;
    const response = await api.rename(
      entry.path,
      joinPath(parentPath(entry.path), name),
    );
    if (!response.ok) {
      ctx.notify("Could not rename", response.error.message, "error");
      return;
    }
    await load();
  };

  const trashEntry = async (entry) => {
    const confirmed = await askConfirm({
      title: state.inTrash ? "Delete permanently" : "Move to trash?",
      message: state.inTrash
        ? `"${entry.name}" will be deleted permanently.`
        : `"${entry.name}" will be moved to the trash and can be restored later.`,
      confirmLabel: state.inTrash ? "Delete" : "Move to trash",
      destructive: true,
    });
    if (!confirmed) return;
    const response = state.inTrash
      ? await api.purge(entry.path)
      : await api.trash(entry.path);
    if (!response.ok) {
      ctx.notify("Could not delete", response.error.message, "error");
      return;
    }
    ctx.notify(
      state.inTrash ? "Deleted" : "Moved to trash",
      entry.name,
      "success",
    );
    await load();
  };

  backButton.addEventListener("click", () => {
    const previous = state.history.pop();
    if (previous === undefined) return;
    state.forward.push(state.path);
    state.path = previous;
    state.inTrash = false;
    void load();
  });

  forwardButton.addEventListener("click", () => {
    const next = state.forward.pop();
    if (next === undefined) return;
    state.history.push(state.path);
    state.path = next;
    state.inTrash = false;
    void load();
  });

  upButton.addEventListener(
    "click",
    () => void navigate(parentPath(state.path)),
  );
  newFolderButton.addEventListener("click", () => void createFolder());
  refreshButton.addEventListener("click", () => void load());
  emptyTrashButton.addEventListener("click", async () => {
    const confirmed = await askConfirm({
      title: "Empty trash?",
      message: "Everything in the trash will be deleted permanently.",
      confirmLabel: "Empty trash",
      destructive: true,
    });
    if (!confirmed) return;
    const response = await api.emptyTrash();
    if (!response.ok) {
      ctx.notify("Could not empty trash", response.error.message, "error");
      return;
    }
    ctx.notify(
      "Trash emptied",
      `${response.data.removed} item(s) deleted.`,
      "success",
    );
    await load();
  });

  searchInput.addEventListener("input", async () => {
    const query = searchInput.value.trim();
    if (query.length === 0) {
      await load();
      return;
    }
    const response = await api.search(query);
    if (!response.ok) return;
    state.entries = response.data.map((hit) => ({
      path: hit.path,
      name: hit.name,
      kind: hit.kind,
      size: hit.size,
      modifiedAt: hit.modifiedAt,
    }));
    state.truncated = false;
    state.inTrash = false;
    clear(list);
    renderList();
    replaceChildren(
      status,
      el("span", { text: `${state.entries.length} match(es) for "${query}"` }),
    );
  });

  emptyTrashButton.hidden = true;

  // Cross-window updates: another app (or the terminal) may change the folder.
  const unsubscribe = ctx.onFilesChanged?.(() => {
    if (!state.inTrash) void load();
  });

  ctx.win.onClose = () => unsubscribe?.();
  void load();
};
