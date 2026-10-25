import { api } from "../api.js";
import { clear, el } from "../dom.js";

/**
 * Console — the system log.
 *
 * Reads the platform logger's bounded ring buffer. This is the same log stream
 * the services emit while booting and serving requests, so it is the first place
 * to look when something fails.
 */

const LEVELS = ["all", "debug", "info", "warn", "error"];

export const renderConsole = (body, ctx) => {
  let entries = [];
  let level = "all";
  let query = "";

  const list = el("div", { class: "console-list", role: "log" });
  const filterRow = el("div", { class: "app-toolbar" });
  const status = el("div", { class: "files-status" });
  const searchInput = el("input", {
    class: "text-input",
    type: "search",
    placeholder: "Filter messages",
    style: "max-width: 240px",
    "aria-label": "Filter log messages",
    on: {
      input: (event) => {
        query = event.currentTarget.value.trim().toLowerCase();
        render();
      },
    },
  });

  const segmented = el(
    "div",
    { class: "segmented", role: "group", "aria-label": "Log level" },
    LEVELS.map((candidate) =>
      el("button", {
        text: candidate,
        "aria-pressed": String(candidate === level),
        on: {
          click: () => {
            level = candidate;
            render();
          },
        },
      }),
    ),
  );

  filterRow.append(
    segmented,
    el("span", { class: "spacer" }),
    searchInput,
    el("button", {
      class: "toolbar-button",
      text: "Refresh",
      on: { click: () => void load() },
    }),
  );

  body.append(el("div", { class: "app" }, [filterRow, list, status]));

  const render = () => {
    for (const [index, button] of [...segmented.children].entries()) {
      button.setAttribute("aria-pressed", String(LEVELS[index] === level));
    }
    clear(list);
    const filtered = entries.filter((entry) => {
      if (level !== "all" && entry.level !== level) return false;
      if (query.length === 0) return true;
      return `${entry.scope} ${entry.message}`.toLowerCase().includes(query);
    });
    if (filtered.length === 0) {
      list.append(
        el("div", {
          class: "empty-state",
          text: "No log entries match this filter.",
        }),
      );
    }
    for (const entry of [...filtered].reverse()) {
      list.append(
        el("div", { class: "log-row", dataset: { level: entry.level } }, [
          el("span", {
            class: "log-time",
            text: new Date(entry.at).toLocaleTimeString(undefined, {
              hour12: false,
            }),
          }),
          el("span", { class: "log-scope", text: entry.scope }),
          el("span", {
            class: "log-message",
            text:
              entry.data === undefined
                ? entry.message
                : `${entry.message} ${JSON.stringify(entry.data)}`,
          }),
        ]),
      );
    }
    status.replaceChildren(
      el("span", { class: "status-dot" }),
      el("span", { text: `${filtered.length} of ${entries.length} entries` }),
      el("span", { class: "spacer" }),
      el("span", { text: "Bounded in-memory ring buffer (500 entries)" }),
    );
    ctx.win.setTitle("Console", `${entries.length} entries`);
  };

  const load = async () => {
    const response = await api.logs();
    if (!response.ok) {
      clear(list);
      list.append(
        el("div", { class: "empty-state", text: response.error.message }),
      );
      return;
    }
    entries = response.data.entries;
    render();
  };

  const timer = setInterval(async () => {
    if (!body.isConnected) {
      clearInterval(timer);
      return;
    }
    await load();
  }, 4000);

  ctx.win.onClose = () => clearInterval(timer);
  void load();
};
