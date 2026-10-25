/**
 * UI component kit: Illustrator-style numeric fields with drag-scrub and
 * expression parsing, sliders, dialogs, menus, tooltips and toasts.
 */

import { el, clamp, fmt, hexToHsv, hsvToHex } from "../engine/util.js";
import { icon } from "../engine/icons.js";
import { evaluateExpression } from "./evaluate.js";

export { evaluateExpression };

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
