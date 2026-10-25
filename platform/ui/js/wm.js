import { el } from "./dom.js";

/**
 * ReaOS window manager.
 *
 * Owns window lifetime, stacking order, dragging, resizing, minimizing and
 * zooming. Applications only receive a body element to render into, so window
 * behaviour stays consistent across every app.
 */

let nextId = 1;

export const createWindowManager = ({ container, onChange = () => {} }) => {
  const windows = new Map();
  let zCounter = 10;
  let focusedId = null;
  let cascade = 0;

  const bounds = () => {
    const rect = container.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  };

  const notify = () => onChange(windowsAPI());

  const focus = (id) => {
    const win = windows.get(id);
    if (win === undefined) return;
    if (win.minimized) win.minimized = false;
    focusedId = id;
    zCounter += 1;
    win.node.style.zIndex = String(zCounter);
    win.node.style.display = "";
    win.node.dataset.minimized = "false";
    for (const other of windows.values()) {
      other.node.dataset.focused = String(other.id === id);
    }
    notify();
  };

  const minimize = (id) => {
    const win = windows.get(id);
    if (win === undefined) return;
    win.minimized = true;
    win.node.dataset.minimized = "true";
    if (focusedId === id) focusedId = null;
    notify();
  };

  const toggleMaximize = (id) => {
    const win = windows.get(id);
    if (win === undefined) return;
    win.maximized = !win.maximized;
    win.node.dataset.maximized = String(win.maximized);
    if (win.maximized) {
      win.remembered = {
        left: win.node.style.left,
        top: win.node.style.top,
        width: win.node.style.width,
        height: win.node.style.height,
      };
    } else if (win.remembered !== undefined) {
      Object.assign(win.node.style, win.remembered);
    }
    focus(id);
  };

  const close = (id) => {
    const win = windows.get(id);
    if (win === undefined) return;
    try {
      win.onClose?.();
    } finally {
      win.node.remove();
      windows.delete(id);
      if (focusedId === id) {
        focusedId = null;
        const remaining = [...windows.values()].filter(
          (entry) => !entry.minimized,
        );
        const top = remaining.at(-1);
        if (top !== undefined) focus(top.id);
      }
      notify();
    }
  };

  const startDrag = (event, win) => {
    if (event.button !== 0) return;
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      target.closest("button, input, textarea, select, a")
    )
      return;
    const node = win.node;
    const startX = event.clientX;
    const startY = event.clientY;
    const startLeft = node.offsetLeft;
    const startTop = node.offsetTop;
    const limit = bounds();
    node.setPointerCapture?.(event.pointerId);

    const move = (moveEvent) => {
      const width = node.offsetWidth;
      const nextLeft = Math.min(
        Math.max(startLeft + (moveEvent.clientX - startX), -width + 120),
        limit.width - 120,
      );
      const nextTop = Math.min(
        Math.max(startTop + (moveEvent.clientY - startY), 0),
        limit.height - 48,
      );
      node.style.left = `${nextLeft}px`;
      node.style.top = `${nextTop}px`;
    };
    const finish = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      document.body.style.userSelect = "";
    };
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish, { once: true });
    focus(win.id);
  };

  const startResize = (event, win) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    const node = win.node;
    const startX = event.clientX;
    const startY = event.clientY;
    const startWidth = node.offsetWidth;
    const startHeight = node.offsetHeight;
    const minimum = { width: 380, height: 260 };
    const limit = bounds();

    const move = (moveEvent) => {
      const width = Math.max(
        minimum.width,
        Math.min(
          startWidth + (moveEvent.clientX - startX),
          limit.width - node.offsetLeft,
        ),
      );
      const height = Math.max(
        minimum.height,
        Math.min(
          startHeight + (moveEvent.clientY - startY),
          limit.height - node.offsetTop - 8,
        ),
      );
      node.style.width = `${width}px`;
      node.style.height = `${height}px`;
    };
    const finish = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      document.body.style.userSelect = "";
    };
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish, { once: true });
  };

  const create = ({ app, title, subtitle, width, height, render, onClose }) => {
    const limit = bounds();
    const offset = (cascade % 6) * 26;
    cascade += 1;
    const size = {
      width: Math.min(
        width ?? app.defaultWindow.width,
        Math.max(380, limit.width - 40),
      ),
      height: Math.min(
        height ?? app.defaultWindow.height,
        Math.max(260, limit.height - 60),
      ),
    };
    const node = el("section", {
      class: "window",
      role: "dialog",
      "aria-label": `${app.name} window`,
      dataset: {
        app: app.id,
        focused: "true",
        minimized: "false",
        maximized: "false",
      },
    });
    node.style.width = `${size.width}px`;
    node.style.height = `${size.height}px`;
    node.style.left = `${76 + offset}px`;
    node.style.top = `${44 + offset}px`;

    const titleLabel = el("span", {
      class: "title-label",
      text: title ?? app.name,
    });
    const subtitleLabel = el("span", {
      class: "title-subtitle",
      text: subtitle ?? "",
    });
    const control = (action, glyph, label) =>
      el("button", {
        class: "window-control",
        dataset: { action },
        title: label,
        "aria-label": label,
        text: glyph,
        on: {
          click: (clickEvent) => {
            clickEvent.stopPropagation();
            if (action === "close") close(id);
            if (action === "minimize") minimize(id);
            if (action === "zoom") toggleMaximize(id);
          },
        },
      });

    const titlebar = el("header", { class: "titlebar" }, [
      el("span", {
        class: "app-badge",
        text: app.glyph,
        "aria-hidden": "true",
      }),
      el("div", { class: "titlebar-labels" }, [titleLabel, subtitleLabel]),
      el("div", { class: "titlebar-actions" }, [
        control("minimize", "–", "Minimize"),
        control("zoom", "⤢", "Zoom"),
        control("close", "×", "Close"),
      ]),
    ]);
    const body = el("div", { class: "window-body" });
    node.append(
      titlebar,
      body,
      el("div", { class: "resize-handle", title: "Resize" }),
    );

    const id = `win-${nextId}`;
    nextId += 1;

    node.addEventListener("pointerdown", () => focus(id));
    titlebar.addEventListener("pointerdown", (pointerEvent) =>
      startDrag(pointerEvent, win),
    );
    titlebar.addEventListener("dblclick", (doubleEvent) => {
      if (
        doubleEvent.target instanceof HTMLElement &&
        doubleEvent.target.closest("button")
      )
        return;
      toggleMaximize(id);
    });
    node
      .querySelector(".resize-handle")
      ?.addEventListener("pointerdown", (pointerEvent) =>
        startResize(pointerEvent, win),
      );

    const win = {
      id,
      app,
      node,
      body,
      minimized: false,
      maximized: false,
      remembered: undefined,
      onClose,
      setTitle: (value, detail) => {
        titleLabel.textContent = value;
        if (detail !== undefined) subtitleLabel.textContent = detail;
      },
      focus: () => focus(id),
      close: () => close(id),
      minimize: () => minimize(id),
      toggleMaximize: () => toggleMaximize(id),
    };

    windows.set(id, win);
    container.append(node);
    focus(id);
    render?.(body, win);
    return win;
  };

  const windowsAPI = () => ({
    list: [...windows.values()].map((win) => ({
      id: win.id,
      appId: win.app.id,
      appName: win.app.name,
      title:
        win.node.querySelector(".title-label")?.textContent ?? win.app.name,
      glyph: win.app.glyph,
      minimized: win.minimized,
      focused: win.id === focusedId,
    })),
    focusedId,
    focusedAppId: windows.get(focusedId)?.app.id ?? null,
  });

  return {
    open: create,
    close,
    focus,
    minimize,
    toggleMaximize,
    focusFirstOf: (appId) => {
      const candidates = [...windows.values()].filter(
        (win) => win.app.id === appId,
      );
      const target = candidates.at(-1);
      if (target === undefined) return false;
      focus(target.id);
      return true;
    },
    minimizeAllOf: (appId) => {
      for (const win of windows.values())
        if (win.app.id === appId) minimize(win.id);
    },
    state: windowsAPI,
  };
};
