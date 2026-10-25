import { el } from "./dom.js";

/**
 * In-shell modal dialogs.
 *
 * Using the platform's own dialogs (rather than `window.prompt`) keeps focus
 * management, keyboard behaviour and theming consistent with the rest of ReaOS.
 */

const mount = (card, { onEscape }) => {
  const overlay = el("div", { class: "dialog-overlay" }, [card]);
  const previous = document.activeElement;
  const onKey = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onEscape();
    }
    if (event.key === "Tab") {
      const focusable = [
        ...card.querySelectorAll("button, input, textarea, select"),
      ].filter((node) => !node.disabled);
      if (focusable.length === 0) return;
      const index = focusable.indexOf(document.activeElement);
      const next =
        focusable[
          (index + (event.shiftKey ? -1 : 1) + focusable.length) %
            focusable.length
        ];
      event.preventDefault();
      next?.focus();
    }
  };
  document.addEventListener("keydown", onKey, true);
  document.body.append(overlay);
  return {
    overlay,
    close: () => {
      document.removeEventListener("keydown", onKey, true);
      overlay.remove();
      if (previous instanceof HTMLElement) previous.focus();
    },
  };
};

export const askText = ({
  title,
  label,
  value = "",
  confirmLabel = "OK",
  placeholder = "",
}) =>
  new Promise((resolve) => {
    let settled = false;
    const input = el("input", {
      class: "text-input",
      type: "text",
      value,
      placeholder,
    });
    const finish = (result) => {
      if (settled) return;
      settled = true;
      mounted.close();
      resolve(result);
    };
    const card = el(
      "form",
      { class: "dialog-card", role: "dialog", "aria-modal": "true" },
      [
        el("h2", { class: "dialog-title", text: title }),
        el("label", { class: "field" }, [label, input]),
        el("div", { class: "dialog-actions" }, [
          el("button", {
            class: "toolbar-button",
            type: "button",
            text: "Cancel",
            on: { click: () => finish(null) },
          }),
          el("button", {
            class: "toolbar-button",
            dataset: { primary: "true" },
            type: "submit",
            text: confirmLabel,
          }),
        ]),
      ],
    );
    const mounted = mount(card, { onEscape: () => finish(null) });
    card.addEventListener("submit", (event) => {
      event.preventDefault();
      finish(input.value.trim().length > 0 ? input.value.trim() : null);
    });
    input.focus();
    input.select();
  });

export const askConfirm = ({
  title,
  message,
  confirmLabel = "Continue",
  destructive = false,
}) =>
  new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      mounted.close();
      resolve(result);
    };
    const card = el(
      "div",
      { class: "dialog-card", role: "dialog", "aria-modal": "true" },
      [
        el("h2", { class: "dialog-title", text: title }),
        el("p", { class: "dialog-message", text: message }),
        el("div", { class: "dialog-actions" }, [
          el("button", {
            class: "toolbar-button",
            text: "Cancel",
            on: { click: () => finish(false) },
          }),
          el("button", {
            class: "toolbar-button",
            dataset: destructive ? { danger: "true" } : { primary: "true" },
            text: confirmLabel,
            on: { click: () => finish(true) },
          }),
        ]),
      ],
    );
    const mounted = mount(card, { onEscape: () => finish(false) });
    card.querySelector("button")?.focus();
  });
