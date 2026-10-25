/**
 * UI component kit: Illustrator-style numeric fields with drag-scrub and
 * expression parsing, sliders, dialogs, menus, tooltips and toasts.
 */

import { el, clamp, fmt, hexToHsv, hsvToHex } from "./util.js";
import { icon } from "./icons.js";

/* ------------------------------------------------------------------ maths */

/** Illustrator accepts arithmetic in numeric fields: 120+30, 50*2, 100/3. */
export function evaluateExpression(raw) {
  const text = String(raw).trim().replace(/[,\s]/g, "").replace(/px|pt|mm|in|%|°/g, "");
  if (!text) return null;
  if (!/^[-+*/().\d]+$/.test(text)) {
    const n = parseFloat(text);
    return Number.isFinite(n) ? n : null;
  }
  if (!/[-+*/]/.test(text.replace(/^-/, ""))) {
    const n = parseFloat(text);
    return Number.isFinite(n) ? n : null;
  }
  try {
    // eslint-disable-next-line no-new-func
    const v = Function(`"use strict"; return (${text})`)();
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ fields */

/**
 * Numeric field with drag-to-scrub on its prefix label, arrow-key stepping and
 * expression entry.
 */
export function numField(opts = {}) {
  const {
    label = "", value = 0, min = -1e7, max = 1e7, step = 1, dp = 2,
    unit = "", onChange = () => {}, width = 0, title = "", disabled = false,
    scrub = true, prefixIcon = null,
  } = opts;

  const input = el("input", {
    type: "text",
    inputmode: "decimal",
    value: fmt(value, dp),
    spellcheck: "false",
    "aria-label": title || label || "value",
  });
  input.disabled = disabled;
  if (width) input.style.width = "100%";

  const prefix = el("span", { class: "num__prefix", title: title || label }, []);
  if (prefixIcon) prefix.innerHTML = prefixIcon;
  else prefix.textContent = label || unit || "";

  const wrap = el("div", { class: `num num__scrub${opts.small ? " num--sm" : ""}` }, [prefix, input]);
  wrap.style.minWidth = width ? `${width}px` : "0";
  if (width) wrap.style.width = `${width}px`;
  if (opts.grow) wrap.style.flex = "1";

  let current = value;
  let editing = false;

  const commit = (raw, notify = true) => {
    const parsed = evaluateExpression(raw);
    if (parsed == null) {
      input.value = fmt(current, dp);
      return false;
    }
    const next = clamp(parsed, min, max);
    current = next;
    input.value = fmt(next, dp);
    if (notify) onChange(next);
    return true;
  };

  input.addEventListener("focus", () => {
    editing = true;
    input.select();
  });
  input.addEventListener("blur", () => {
    editing = false;
    commit(input.value);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit(input.value);
      input.blur();
    } else if (e.key === "Escape") {
      input.value = fmt(current, dp);
      input.blur();
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const multiplier = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
      const delta = (e.key === "ArrowUp" ? step : -step) * multiplier;
      commit(String(current + delta));
      input.select();
    }
  });
  input.addEventListener("change", () => {
    if (!editing) commit(input.value);
  });

  if (scrub) {
    prefix.style.cursor = "ew-resize";
    let startX = 0;
    let startVal = 0;
    let dragging = false;
    prefix.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      startX = e.clientX;
      startVal = current;
      dragging = true;
      prefix.setPointerCapture?.(e.pointerId);
    });
    prefix.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const mult = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
      const next = clamp(startVal + Math.round(dx / 2) * step * mult, min, max);
      current = next;
      input.value = fmt(next, dp);
      onChange(next);
    });
    const stop = () => { dragging = false; };
    prefix.addEventListener("pointerup", stop);
    prefix.addEventListener("pointercancel", stop);
  }

  return {
    el: wrap,
    input,
    get: () => current,
    set: (v, notify = false) => {
      current = v;
      if (document.activeElement !== input) input.value = fmt(v, dp);
      if (notify) onChange(v);
    },
    setDisabled: (v) => { input.disabled = v; wrap.style.opacity = v ? "0.45" : "1"; },
  };
}

export function textField(opts = {}) {
  const { value = "", placeholder = "", onChange = () => {}, width = 0, mono = false } = opts;
  const input = el("input", { class: "text-input", type: "text", value, placeholder, spellcheck: "false" });
  if (width) { input.style.width = `${width}px`; input.style.flex = "0 0 auto"; }
  if (mono) input.style.fontFamily = "var(--font-mono)";
  input.addEventListener("change", () => onChange(input.value));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") input.blur();
    if (e.key === "Escape") { input.value = value; input.blur(); }
  });
  return { el: input, input, set: (v) => { if (document.activeElement !== input) input.value = v; }, get: () => input.value };
}

export function selectField(opts = {}) {
  const { options = [], value, onChange = () => {}, width = 0 } = opts;
  const select = el("select", { class: "select" });
  for (const opt of options) {
    const o = el("option", { value: opt.value }, [opt.label]);
    select.append(o);
  }
  if (value != null) select.value = value;
  if (width) { select.style.width = `${width}px`; select.style.flex = "0 0 auto"; }
  select.addEventListener("change", () => onChange(select.value));
  return {
    el: select,
    input: select,
    set: (v) => { if (v != null) select.value = v; },
    get: () => select.value,
  };
}

export function iconButton(name, opts = {}) {
  const btn = el("button", {
    class: `icon-btn${opts.active ? " is-active" : ""}`,
    title: opts.title || "",
    "aria-label": opts.title || name,
    html: icon(name, opts.size || 14),
  });
  if (opts.onClick) btn.addEventListener("click", opts.onClick);
  return btn;
}

export function button(label, opts = {}) {
  const cls = ["btn", opts.variant ? `btn--${opts.variant}` : "", opts.small ? "btn--sm" : ""].filter(Boolean).join(" ");
  const b = el("button", { class: cls, title: opts.title || "" }, opts.icon ? [el("span", { html: icon(opts.icon, 12) })] : []);
  if (typeof label === "string" && label) b.append(label);
  if (opts.onClick) b.addEventListener("click", opts.onClick);
  return b;
}

export function checkbox(label, { checked = false, onChange = () => {} } = {}) {
  const input = el("input", { type: "checkbox" });
  input.checked = checked;
  input.addEventListener("change", () => onChange(input.checked));
  const wrap = el("label", { class: "checkbox" }, [input, label]);
  return { el: wrap, input, set: (v) => { input.checked = v; } };
}

export function slider({ value = 0, min = 0, max = 100, step = 1, onChange = () => {} }) {
  const track = el("div", { class: "slider__track" }, [el("div", { class: "slider__fill" })]);
  const thumb = el("div", { class: "slider__thumb" });
  const root = el("div", { class: "slider" }, [track, thumb]);
  let current = value;
  const render = () => {
    const t = clamp((current - min) / (max - min || 1), 0, 1);
    track.firstChild.style.width = `${t * 100}%`;
    thumb.style.left = `${t * 100}%`;
  };
  render();
  const setFromEvent = (e) => {
    const r = root.getBoundingClientRect();
    const t = clamp((e.clientX - r.left) / (r.width || 1), 0, 1);
    current = Math.round((min + t * (max - min)) / step) * step;
    current = clamp(current, min, max);
    render();
    onChange(current);
  };
  let dragging = false;
  root.addEventListener("pointerdown", (e) => {
    dragging = true;
    root.setPointerCapture?.(e.pointerId);
    setFromEvent(e);
  });
  root.addEventListener("pointermove", (e) => { if (dragging) setFromEvent(e); });
  const up = () => { dragging = false; };
  root.addEventListener("pointerup", up);
  root.addEventListener("pointercancel", up);
  return { el: root, set: (v) => { current = v; render(); }, get: () => current };
}

export function segmented(items, { value, onChange = () => {} } = {}) {
  const root = el("div", { class: "row row--tight" });
  const buttons = items.map((item) => {
    const b = el("button", {
      class: `icon-btn${item.value === value ? " is-active" : ""}`,
      title: item.title || "",
      html: icon(item.icon, item.size || 14),
    });
    b.addEventListener("click", () => {
      buttons.forEach((x) => x.classList.remove("is-active"));
      b.classList.add("is-active");
      onChange(item.value);
    });
    root.append(b);
    return b;
  });
  return { el: root, set: (v) => { buttons.forEach((b, i) => b.classList.toggle("is-active", items[i].value === v)); } };
}

/* ------------------------------------------------------------------ swatch */

export function swatch(color, { active = false, size = 17, title = "", onClick = null, none = false } = {}) {
  const s = el("button", {
    class: `swatch${active ? " is-active" : ""}${none ? " swatch--none" : ""}`,
    title: title || color,
  });
  s.style.width = `${size}px`;
  s.style.height = `${size}px`;
  if (!none) s.style.background = color;
  if (onClick) s.addEventListener("click", onClick);
  return s;
}

export function colorPreview(color, size = 18) {
  const box = el("div", { class: "appearance-row__swatch" });
  box.style.width = `${size}px`;
  box.style.height = `${size}px`;
  if (!color) {
    box.classList.add("proxy__none");
  } else {
    box.style.background = color;
  }
  return box;
}

/* ------------------------------------------------------------------ menus */

let openMenuEl = null;

export function closeMenu() {
  if (openMenuEl) {
    openMenuEl.remove();
    openMenuEl = null;
  }
  document.querySelectorAll(".menu-trigger.is-open").forEach((n) => n.classList.remove("is-open"));
}

export function showMenu(x, y, items, { minWidth = 224, sourceEl = null } = {}) {
  closeMenu();
  const menu = el("div", { class: "menu", role: "menu" });
  menu.style.minWidth = `${minWidth}px`;
  for (const item of items) {
    if (!item) continue;
    if (item.separator) {
      menu.append(el("div", { class: "menu__separator" }));
      continue;
    }
    if (item.labelOnly) {
      menu.append(el("div", { class: "menu__label" }, [item.labelOnly]));
      continue;
    }
    const disabled = item.disabled;
    const row = el("button", {
      class: `menu__item${disabled ? " is-disabled" : ""}`,
      role: "menuitem",
      disabled: disabled ? true : null,
    });
    const check = el("span", { class: "menu__check", html: item.checked ? icon("check", 12) : "" });
    const title = el("span", { class: "menu__label-text" }, [item.label]);
    const shortcut = el("span", { class: "menu__shortcut" }, [item.shortcut || (item.submenu ? "›" : "")]);
    row.append(check, title, shortcut);
    if (!disabled && item.action) {
      row.addEventListener("click", () => {
        closeMenu();
        item.action();
      });
    }
    if (item.submenu && !disabled) {
      row.addEventListener("mouseenter", () => {
        const r = row.getBoundingClientRect();
        showMenu(r.right - 2, r.top - 4, item.submenu, { minWidth });
      });
    }
    menu.append(row);
  }
  document.body.append(menu);
  const rect = menu.getBoundingClientRect();
  const px = Math.min(x, window.innerWidth - rect.width - 6);
  const py = Math.min(y, window.innerHeight - rect.height - 6);
  menu.style.left = `${Math.max(4, px)}px`;
  menu.style.top = `${Math.max(4, py)}px`;
  openMenuEl = menu;
  if (sourceEl) sourceEl.classList.add("is-open");
  return menu;
}

document.addEventListener("pointerdown", (e) => {
  if (openMenuEl && !openMenuEl.contains(e.target) && !e.target?.closest?.(".menu-trigger")) {
    closeMenu();
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeMenu();
});

/* ------------------------------------------------------------------ toast */

let toastTimer = null;
export function toast(message, ms = 2200) {
  const node = document.getElementById("toast");
  if (!node) return;
  node.textContent = message;
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.hidden = true; }, ms);
}

/* ------------------------------------------------------------------ tooltip */

let tipEl = null;
let tipTimer = null;
export function initTooltips(root = document.body) {
  root.addEventListener("pointerover", (e) => {
    const target = e.target.closest("[data-tooltip]");
    if (!target) return;
    clearTimeout(tipTimer);
    tipTimer = setTimeout(() => {
      const text = target.getAttribute("data-tooltip");
      const shortcut = target.getAttribute("data-shortcut") || "";
      if (!text) return;
      tipEl = el("div", { class: "tooltip" }, [
        text,
        shortcut ? el("span", { class: "tooltip__shortcut" }, [shortcut]) : null,
      ]);
      document.body.append(tipEl);
      const r = target.getBoundingClientRect();
      const size = tipEl.getBoundingClientRect();
      const x = clamp(r.left + r.width / 2 - size.width / 2, 4, window.innerWidth - size.width - 4);
      const y = r.bottom + 6 + size.height > window.innerHeight ? r.top - size.height - 6 : r.bottom + 6;
      tipEl.style.left = `${x}px`;
      tipEl.style.top = `${y}px`;
    }, 420);
  });
  root.addEventListener("pointerout", (e) => {
    if (!e.target.closest("[data-tooltip]")) return;
    clearTimeout(tipTimer);
    if (tipEl) { tipEl.remove(); tipEl = null; }
  });
}

/* ------------------------------------------------------------------ dialog */

export function showDialog({ title, body, footer, width = 460, onClose = null }) {
  closeMenu();
  const root = document.getElementById("modal-root");
  const backdrop = el("div", { class: "modal-backdrop" });
  const dialog = el("div", { class: "dialog" });
  if (width !== 460) dialog.style.width = `${width}px`;
  const titlebar = el("div", { class: "dialog__titlebar" }, [
    el("strong", { text: title }),
    el("button", { class: "dialog__close", html: icon("close", 12), "aria-label": "Close" }),
  ]);
  const bodyEl = el("div", { class: "dialog__body" }, body);
  const footerEl = el("div", { class: "dialog__footer" }, footer || []);
  dialog.append(titlebar, bodyEl, footerEl);
  backdrop.append(dialog);
  root.append(backdrop);

  const close = () => {
    backdrop.remove();
    if (onClose) onClose();
  };
  titlebar.querySelector(".dialog__close").addEventListener("click", close);
  backdrop.addEventListener("pointerdown", (e) => {
    if (e.target === backdrop) close();
  });
  const onKey = (e) => {
    if (e.key === "Escape") { e.stopPropagation(); close(); document.removeEventListener("keydown", onKey); }
  };
  document.addEventListener("keydown", onKey);
  return { backdrop, dialog, body: bodyEl, footer: footerEl, close };
}

export function showAlert(title, message) {
  return showDialog({
    title,
    body: [el("p", { class: "dialog__hint", style: { margin: 0, fontSize: "11.5px", lineHeight: "1.6" }, text: message })],
    footer: [button("OK", { variant: "primary", onClick: () => document.querySelector(".modal-backdrop")?.remove() })],
    width: 380,
  });
}

/* ------------------------------------------------------------------ colour helpers */

export function colorField({ label, value = "#000000", onChange = () => {} }) {
  const swatchEl = el("button", { class: "appearance-row__swatch", title: label });
  swatchEl.style.width = "20px";
  swatchEl.style.height = "20px";
  const hex = textField({ value, onChange: (v) => apply(v) });
  hex.input.style.width = "70px";
  const input = el("input", { type: "color", value });
  input.style.position = "absolute";
  input.style.opacity = "0";
  input.style.pointerEvents = "none";
  const apply = (v) => {
    const color = String(v).startsWith("#") ? v : `#${v}`;
    swatchEl.style.background = color;
    hex.set(color);
    onChange(color);
  };
  swatchEl.addEventListener("click", () => input.click());
  input.addEventListener("input", () => apply(input.value));
  const wrap = el("div", { class: "row" }, [
    el("span", { class: "label", style: { minWidth: "34px" } }, [label]),
    swatchEl, hex.el, input,
  ]);
  return {
    el: wrap,
    set: (v) => {
      swatchEl.style.background = v;
      hex.set(v);
      input.value = v;
    },
  };
}

export { hexToHsv, hsvToHex, icon };
