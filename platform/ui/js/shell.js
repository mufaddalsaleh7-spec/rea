import { api, connectEvents } from "./api.js";
import { createLauncher } from "./launcher.js";
import { createNotificationUI } from "./notifications.js";
import { createWindowManager } from "./wm.js";
import { baseName, clear, el, formatClock, replaceChildren } from "./dom.js";
import { renderFiles } from "./apps/files.js";
import { renderEditor } from "./apps/editor.js";
import { renderSettings } from "./apps/settings.js";
import { renderMonitor } from "./apps/monitor.js";
import { renderTerminal } from "./apps/terminal.js";
import { renderConsole } from "./apps/console.js";

/**
 * Desktop shell bootstrap.
 *
 * The shell is the owner of session state that several surfaces share (theme,
 * capabilities, notifications, open windows). Applications receive a small
 * context object rather than importing shell internals, which keeps them
 * independent and testable by inspection.
 */

const RENDERERS = {
  files: renderFiles,
  editor: renderEditor,
  settings: renderSettings,
  monitor: renderMonitor,
  terminal: renderTerminal,
  console: renderConsole,
};

const APP_SHORTCUTS = [
  { keys: "Ctrl+Space", action: "Launcher" },
  { keys: "Ctrl+W", action: "Close focused window" },
  { keys: "Ctrl+M", action: "Minimize focused window" },
  { keys: "Ctrl+S", action: "Save in the editor" },
  { keys: "Ctrl+1…6", action: "Open an application" },
  { keys: "Esc", action: "Close launcher / menus" },
];

export const startShell = async () => {
  const dom = {
    desktop: document.getElementById("desktop"),
    menubar: document.getElementById("menubar"),
    appMenu: document.getElementById("app-menu"),
    windows: document.getElementById("windows"),
    dock: document.getElementById("dock"),
    launcher: document.getElementById("launcher"),
    launcherInput: document.getElementById("launcher-input"),
    launcherResults: document.getElementById("launcher-results"),
    toasts: document.getElementById("toasts"),
    panel: document.getElementById("panel"),
    bell: document.getElementById("status-notifications"),
    bellCount: document.getElementById("notification-count"),
    clock: document.getElementById("status-clock"),
    cpuChip: document.getElementById("status-cpu"),
    terminalChip: document.getElementById("status-terminal"),
    systemMenuButton: document.getElementById("system-menu-button"),
    contextMenu: document.getElementById("context-menu"),
    desktopIcons: document.getElementById("desktop-icons"),
    boot: document.getElementById("boot-overlay"),
    bootMessage: document.getElementById("boot-message"),
  };

  const state = {
    settings: null,
    capabilities: [],
    apps: [],
    facts: null,
    platformRoot: "",
    version: "",
  };

  const subscribers = {
    settings: new Set(),
    capabilities: new Set(),
    files: new Set(),
  };
  const subscribe = (set, listener) => {
    set.add(listener);
    return () => set.delete(listener);
  };

  /* ------------------------------ appearance ------------------------------ */

  const resolvedTheme = () => {
    if (state.settings?.theme === "auto") {
      return window.matchMedia("(prefers-color-scheme: light)").matches
        ? "light"
        : "dark";
    }
    return state.settings?.theme ?? "dark";
  };

  const applyAppearance = () => {
    const root = document.documentElement;
    root.dataset.theme = resolvedTheme();
    root.dataset.accent = state.settings?.accent ?? "aurora";
    root.dataset.wallpaper = state.settings?.wallpaper ?? "dawn";
    root.dataset.reducedMotion = String(state.settings?.reduceMotion ?? false);
    root.style.setProperty(
      "--dock-size",
      `${state.settings?.dockSize ?? 56}px`,
    );
    renderDock();
    renderClock();
    renderStatusChips();
  };

  const applySettings = (next) => {
    state.settings = { ...next };
    applyAppearance();
    for (const listener of subscribers.settings) listener(state.settings);
    if (
      !next.terminalEnabled &&
      !state.capabilities.includes("process:spawn")
    ) {
      renderStatusChips();
    }
  };

  const refreshCapabilities = async () => {
    const response = await api.capabilities();
    if (!response.ok) return;
    state.capabilities = response.data.granted;
    for (const listener of subscribers.capabilities)
      listener(state.capabilities);
    renderStatusChips();
  };

  /* -------------------------------- windows ------------------------------- */

  const wm = createWindowManager({
    container: dom.windows,
    onChange: () => {
      renderDock();
      renderAppMenus();
    },
  });

  const openApp = (appId, payload = {}) => {
    const manifest = state.apps.find((app) => app.id === appId);
    if (manifest === undefined) return;
    const render = RENDERERS[manifest.module];
    if (render === undefined) {
      void api.publishNotification(
        "Application unavailable",
        `${manifest.name} has no shell renderer in this build.`,
        "warning",
      );
      return;
    }
    const win = wm.open({
      app: manifest,
      width: manifest.defaultWindow.width,
      height: manifest.defaultWindow.height,
      render: (body, windowHandle) => {
        render(body, buildContext(windowHandle, manifest), payload);
      },
    });
    win.focus();
  };

  const openFile = (path) => {
    const existing = wm
      .state()
      .list.find(
        (entry) => entry.appId === "editor" && entry.title === baseName(path),
      );
    if (existing !== undefined) {
      wm.focus(existing.id);
      return;
    }
    const manifest = state.apps.find((app) => app.id === "editor");
    const render = RENDERERS["editor"];
    if (manifest === undefined || render === undefined) return;
    wm.open({
      app: manifest,
      width: manifest.defaultWindow.width,
      height: manifest.defaultWindow.height,
      render: (body, windowHandle) => {
        render(body, buildContext(windowHandle, manifest), { path });
      },
    });
  };

  const buildContext = (win, app) => ({
    win,
    app,
    openApp,
    openFile,
    basename: (path) => baseName(path),
    notify: async (title, message, level = "info") => {
      await api.publishNotification(title, message, level);
    },
    settings: () => ({ ...state.settings }),
    applySettings,
    previewDockSize: (size) => {
      document.documentElement.style.setProperty("--dock-size", `${size}px`);
    },
    capabilities: () => [...state.capabilities],
    systemFacts: () => state.facts,
    platformRoot: () => state.platformRoot,
    onSettingsChanged: (listener) => subscribe(subscribers.settings, listener),
    onCapabilitiesChanged: (listener) =>
      subscribe(subscribers.capabilities, listener),
    onFilesChanged: (listener) => subscribe(subscribers.files, listener),
  });

  /* --------------------------------- dock --------------------------------- */

  const renderDock = () => {
    if (state.apps.length === 0) return;
    const running = new Set(wm.state().list.map((entry) => entry.appId));
    clear(dom.dock);
    state.apps.forEach((app) => {
      const button = el(
        "button",
        {
          class: "dock-item",
          dataset: { running: String(running.has(app.id)), app: app.id },
          "aria-label": app.name,
          title: "",
          on: {
            click: (event) => {
              if (event.altKey) {
                openApp(app.id);
                return;
              }
              const isRunning = wm
                .state()
                .list.some((entry) => entry.appId === app.id);
              if (!isRunning) openApp(app.id);
              else if (!wm.focusFirstOf(app.id)) openApp(app.id);
            },
            contextmenu: (event) => {
              event.preventDefault();
              openMenu({ x: event.clientX, y: event.clientY }, [
                { label: `Open ${app.name}`, action: () => openApp(app.id) },
                {
                  label: "New window",
                  action: () => openApp(app.id),
                  disabled: !wm
                    .state()
                    .list.some((entry) => entry.appId === app.id),
                },
                { separator: true },
                {
                  label: "Close all windows",
                  action: () => wm.minimizeAllOf(app.id),
                },
              ]);
            },
          },
        },
        [
          el("span", { class: "dock-icon", text: app.glyph }),
          el("span", { class: "dock-tooltip", text: app.name }),
        ],
      );
      dom.dock.append(button);
    });
    dom.dock.append(
      el("span", { class: "dock-divider" }),
      el(
        "button",
        {
          class: "dock-item",
          "aria-label": "Settings",
          on: { click: () => openApp("settings") },
        },
        [
          el("span", { class: "dock-icon", text: "⚙" }),
          el("span", { class: "dock-tooltip", text: "Settings" }),
        ],
      ),
    );
  };

  /* ------------------------------- menu bar ------------------------------- */

  const renderClock = () => {
    dom.clock.textContent = formatClock(
      new Date(),
      state.settings?.showSeconds ?? false,
    );
  };

  const renderStatusChips = () => {
    const terminalOn = state.capabilities.includes("process:spawn");
    dom.terminalChip.textContent = terminalOn ? "shell on" : "shell off";
    dom.terminalChip.dataset.state = terminalOn ? "on" : "off";
    dom.terminalChip.title = terminalOn
      ? "Command execution is enabled — open Terminal"
      : "Command execution is disabled — open Terminal to enable";
  };

  const renderAppMenus = () => {
    clear(dom.appMenu);
    const focusedAppId = wm.state().focusedAppId;
    const app = state.apps.find((entry) => entry.id === focusedAppId);
    if (app === undefined) return;
    dom.appMenu.append(
      el("span", { class: "menubar-app", text: app.name }),
      el("button", {
        class: "menubar-menu-button",
        text: "Window",
        "aria-haspopup": "true",
        on: {
          click: (event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            openMenu({ x: rect.left, y: rect.bottom + 4 }, [
              {
                label: "Minimize",
                shortcut: "Ctrl+M",
                action: () =>
                  wm.state().focusedId && wm.minimize(wm.state().focusedId),
              },
              {
                label: "Zoom",
                action: () =>
                  wm.state().focusedId &&
                  wm.toggleMaximize(wm.state().focusedId),
              },
              { separator: true },
              {
                label: "Close window",
                shortcut: "Ctrl+W",
                action: () =>
                  wm.state().focusedId && wm.close(wm.state().focusedId),
              },
            ]);
          },
        },
      }),
      el("button", {
        class: "menubar-menu-button",
        text: "Shortcuts",
        on: {
          click: (event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            openMenu(
              { x: rect.left, y: rect.bottom + 4 },
              APP_SHORTCUTS.map((entry) => ({
                label: entry.action,
                shortcut: entry.keys,
                action: () => {},
              })),
            );
          },
        },
      }),
    );
  };

  const renderSystemMenu = (anchor) => {
    openMenu(anchor, [
      {
        label: "About ReaOS",
        action: () => openApp("settings", { section: "about" }),
      },
      { label: "Settings…", action: () => openApp("settings") },
      { separator: true },
      { label: "Activity monitor", action: () => openApp("monitor") },
      { label: "Console (system log)", action: () => openApp("console") },
      { label: "Terminal", action: () => openApp("terminal") },
      { separator: true },
      {
        label: "Launcher",
        shortcut: "Ctrl+Space",
        action: () => launcher.open(),
      },
      { label: "Reload shell", action: () => window.location.reload() },
    ]);
  };

  /* ------------------------------- utilities ------------------------------ */

  let closeMenu = () => {};

  const openMenu = (point, items) => {
    closeMenu();
    const menu = dom.contextMenu;
    clear(menu);
    for (const item of items) {
      if (item.separator) {
        menu.append(el("div", { class: "panel-separator" }));
        continue;
      }
      menu.append(
        el(
          "button",
          {
            class: "context-item",
            disabled: item.disabled,
            on: {
              click: () => {
                closeMenu();
                item.action();
              },
            },
          },
          [
            el("span", { text: item.label }),
            item.shortcut === undefined
              ? null
              : el("kbd", { text: item.shortcut }),
          ],
        ),
      );
    }
    menu.hidden = false;
    const rect = menu.getBoundingClientRect();
    const left = Math.min(point.x, window.innerWidth - rect.width - 8);
    const top = Math.min(point.y, window.innerHeight - rect.height - 8);
    menu.style.left = `${Math.max(8, left)}px`;
    menu.style.top = `${Math.max(8, top)}px`;
    const onPointerDown = (event) => {
      if (!menu.contains(event.target)) closeMenu();
    };
    const onKey = (event) => {
      if (event.key === "Escape") closeMenu();
    };
    setTimeout(
      () => document.addEventListener("pointerdown", onPointerDown),
      0,
    );
    document.addEventListener("keydown", onKey);
    closeMenu = () => {
      menu.hidden = true;
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
      closeMenu = () => {};
    };
  };

  /* -------------------------------- desktop ------------------------------- */

  const renderDesktopIcons = () => {
    clear(dom.desktopIcons);
    const items = [
      {
        label: "Documents",
        glyph: "▸",
        action: () => openApp("files", { path: "/Documents" }),
      },
      {
        label: "Welcome.md",
        glyph: "≡",
        action: () => openFile("/Documents/Welcome.md"),
      },
    ];
    for (const item of items) {
      dom.desktopIcons.append(
        el(
          "button",
          {
            class: "desktop-icon",
            on: { dblclick: item.action, click: item.action },
          },
          [
            el("span", {
              class: "dock-icon",
              style: "width:42px;height:42px;font-size:14px;border-radius:12px",
              text: item.glyph,
            }),
            el("span", { text: item.label }),
          ],
        ),
      );
    }
  };

  dom.desktop.addEventListener("contextmenu", (event) => {
    if (event.target.closest(".window, .dock, .menubar, .panel, .toasts"))
      return;
    event.preventDefault();
    openMenu({ x: event.clientX, y: event.clientY }, [
      {
        label: "New folder on Desktop",
        action: () => openApp("files", { path: "/Desktop" }),
      },
      {
        label: "Open Documents",
        action: () => openApp("files", { path: "/Documents" }),
      },
      { separator: true },
      {
        label: "Change wallpaper…",
        action: () => openApp("settings", { section: "appearance" }),
      },
      { label: "Activity monitor", action: () => openApp("monitor") },
      { separator: true },
      {
        label: "Keyboard shortcuts",
        shortcut: "Ctrl+Space",
        action: () => launcher.open(),
      },
    ]);
  });

  /* -------------------------------- launcher ------------------------------ */

  const launcher = createLauncher({
    root: dom.launcher,
    input: dom.launcherInput,
    results: dom.launcherResults,
    onOpenApp: (appId) => openApp(appId),
    onOpenFile: (path) => openFile(path),
  });

  /* ----------------------------- notifications ---------------------------- */

  const notifications = createNotificationUI({
    toasts: dom.toasts,
    panel: dom.panel,
    bellButton: dom.bell,
    countBadge: dom.bellCount,
    onOpenApp: openApp,
  });

  dom.bell.addEventListener("click", () => notifications.togglePanel());
  dom.cpuChip.addEventListener("click", () => openApp("monitor"));
  dom.terminalChip.addEventListener("click", () => openApp("terminal"));
  dom.systemMenuButton.addEventListener("click", (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    renderSystemMenu({ x: rect.left, y: rect.bottom + 4 });
  });

  dom.clock.addEventListener("click", () => {
    void api.publishNotification(
      "ReaOS clock",
      `${new Date().toLocaleString()} — the clock reads the host's system time.`,
      "info",
    );
  });

  /* ------------------------------ global keys ----------------------------- */

  window.addEventListener("keydown", (event) => {
    const modifier = event.ctrlKey || event.metaKey;
    if (modifier && event.code === "Space") {
      event.preventDefault();
      launcher.toggle();
      return;
    }
    if (event.key === "Escape") {
      if (launcher.isOpen()) launcher.close();
      else if (notifications.isPanelOpen()) notifications.closePanel();
      closeMenu();
      return;
    }
    if (!modifier) return;
    if (event.key === "w" || event.key === "W") {
      const focused = wm.state().focusedId;
      if (focused !== null) {
        event.preventDefault();
        wm.close(focused);
      }
    } else if (event.key === "m" || event.key === "M") {
      const focused = wm.state().focusedId;
      if (focused !== null) {
        event.preventDefault();
        wm.minimize(focused);
      }
    } else if (/^[1-6]$/u.test(event.key)) {
      const app = state.apps[Number(event.key) - 1];
      if (app !== undefined) {
        event.preventDefault();
        openApp(app.id);
      }
    }
  });

  /* ------------------------------- event bus ------------------------------ */

  const startStream = () => {
    connectEvents({
      "settings.changed": (event) => {
        const next = event?.payload?.next;
        if (next !== undefined) applySettings(next);
        void refreshCapabilities();
      },
      "session.permissionsChanged": (event) => {
        const granted = event?.payload?.granted;
        if (Array.isArray(granted)) {
          state.capabilities = granted;
          for (const listener of subscribers.capabilities)
            listener(state.capabilities);
          renderStatusChips();
        }
      },
      "notifications.published": (event) => {
        if (event?.payload !== undefined) notifications.receive(event.payload);
      },
      "notifications.dismissed": (event) => {
        if (event?.payload?.id !== undefined)
          notifications.remove(event.payload.id);
      },
      "files.changed": () => {
        for (const listener of subscribers.files) listener();
      },
      "stream:error": () => {
        // EventSource retries; no user-facing noise for a transient stream drop.
      },
    });
  };

  /* --------------------------------- boot --------------------------------- */

  const boot = async () => {
    const health = await api.health();
    if (!health.ok) {
      dom.bootMessage.dataset.error = "true";
      dom.bootMessage.textContent = `Platform unavailable: ${health.error.message}`;
      return;
    }
    state.version = health.data.version;
    state.platformRoot = health.data.home ?? state.platformRoot;

    const [
      settingsResponse,
      appsResponse,
      systemResponse,
      notificationsResponse,
      capabilitiesResponse,
    ] = await Promise.all([
      api.settings(),
      api.apps(),
      api.system(),
      api.notifications(),
      api.capabilities(),
    ]);

    if (!settingsResponse.ok || !appsResponse.ok) {
      dom.bootMessage.dataset.error = "true";
      dom.bootMessage.textContent =
        "The platform started but its settings or application catalog could not be read.";
      return;
    }

    state.settings = settingsResponse.data.settings;
    state.apps = appsResponse.data.apps;
    state.facts = systemResponse.ok ? systemResponse.data.facts : null;
    state.platformRoot = state.facts?.home ?? state.platformRoot;
    state.capabilities = capabilitiesResponse.ok
      ? capabilitiesResponse.data.granted
      : [];
    notifications.setAll(
      notificationsResponse.ok ? notificationsResponse.data.notifications : [],
    );

    applyAppearance();
    renderDesktopIcons();
    renderAppMenus();
    startStream();

    dom.boot.dataset.leaving = "true";
    setTimeout(() => {
      dom.boot.hidden = true;
    }, 320);

    const pollSystem = async () => {
      const response = await api.system();
      if (!response.ok) {
        dom.cpuChip.textContent = "CPU —";
        return;
      }
      const usage = response.data.metrics.cpuUsagePercent;
      dom.cpuChip.textContent =
        usage === null ? "CPU …" : `CPU ${usage.toFixed(0)}%`;
      state.facts = response.data.facts;
    };
    await pollSystem();
    setInterval(() => void pollSystem(), 5000);
    setInterval(renderClock, 1000);

    // Show the launcher once so a first-time user discovers search.
    setTimeout(() => {
      if (wm.state().list.length === 0) launcher.open();
    }, 700);
  };

  await boot();
  return { openApp, openFile, state };
};
