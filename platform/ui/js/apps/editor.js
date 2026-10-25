import { api } from "../api.js";
import { askText } from "../dialog.js";
import { el } from "../dom.js";

/**
 * TextEdit — a real text editor over the platform filesystem.
 *
 * Saving writes through the files service (atomic replace on the host), so the
 * dirty indicator reflects actual unsaved changes and Ctrl+S persists them.
 */

export const renderEditor = (body, ctx, payload = {}) => {
  const state = {
    path: payload.path ?? null,
    savedContent: "",
    dirty: false,
  };

  const toolbar = el("div", { class: "app-toolbar" });
  const textarea = el("textarea", {
    class: "editor-textarea",
    spellcheck: "false",
    "aria-label": "Document text",
  });
  const status = el("div", { class: "editor-status" });
  const saveButton = el("button", {
    class: "toolbar-button",
    dataset: { primary: "true" },
    text: "Save",
    title: "Save (Ctrl+S)",
  });
  const revertButton = el("button", {
    class: "toolbar-button",
    text: "Revert",
  });
  const newButton = el("button", { class: "toolbar-button", text: "New" });
  toolbar.append(
    saveButton,
    revertButton,
    newButton,
    el("span", { class: "spacer" }),
    el("span", { class: "quiet", text: "Plain text · UTF-8" }),
  );

  body.append(
    el("div", { class: "app" }, [
      toolbar,
      el("div", { class: "editor-body" }, [textarea, status]),
    ]),
  );

  const renderStatus = () => {
    const content = textarea.value;
    const lines = content.length === 0 ? 0 : content.split("\n").length;
    const words =
      content.trim().length === 0 ? 0 : content.trim().split(/\s+/u).length;
    status.replaceChildren(
      el("span", { text: state.path ?? "Untitled" }),
      el("span", {
        text: `${lines} line${lines === 1 ? "" : "s"} · ${words} word${words === 1 ? "" : "s"}`,
      }),
      el("span", { class: "spacer" }),
      el("span", {
        dataset: { state: state.dirty ? "dirty" : "saved" },
        text: state.dirty
          ? "Unsaved changes"
          : state.path === null
            ? "Not saved yet"
            : "Saved",
      }),
    );
  };

  const setTitle = () => {
    ctx.win.setTitle(
      state.path === null ? "Untitled" : ctx.basename(state.path),
      state.dirty ? "Edited" : (state.path ?? "New document"),
    );
  };

  const load = async (path) => {
    if (path === null) {
      state.path = null;
      state.savedContent = "";
      textarea.value = "";
      state.dirty = false;
      setTitle();
      renderStatus();
      return;
    }
    const response = await api.readFile(path);
    if (!response.ok) {
      ctx.notify("Could not open file", response.error.message, "error");
      return;
    }
    state.path = path;
    state.savedContent = response.data.content;
    textarea.value = response.data.content;
    state.dirty = false;
    setTitle();
    renderStatus();
    textarea.focus();
  };

  const save = async () => {
    let target = state.path;
    if (target === null) {
      const name = await askText({
        title: "Save document",
        label: "File name",
        value: "Untitled.txt",
        confirmLabel: "Save to Documents",
      });
      if (name === null) return;
      target = `/Documents/${name}`;
    }
    const response = await api.writeFile(target, textarea.value);
    if (!response.ok) {
      ctx.notify("Could not save", response.error.message, "error");
      return;
    }
    state.path = target;
    state.savedContent = textarea.value;
    state.dirty = false;
    setTitle();
    renderStatus();
    ctx.notify("Saved", target, "success");
  };

  textarea.addEventListener("input", () => {
    state.dirty = textarea.value !== state.savedContent;
    setTitle();
    renderStatus();
  });

  textarea.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      void save();
    }
    if (event.key === "Tab") {
      event.preventDefault();
      const { selectionStart, selectionEnd, value } = textarea;
      textarea.value = `${value.slice(0, selectionStart)}  ${value.slice(selectionEnd)}`;
      textarea.selectionStart = textarea.selectionEnd = selectionStart + 2;
      state.dirty = textarea.value !== state.savedContent;
      renderStatus();
    }
  });

  saveButton.addEventListener("click", () => void save());
  revertButton.addEventListener("click", () => {
    textarea.value = state.savedContent;
    state.dirty = false;
    renderStatus();
    setTitle();
  });
  newButton.addEventListener("click", () => {
    if (state.dirty) {
      ctx.notify(
        "Unsaved changes",
        "Save or revert before starting a new document.",
        "warning",
      );
      return;
    }
    void load(null);
  });

  setTitle();
  renderStatus();
  void load(state.path);
};
