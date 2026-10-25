import { api } from "./api.js";
import { clear, el, formatDate } from "./dom.js";

/**
 * Notification centre UI.
 *
 * Records come from the platform (and are re-delivered over SSE), so the panel
 * shows the authoritative list. Toasts are a transient presentation of the same
 * records; dismissing either surface deletes the record on the server.
 */

export const createNotificationUI = ({
  toasts,
  panel,
  bellButton,
  countBadge,
  onOpenApp,
}) => {
  let records = [];
  const timers = new Map();

  const renderBadge = () => {
    if (records.length === 0) {
      countBadge.hidden = true;
      return;
    }
    countBadge.hidden = false;
    countBadge.textContent = records.length > 9 ? "9+" : String(records.length);
  };

  const renderPanel = () => {
    clear(panel);
    panel.append(
      el("div", { class: "panel-title" }, [
        el("span", { text: "Notifications" }),
        records.length > 0
          ? el("button", {
              class: "toolbar-button",
              text: "Clear all",
              on: {
                click: async () => {
                  await api.dismissAll();
                  records = [];
                  renderAll();
                },
              },
            })
          : null,
      ]),
    );
    if (records.length === 0) {
      panel.append(
        el("p", { class: "panel-empty", text: "You're all caught up." }),
      );
      return;
    }
    for (const record of records) {
      panel.append(
        el(
          "button",
          {
            class: "panel-item",
            on: {
              click: async () => {
                await api.dismiss(record.id);
                records = records.filter((entry) => entry.id !== record.id);
                renderAll();
              },
            },
          },
          [
            el("span", { class: "panel-item-title", text: record.title }),
            el("span", { class: "panel-item-body", text: record.body }),
            el("span", {
              class: "panel-item-meta",
              text: formatDate(record.createdAt),
            }),
          ],
        ),
      );
    }
    if (onOpenApp !== undefined) {
      panel.append(
        el("div", { class: "panel-separator" }),
        el("button", {
          class: "panel-row",
          text: "Open system log (Console)",
          on: {
            click: () => {
              onOpenApp("console");
              togglePanel(false);
            },
          },
        }),
      );
    }
  };

  const renderAll = () => {
    renderBadge();
    if (!panel.hidden) renderPanel();
  };

  const showToast = (record) => {
    const node = el(
      "button",
      {
        class: "toast",
        dataset: { level: record.level, id: record.id },
        on: {
          click: async () => {
            await api.dismiss(record.id);
            records = records.filter((entry) => entry.id !== record.id);
            node.remove();
            renderAll();
          },
        },
      },
      [
        el("span", { class: "toast-title", text: record.title }),
        el("span", { class: "toast-body", text: record.body }),
      ],
    );
    toasts.append(node);
    // Bound the stack so a burst cannot cover the desktop.
    while (toasts.childElementCount > 4) toasts.firstElementChild?.remove();
    const timer = setTimeout(() => node.remove(), 7000);
    timers.set(record.id, timer);
  };

  const togglePanel = (force) => {
    const next = force ?? panel.hidden;
    panel.hidden = !next;
    bellButton.setAttribute("aria-expanded", String(next));
    if (next) renderPanel();
  };

  return {
    setAll: (nextRecords) => {
      records = [...nextRecords].sort((a, b) =>
        a.createdAt < b.createdAt ? 1 : -1,
      );
      clear(toasts);
      renderAll();
    },
    receive: (record) => {
      records = [record, ...records.filter((entry) => entry.id !== record.id)];
      showToast(record);
      renderAll();
    },
    remove: (id) => {
      records = records.filter((entry) => entry.id !== id);
      clearTimeout(timers.get(id));
      timers.delete(id);
      toasts.querySelector(`[data-id="${id}"]`)?.remove();
      renderAll();
    },
    togglePanel,
    closePanel: () => togglePanel(false),
    isPanelOpen: () => !panel.hidden,
    renderPanel: () => {
      if (!panel.hidden) renderPanel();
    },
  };
};
