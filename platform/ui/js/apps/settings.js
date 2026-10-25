import { api } from "../api.js";
import { askConfirm, askText } from "../dialog.js";
import { clear, el } from "../dom.js";

/**
 * Settings — system preferences.
 *
 * Changes are written to the platform (validated + persisted by the settings
 * service). The shell re-themes from the same source of truth, so previewing a
 * theme here is the real system theme, not a local override.
 */

const SECTIONS = [
  { id: "appearance", label: "Appearance", glyph: "◐" },
  { id: "privacy", label: "Privacy & security", glyph: "⛨" },
  { id: "notifications", label: "Notifications", glyph: "◔" },
  { id: "about", label: "About", glyph: "ⓘ" },
];

const ACCENT_SWATCHES = [
  { id: "aurora", color: "#5fd7c0" },
  { id: "ember", color: "#ffb347" },
  { id: "tide", color: "#58b4ff" },
  { id: "violet", color: "#b18cff" },
  { id: "graphite", color: "#c3cbd9" },
];

const WALLPAPERS = ["dawn", "dusk", "forest", "slate", "paper"];

export const renderSettings = (body, ctx, payload = {}) => {
  let active = payload.section ?? "appearance";
  let settings = { ...ctx.settings() };

  const nav = el("nav", { class: "settings-nav" });
  const content = el("div", { class: "settings-content" });
  body.append(
    el("div", { class: "app" }, [
      el("div", { class: "files-layout settings-layout" }, [nav, content]),
    ]),
  );

  const update = async (patch) => {
    const response = await api.patchSettings(patch);
    if (!response.ok) {
      ctx.notify("Setting rejected", response.error.message, "error");
      return;
    }
    settings = { ...settings, ...patch };
    ctx.applySettings(settings);
    render();
  };

  const row = (name, hint, control) =>
    el("div", { class: "setting-row" }, [
      el("div", { class: "setting-label" }, [
        el("span", { class: "setting-name", text: name }),
        el("span", { class: "setting-hint", text: hint }),
      ]),
      control,
    ]);

  const toggle = (checked, onChange) =>
    el("button", {
      class: "switch",
      role: "switch",
      "aria-checked": String(checked),
      "aria-label": checked ? "Enabled" : "Disabled",
      on: { click: () => onChange(!checked) },
    });

  const segmented = (options, current, onSelect) =>
    el(
      "div",
      { class: "segmented", role: "group" },
      options.map((option) =>
        el("button", {
          text: option.label,
          "aria-pressed": String(option.value === current),
          on: { click: () => onSelect(option.value) },
        }),
      ),
    );

  const group = (children) => el("div", { class: "setting-group" }, children);

  const renderAppearance = () => [
    el("h2", { class: "section-title", text: "Appearance" }),
    el("p", {
      class: "section-subtitle",
      text: "ReaOS uses one token system for colour, spacing and motion. Changes apply to every open window immediately.",
    }),
    group([
      row(
        "Theme",
        "Light, dark, or follow the host operating system.",
        segmented(
          [
            { label: "Light", value: "light" },
            { label: "Dark", value: "dark" },
            { label: "Auto", value: "auto" },
          ],
          settings.theme,
          (value) => void update({ theme: value }),
        ),
      ),
      row(
        "Accent",
        "Used for selection, focus rings and active controls.",
        el(
          "div",
          { class: "swatches" },
          ACCENT_SWATCHES.map((swatch) =>
            el("button", {
              class: "swatch",
              style: `background:${swatch.color}`,
              "aria-label": swatch.id,
              "aria-pressed": String(settings.accent === swatch.id),
              on: { click: () => void update({ accent: swatch.id }) },
            }),
          ),
        ),
      ),
      row(
        "Wallpaper",
        "Original gradient artwork rendered by the shell.",
        el(
          "div",
          { class: "wallpaper-grid" },
          WALLPAPERS.map((wallpaper) =>
            el("button", {
              class: "wallpaper-option",
              dataset: { wallpaper },
              "aria-label": wallpaper,
              "aria-pressed": String(settings.wallpaper === wallpaper),
              on: { click: () => void update({ wallpaper }) },
            }),
          ),
        ),
      ),
      row(
        "Dock size",
        `Currently ${settings.dockSize}px.`,
        el("input", {
          class: "range",
          type: "range",
          min: "40",
          max: "96",
          step: "4",
          value: String(settings.dockSize),
          "aria-label": "Dock icon size",
          on: {
            input: (event) => {
              ctx.previewDockSize(Number(event.target.value));
            },
            change: (event) =>
              void update({ dockSize: Number(event.target.value) }),
          },
        }),
      ),
      row(
        "Reduce motion",
        "Disable window and dock animations.",
        toggle(
          settings.reduceMotion,
          (value) => void update({ reduceMotion: value }),
        ),
      ),
      row(
        "Show seconds in the clock",
        "Adds seconds to the menu bar clock.",
        toggle(
          settings.showSeconds,
          (value) => void update({ showSeconds: value }),
        ),
      ),
      row(
        "Display name",
        "Shown in the welcome notification and account surfaces.",
        el("button", {
          class: "toolbar-button",
          text: settings.displayName,
          on: {
            click: async () => {
              const name = await askText({
                title: "Display name",
                label: "Your name",
                value: settings.displayName,
                confirmLabel: "Save",
              });
              if (name !== null) await update({ displayName: name });
            },
          },
        }),
      ),
    ]),
  ];

  const renderPrivacy = () => {
    const capabilities = ctx.capabilities();
    return [
      el("h2", { class: "section-title", text: "Privacy & security" }),
      el("p", {
        class: "section-subtitle",
        text: "Applications receive capabilities, not ambient authority. The terminal is the only surface that can start a process, and it is off until you enable it here.",
      }),
      group([
        row(
          "Command execution",
          "Allow the Terminal to run approved host commands (node, ls, cat, grep, …) inside the platform sandbox. Commands never run through a shell.",
          toggle(
            settings.terminalEnabled,
            (value) => void update({ terminalEnabled: value }),
          ),
        ),
      ]),
      el("h3", {
        class: "section-title",
        style: "font-size:14px",
        text: "Granted capabilities",
      }),
      group(
        capabilities.length === 0
          ? [
              row(
                "None",
                "No capabilities are currently granted.",
                el("span", { class: "quiet", text: "—" }),
              ),
            ]
          : capabilities.map((capability) =>
              row(
                capability,
                capabilityHint(capability),
                el("span", { class: "badge", text: "granted" }),
              ),
            ),
      ),
      group([
        row(
          "Reset all settings",
          "Restores appearance, privacy and notification defaults.",
          el("button", {
            class: "toolbar-button",
            dataset: { danger: "true" },
            text: "Reset…",
            on: {
              click: async () => {
                const confirmed = await askConfirm({
                  title: "Reset settings?",
                  message:
                    "All preferences return to their defaults. Your files are not affected.",
                  confirmLabel: "Reset",
                  destructive: true,
                });
                if (!confirmed) return;
                const response = await api.resetSettings();
                if (response.ok) {
                  settings = { ...response.data };
                  ctx.applySettings(settings);
                  render();
                  ctx.notify("Settings reset", "Defaults restored.", "success");
                }
              },
            },
          }),
        ),
      ]),
    ];
  };

  const renderNotifications = () => [
    el("h2", { class: "section-title", text: "Notifications" }),
    el("p", {
      class: "section-subtitle",
      text: "Platform services publish notifications; the shell shows them as toasts and keeps a history in the menu bar.",
    }),
    group([
      row(
        "Allow notifications",
        "Turning this off stops new notifications from being published.",
        toggle(
          settings.notificationsEnabled,
          (value) => void update({ notificationsEnabled: value }),
        ),
      ),
      row(
        "Send a test notification",
        "Publishes a notification through the platform service.",
        el("button", {
          class: "toolbar-button",
          text: "Send test",
          on: {
            click: async () => {
              const response = await api.publishNotification(
                "Test notification",
                "If you can read this, notification delivery works end to end.",
                "success",
              );
              if (!response.ok)
                ctx.notify(
                  "Notification blocked",
                  response.error.message,
                  "warning",
                );
            },
          },
        }),
      ),
    ]),
  ];

  const renderAbout = () => {
    const facts = ctx.systemFacts() ?? {};
    return [
      el("h2", { class: "section-title", text: "About ReaOS" }),
      el("p", {
        class: "section-subtitle",
        text: "ReaOS is an independent desktop platform built in the REA repository. It runs on the host kernel and owns its filesystem namespace, capability model, services, shell and applications.",
      }),
      group([
        el("div", { class: "about-grid", style: "padding:16px" }, [
          aboutLine("Platform version", facts.platformVersion ?? "0.1.0"),
          aboutLine(
            "Host",
            `${facts.hostname ?? "—"} · ${facts.platform ?? ""} ${facts.release ?? ""}`,
          ),
          aboutLine("Architecture", facts.architecture ?? "—"),
          aboutLine(
            "Processor",
            `${facts.cpuCount ?? "—"} × ${facts.cpuModel ?? "—"}`,
          ),
          aboutLine("Home directory", ctx.platformRoot()),
        ]),
      ]),
      el("p", {
        class: "setting-hint",
        style: "max-width:60ch",
        text: "ReaOS is not affiliated with, endorsed by, or derived from Apple Inc. macOS inspired the interaction model; all code, artwork and naming here are original. The REA reverse-engineering toolkit remains a separate product in this repository.",
      }),
    ];
  };

  const aboutLine = (label, value) =>
    el("div", { class: "about-line" }, [
      el("span", { text: label }),
      el("span", { text: String(value) }),
    ]);

  const capabilityHint = (capability) => {
    switch (capability) {
      case "fs:read":
        return "Read files inside the ReaOS home directory.";
      case "fs:write":
        return "Create, rename, save and trash files.";
      case "process:spawn":
        return "Start approved commands from the Terminal.";
      case "settings:write":
        return "Change system preferences.";
      case "notifications:publish":
        return "Publish notifications.";
      case "system:info":
        return "Read host telemetry.";
      default:
        return "";
    }
  };

  const render = () => {
    clear(nav);
    nav.append(
      ...SECTIONS.map((section) =>
        el(
          "button",
          {
            class: "sidebar-item",
            "aria-current": String(section.id === active),
            on: {
              click: () => {
                active = section.id;
                render();
              },
            },
          },
          [
            el("span", { class: "sidebar-glyph", text: section.glyph }),
            el("span", { text: section.label }),
          ],
        ),
      ),
    );
    clear(content);
    const children =
      active === "appearance"
        ? renderAppearance()
        : active === "privacy"
          ? renderPrivacy()
          : active === "notifications"
            ? renderNotifications()
            : renderAbout();
    content.append(...children);
    ctx.win.setTitle(
      "Settings",
      SECTIONS.find((section) => section.id === active)?.label,
    );
  };

  const onSettings = ctx.onSettingsChanged?.((next) => {
    settings = { ...next };
    render();
  });
  ctx.win.onClose = () => onSettings?.();

  render();
};
